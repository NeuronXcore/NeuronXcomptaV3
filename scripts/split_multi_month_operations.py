"""Éclate un fichier d'opérations multi-mois en N fichiers mensuels.

Raison : `list_operation_files()` classe chaque fichier selon un SEUL couple (year, month)
déduit de la mode des dates. Quand un fichier contient plusieurs mois, seul le mois dominant
apparaît dans le dropdown du sélecteur Editor/Pipeline, rendant les autres mois invisibles.

Comportement :
- Groupe les ops du fichier source par YYYY-MM (clé `Date`).
- Génère un nouveau fichier par mois (nom `operations_split_YYYYMM_<timestamp>.json`).
- Met à jour les références `operation_ref` dans `data/ged/ged_metadata.json` et dans les
  `.ocr.json` des justificatifs associés (mapping `operation_file` + `operation_index`).
- Archive le fichier source dans `data/imports/operations/_archive/` avec un timestamp.

Usage :
    python scripts/split_multi_month_operations.py <filename> [--dry-run] [--yes]

Exemple :
    python scripts/split_multi_month_operations.py operations_20260413_185158_275b0690.json --dry-run
    python scripts/split_multi_month_operations.py operations_20260413_185158_275b0690.json --yes
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Locate project root + data dirs
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OPS_DIR = PROJECT_ROOT / "data" / "imports" / "operations"
ARCHIVE_DIR = OPS_DIR / "_archive"
GED_METADATA_FILE = PROJECT_ROOT / "data" / "ged" / "ged_metadata.json"
JUSTIFS_TRAITES = PROJECT_ROOT / "data" / "justificatifs" / "traites"
JUSTIFS_EN_ATTENTE = PROJECT_ROOT / "data" / "justificatifs" / "en_attente"


def ymkey(date_str: str) -> str | None:
    """Retourne 'YYYY-MM' depuis 'YYYY-MM-DD' ou None si invalide."""
    if not date_str or not isinstance(date_str, str) or len(date_str) < 7:
        return None
    return date_str[:7]


def load_json(path: Path) -> object:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def plan_split(source_filename: str) -> dict:
    """Analyse le fichier source et retourne un plan d'éclatement."""
    src_path = OPS_DIR / source_filename
    if not src_path.exists():
        raise FileNotFoundError(f"Fichier source introuvable : {src_path}")

    ops = load_json(src_path)
    if not isinstance(ops, list):
        raise ValueError(f"Format inattendu : {src_path} n'est pas une liste d'ops")

    # Groupe les ops par YYYY-MM avec conservation de l'index original (pour mapping refs)
    groups: dict[str, list[tuple[int, dict]]] = defaultdict(list)
    undated: list[tuple[int, dict]] = []
    for idx, op in enumerate(ops):
        k = ymkey(op.get("Date", ""))
        if k is None:
            undated.append((idx, op))
        else:
            groups[k].append((idx, op))

    # Génère les noms cibles
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    split_files: dict[str, dict] = {}
    for ym, items in sorted(groups.items()):
        compact = ym.replace("-", "")
        target_name = f"operations_split_{compact}_{ts}.json"
        split_files[ym] = {
            "target_filename": target_name,
            "count": len(items),
            "items": items,  # [(old_idx, op)]
        }

    return {
        "source_filename": source_filename,
        "total_ops": len(ops),
        "undated_count": len(undated),
        "splits": split_files,
        "timestamp": ts,
    }


def collect_ged_refs_impact(source_filename: str) -> list[dict]:
    """Trouve les entrées GED dont operation_ref pointe vers le fichier source."""
    if not GED_METADATA_FILE.exists():
        return []
    raw = load_json(GED_METADATA_FILE)
    if not isinstance(raw, dict):
        return []
    # Format actuel : {version: int, documents: {doc_id: entry}}
    docs = raw.get("documents", raw) if "documents" in raw else raw
    if not isinstance(docs, dict):
        return []
    impacted = []
    for doc_id, entry in docs.items():
        if not isinstance(entry, dict):
            continue
        ref = entry.get("operation_ref") or {}
        if isinstance(ref, dict) and ref.get("operation_file") == source_filename:
            impacted.append({
                "doc_id": doc_id,
                "old_index": ref.get("operation_index"),
                "entry_ref": ref,
            })
    return impacted


def collect_ocr_refs_impact(source_filename: str) -> list[Path]:
    """Trouve les .ocr.json dont operation_ref pointe vers le fichier source."""
    impacted: list[Path] = []
    for base in (JUSTIFS_TRAITES, JUSTIFS_EN_ATTENTE):
        if not base.exists():
            continue
        for ocr_file in base.glob("*.ocr.json"):
            try:
                data = load_json(ocr_file)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            ref = data.get("operation_ref") or {}
            if ref.get("operation_file") == source_filename:
                impacted.append(ocr_file)
    return impacted


def apply_split(plan: dict, dry_run: bool = False) -> dict:
    """Exécute le plan : crée les nouveaux fichiers, update refs, archive l'original."""
    source_filename = plan["source_filename"]
    splits = plan["splits"]
    ts = plan["timestamp"]

    # Mapping old_index → (new_filename, new_index)
    reindex_map: dict[int, tuple[str, int]] = {}
    for ym, info in splits.items():
        for new_local_idx, (old_idx, _op) in enumerate(info["items"]):
            reindex_map[old_idx] = (info["target_filename"], new_local_idx)

    summary = {
        "files_created": [],
        "ged_updated": 0,
        "ocr_updated": 0,
        "archive_path": None,
    }

    # 1. Créer les nouveaux fichiers mensuels
    for ym, info in sorted(splits.items()):
        target_path = OPS_DIR / info["target_filename"]
        payload = [op for _idx, op in info["items"]]
        if dry_run:
            print(f"  [DRY] Créerait : {target_path.name} ({len(payload)} ops pour {ym})")
        else:
            save_json(target_path, payload)
            print(f"  ✓ Créé : {target_path.name} ({len(payload)} ops pour {ym})")
        summary["files_created"].append({
            "ym": ym,
            "filename": info["target_filename"],
            "count": len(payload),
        })

    # 2. Update GED metadata (format {version: int, documents: dict})
    ged_impacted = collect_ged_refs_impact(source_filename)
    if ged_impacted:
        raw = load_json(GED_METADATA_FILE) if GED_METADATA_FILE.exists() else {"documents": {}}
        docs = raw.get("documents", raw) if "documents" in raw else raw
        for item in ged_impacted:
            doc_id = item["doc_id"]
            old_idx = item["old_index"]
            if old_idx is None or old_idx not in reindex_map:
                continue
            new_filename, new_idx = reindex_map[old_idx]
            if not dry_run:
                docs[doc_id]["operation_ref"]["operation_file"] = new_filename
                docs[doc_id]["operation_ref"]["operation_index"] = new_idx
            summary["ged_updated"] += 1
        if not dry_run:
            save_json(GED_METADATA_FILE, raw)
        print(f"  {'[DRY]' if dry_run else '✓'} GED metadata : {summary['ged_updated']} entrée(s) rebindée(s)")

    # 3. Update .ocr.json refs
    ocr_files = collect_ocr_refs_impact(source_filename)
    for ocr_path in ocr_files:
        try:
            data = load_json(ocr_path)
        except Exception:
            continue
        ref = data.get("operation_ref") or {}
        old_idx = ref.get("operation_index")
        if old_idx is None or old_idx not in reindex_map:
            continue
        new_filename, new_idx = reindex_map[old_idx]
        if not dry_run:
            data["operation_ref"]["operation_file"] = new_filename
            data["operation_ref"]["operation_index"] = new_idx
            save_json(ocr_path, data)
        summary["ocr_updated"] += 1
    if ocr_files:
        print(f"  {'[DRY]' if dry_run else '✓'} .ocr.json : {summary['ocr_updated']} fichier(s) rebindé(s)")

    # 4. Archive le fichier source
    archive_path = ARCHIVE_DIR / f"{source_filename}.bak_{ts}"
    if dry_run:
        print(f"  [DRY] Archiverait : {OPS_DIR / source_filename} → {archive_path}")
    else:
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        shutil.move(str(OPS_DIR / source_filename), str(archive_path))
        print(f"  ✓ Archivé : {archive_path.name}")
    summary["archive_path"] = str(archive_path)

    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("filename", help="Nom du fichier source dans data/imports/operations/")
    parser.add_argument("--dry-run", action="store_true", help="Analyse sans écrire")
    parser.add_argument("--yes", action="store_true", help="Skip la confirmation interactive")
    args = parser.parse_args()

    print(f"\n=== Split multi-month pour : {args.filename} ===\n")

    # Phase 1 : plan
    plan = plan_split(args.filename)
    print(f"Total ops dans le fichier source : {plan['total_ops']}")
    if plan["undated_count"]:
        print(f"⚠ {plan['undated_count']} ops sans date valide (resteront dans le fichier — non reloquées)")
    print(f"\nRépartition par mois :")
    for ym, info in sorted(plan["splits"].items()):
        print(f"  {ym} : {info['count']} ops → {info['target_filename']}")

    ged_impacted = collect_ged_refs_impact(args.filename)
    ocr_impacted = collect_ocr_refs_impact(args.filename)
    print(f"\nRéférences à mettre à jour :")
    print(f"  GED metadata : {len(ged_impacted)} entrée(s)")
    print(f"  .ocr.json    : {len(ocr_impacted)} fichier(s)")

    if args.dry_run:
        print("\n--- DRY RUN ---")
        apply_split(plan, dry_run=True)
        print("\n[DRY] Aucune modification écrite.")
        return 0

    if not args.yes:
        print("\nConfirmer l'exécution ? Tapez 'oui' :")
        resp = input().strip().lower()
        if resp != "oui":
            print("Annulé.")
            return 1

    print("\n--- EXÉCUTION ---")
    summary = apply_split(plan, dry_run=False)
    print("\n=== Terminé ===")
    print(f"Fichiers créés : {len(summary['files_created'])}")
    print(f"GED mis à jour : {summary['ged_updated']}")
    print(f"OCR mis à jour : {summary['ocr_updated']}")
    print(f"Archive : {summary['archive_path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
