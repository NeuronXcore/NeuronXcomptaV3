"""Fusionne les fichiers d'opérations qui se chevauchent pour un mois donné.

Raison : suite au split d'un fichier multi-mois, plusieurs fichiers peuvent maintenant exister
pour le même mois. Le mode "Toute l'année" charge tous ces fichiers en parallèle sans dédup,
provoquant des doublons d'ops dans l'éditeur, les exports, les analytics.

Algorithme par mois (pour chaque mois ayant ≥ 2 fichiers) :
  1. Charger les N fichiers
  2. Hash chaque op : (Date, Libellé.strip, Débit, Crédit)
  3. Pour chaque hash : si présent dans plusieurs fichiers, garder la version la plus enrichie
     (heuristique : nb de champs métadonnées non-vides)
  4. Trier par Date ascendant
  5. Écrire dans operations_merged_YYYYMM_<ts>.json
  6. Updater les refs operation_index dans GED metadata + .ocr.json
  7. Archiver les fichiers sources

Usage :
    python scripts/merge_overlapping_monthly_files.py --year 2025 --dry-run
    python scripts/merge_overlapping_monthly_files.py --year 2025 --yes
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OPS_DIR = PROJECT_ROOT / "data" / "imports" / "operations"
ARCHIVE_DIR = OPS_DIR / "_archive"
GED_METADATA_FILE = PROJECT_ROOT / "data" / "ged" / "ged_metadata.json"
JUSTIFS_TRAITES = PROJECT_ROOT / "data" / "justificatifs" / "traites"
JUSTIFS_EN_ATTENTE = PROJECT_ROOT / "data" / "justificatifs" / "en_attente"


def load_json(path: Path) -> object:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def op_hash(op: dict) -> tuple:
    """Identité op : Date + Libellé strip + Débit + Crédit (en float pour stabilité)."""
    return (
        str(op.get("Date", "")).strip(),
        str(op.get("Libellé", "")).strip(),
        float(op.get("Débit", 0) or 0),
        float(op.get("Crédit", 0) or 0),
    )


def enrichment_score(op: dict) -> int:
    """Plus le score est élevé, plus l'op est riche en métadonnées éditées."""
    cat = (op.get("Catégorie") or "").strip()
    return (
        (1 if cat and cat not in ("Autres",) else 0)
        + (1 if (op.get("Sous-catégorie") or "").strip() else 0)
        + (1 if op.get("Justificatif") else 0)
        + (1 if (op.get("Lien justificatif") or "").strip() else 0)
        + (1 if op.get("locked") else 0)
        + (1 if (op.get("Commentaire") or "").strip() else 0)
        + (1 if op.get("Important") else 0)
        + (1 if op.get("A_revoir") else 0)
        + (1 if op.get("ventilation") else 0)
        + (1 if (op.get("rapprochement_mode") or "").strip() else 0)
        + (1 if op.get("alertes") else 0)
        + (1 if op.get("lettre") else 0)
    )


def file_dominant_month(filepath: Path) -> Optional[tuple[int, int]]:
    """Retourne (year, month) dominant des dates dans le fichier, ou None si vide/invalide."""
    try:
        ops = load_json(filepath)
    except Exception:
        return None
    if not isinstance(ops, list) or not ops:
        return None
    counts: dict[tuple[int, int], int] = defaultdict(int)
    for op in ops:
        d = (op.get("Date") or "").strip()
        if len(d) >= 7:
            try:
                y = int(d[:4]); m = int(d[5:7])
                counts[(y, m)] += 1
            except ValueError:
                continue
    if not counts:
        return None
    return max(counts.items(), key=lambda kv: kv[1])[0]


def group_files_by_month(year: int) -> dict[int, list[Path]]:
    """Retourne {month: [filepath, ...]} pour les fichiers ops du dossier dont le mois dominant matche year."""
    grouped: dict[int, list[Path]] = defaultdict(list)
    for f in sorted(OPS_DIR.iterdir()):
        if f.suffix != ".json" or f.name.startswith("_"):
            continue
        ym = file_dominant_month(f)
        if ym is None:
            continue
        y, m = ym
        if y == year:
            grouped[m].append(f)
    return grouped


def merge_month_files(filepaths: list[Path]) -> tuple[list[dict], dict[tuple[str, int], tuple[str, int]]]:
    """Fusionne N fichiers en une liste d'ops dédupliquée et triée par Date.

    Retourne :
      - merged_ops : la liste finale
      - reindex_map : {(old_filename, old_index): (new_filename_TBD, new_index)}
        new_filename est filled-in plus tard, on retourne new_index seulement (la clé sera updated par l'appelant).
    """
    # Charger toutes les ops avec leur source
    all_ops_with_origin: list[tuple[Path, int, dict]] = []
    for fp in filepaths:
        ops = load_json(fp)
        if not isinstance(ops, list):
            continue
        for idx, op in enumerate(ops):
            all_ops_with_origin.append((fp, idx, op))

    # Grouper par hash, garder la version la plus enrichie
    by_hash: dict[tuple, list[tuple[Path, int, dict]]] = defaultdict(list)
    for fp, idx, op in all_ops_with_origin:
        by_hash[op_hash(op)].append((fp, idx, op))

    # Pour chaque hash, choisir la version winner
    winners: list[tuple[Path, int, dict]] = []  # (origin_file, origin_index, op_dict)
    for h, candidates in by_hash.items():
        if len(candidates) == 1:
            winners.append(candidates[0])
        else:
            # Trier par enrichment_score desc, puis filename asc (stable : préfère mensuel pré-existant qui n'a pas "split" dans le nom)
            ranked = sorted(
                candidates,
                key=lambda t: (-enrichment_score(t[2]), "split" in t[0].name, t[0].name),
            )
            winners.append(ranked[0])

    # Trier par Date asc
    winners.sort(key=lambda t: (t[2].get("Date") or "", t[2].get("Libellé") or ""))

    # Construire merged_ops + reindex_map (par origine)
    merged_ops = [t[2] for t in winners]
    reindex_map: dict[tuple[str, int], tuple[str, int]] = {}
    for new_idx, (origin_fp, origin_old_idx, _op) in enumerate(winners):
        # On note l'origine — le new_filename sera attribué par l'appelant
        reindex_map[(origin_fp.name, origin_old_idx)] = ("__PLACEHOLDER__", new_idx)
    # On signale aussi les "perdants" : ces ops ne survivent pas, leurs refs doivent pointer vers le winner du même hash
    winner_hash_to_new_idx: dict[tuple, int] = {}
    for new_idx, (_fp, _idx, op) in enumerate(winners):
        winner_hash_to_new_idx[op_hash(op)] = new_idx
    for fp, idx, op in all_ops_with_origin:
        h = op_hash(op)
        new_idx = winner_hash_to_new_idx.get(h)
        if new_idx is not None:
            reindex_map[(fp.name, idx)] = ("__PLACEHOLDER__", new_idx)

    return merged_ops, reindex_map


def collect_ged_refs_impact(source_filenames: set[str]) -> list[dict]:
    """Format réel observé : entry.operation_ref = {file, index, ventilation_index?}."""
    if not GED_METADATA_FILE.exists():
        return []
    raw = load_json(GED_METADATA_FILE)
    if not isinstance(raw, dict):
        return []
    docs = raw.get("documents", raw) if "documents" in raw else raw
    if not isinstance(docs, dict):
        return []
    impacted = []
    for doc_id, entry in docs.items():
        if not isinstance(entry, dict):
            continue
        ref = entry.get("operation_ref") or {}
        if isinstance(ref, dict) and ref.get("file") in source_filenames:
            impacted.append({
                "doc_id": doc_id,
                "old_file": ref.get("file"),
                "old_index": ref.get("index"),
            })
    return impacted


def collect_ocr_refs_impact(source_filenames: set[str]) -> list[Path]:
    """Format réel observé : data.operation_ref = {file, index, ventilation_index?}."""
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
            if isinstance(ref, dict) and ref.get("file") in source_filenames:
                impacted.append(ocr_file)
    return impacted


def recover_orphan_refs_to_archived(dry_run: bool, all_merged_plans: list[dict]) -> int:
    """Répare les refs GED+OCR qui pointent vers des fichiers archivés (i.e. déjà déplacés vers _archive/).

    Pour chaque ref orpheline, charge l'archive correspondante, retrouve l'op via index,
    hash-la, et cherche le winner ayant le même hash dans les fichiers mergés courants.
    Retourne le nb de refs réparées.
    """
    if not GED_METADATA_FILE.exists():
        return 0
    raw = load_json(GED_METADATA_FILE)
    docs = raw.get("documents", raw) if "documents" in raw else raw
    if not isinstance(docs, dict):
        return 0

    # Récolter les refs orphelines (file dans _archive/ ou inexistant)
    orphans = []
    for doc_id, entry in docs.items():
        if not isinstance(entry, dict):
            continue
        ref = entry.get("operation_ref") or {}
        if not isinstance(ref, dict):
            continue
        f = ref.get("file")
        if not f:
            continue
        # Existe-t-il dans OPS_DIR ? Non = orphelin
        if not (OPS_DIR / f).exists():
            orphans.append({"doc_id": doc_id, "old_file": f, "old_index": ref.get("index")})

    # Pareillement pour OCR
    ocr_orphans = []
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
            if not isinstance(ref, dict):
                continue
            f = ref.get("file")
            if not f:
                continue
            if not (OPS_DIR / f).exists():
                ocr_orphans.append({"path": ocr_file, "old_file": f, "old_index": ref.get("index")})

    if not orphans and not ocr_orphans:
        return 0

    print(f"\n  Orphelins détectés : {len(orphans)} GED + {len(ocr_orphans)} OCR")

    # Construire un index hash → (new_file, new_index) à partir des fichiers actifs (mergés inclus)
    hash_to_new: dict[tuple, tuple[str, int]] = {}
    # Inclure les fichiers mergés en cours (s'ils sont écrits) + tous les fichiers actuels
    active_files = []
    if not dry_run:
        # Après l'écriture des merged files, ils sont sur disque
        active_files = [p for p in OPS_DIR.iterdir() if p.suffix == ".json" and not p.name.startswith("_")]
    else:
        # En dry-run, simuler avec les merged_ops en mémoire
        for plan in all_merged_plans:
            for new_idx, op in enumerate(plan["merged_ops"]):
                hash_to_new[op_hash(op)] = (plan["target_name"], new_idx)
        # + les fichiers existants qui ne sont pas dans les sources à archiver
        sources_to_archive = {fp.name for plan in all_merged_plans for fp in plan["sources"]}
        for fp in OPS_DIR.iterdir():
            if fp.suffix != ".json" or fp.name.startswith("_") or fp.name in sources_to_archive:
                continue
            try:
                ops = load_json(fp)
            except Exception:
                continue
            if isinstance(ops, list):
                for idx, op in enumerate(ops):
                    hash_to_new.setdefault(op_hash(op), (fp.name, idx))
    if active_files:
        for fp in active_files:
            try:
                ops = load_json(fp)
            except Exception:
                continue
            if isinstance(ops, list):
                for idx, op in enumerate(ops):
                    hash_to_new.setdefault(op_hash(op), (fp.name, idx))

    # Pour chaque orphelin : charger l'archive, récupérer l'op à l'index, hasher, retrouver le new
    repaired = 0
    for o in orphans:
        archive_pattern = list(ARCHIVE_DIR.glob(f"{o['old_file']}.bak_*"))
        if not archive_pattern:
            continue
        try:
            ops = load_json(archive_pattern[0])
        except Exception:
            continue
        idx = o["old_index"]
        if idx is None or not isinstance(ops, list) or not (0 <= idx < len(ops)):
            continue
        h = op_hash(ops[idx])
        new = hash_to_new.get(h)
        if new is None:
            continue
        new_file, new_idx = new
        if not dry_run:
            docs[o["doc_id"]]["operation_ref"]["file"] = new_file
            docs[o["doc_id"]]["operation_ref"]["index"] = new_idx
        repaired += 1

    if not dry_run and repaired > 0:
        save_json(GED_METADATA_FILE, raw)

    repaired_ocr = 0
    for o in ocr_orphans:
        archive_pattern = list(ARCHIVE_DIR.glob(f"{o['old_file']}.bak_*"))
        if not archive_pattern:
            continue
        try:
            ops = load_json(archive_pattern[0])
        except Exception:
            continue
        idx = o["old_index"]
        if idx is None or not isinstance(ops, list) or not (0 <= idx < len(ops)):
            continue
        h = op_hash(ops[idx])
        new = hash_to_new.get(h)
        if new is None:
            continue
        new_file, new_idx = new
        if not dry_run:
            data = load_json(o["path"])
            data["operation_ref"]["file"] = new_file
            data["operation_ref"]["index"] = new_idx
            save_json(o["path"], data)
        repaired_ocr += 1

    print(f"  {'[DRY]' if dry_run else '✓'} Orphelins réparés : {repaired} GED, {repaired_ocr} OCR")
    return repaired + repaired_ocr


def process_year(year: int, dry_run: bool, yes: bool) -> int:
    print(f"\n=== Merge des fichiers chevauchants pour {year} ===\n")
    grouped = group_files_by_month(year)
    if not grouped:
        print(f"Aucun fichier trouvé pour {year}.")
        return 0

    overlapping_months = {m: files for m, files in grouped.items() if len(files) >= 2}
    if not overlapping_months:
        print(f"Aucun mois en doublon pour {year}. Rien à faire.")
        return 0

    print(f"Mois avec doublons : {sorted(overlapping_months.keys())}\n")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    plans: list[dict] = []

    for m in sorted(overlapping_months.keys()):
        files = sorted(overlapping_months[m])
        merged, partial_reindex = merge_month_files(files)
        target_name = f"operations_merged_{year}{m:02d}_{ts}.json"
        # Patch placeholder filename
        full_reindex = {k: (target_name, v[1]) for k, v in partial_reindex.items()}
        plans.append({
            "month": m,
            "sources": files,
            "merged_count": len(merged),
            "merged_ops": merged,
            "target_name": target_name,
            "reindex": full_reindex,
        })
        total_in = sum(len(load_json(f)) if isinstance(load_json(f), list) else 0 for f in files)
        deduped = total_in - len(merged)
        print(
            f"  Mois {m:02d} : {len(files)} fichiers ({total_in} ops) → {len(merged)} ops "
            f"(dédupliquées : {deduped}) → {target_name}"
        )

    # Collecter refs impactées (toutes les sources cumulées)
    all_sources_names = {fp.name for plan in plans for fp in plan["sources"]}
    ged_impacted = collect_ged_refs_impact(all_sources_names)
    ocr_impacted = collect_ocr_refs_impact(all_sources_names)
    print(f"\nRéférences à mettre à jour :")
    print(f"  GED metadata : {len(ged_impacted)} entrée(s)")
    print(f"  .ocr.json    : {len(ocr_impacted)} fichier(s)")

    if dry_run:
        recover_orphan_refs_to_archived(dry_run=True, all_merged_plans=plans)
        print("\n[DRY RUN] Aucune modification écrite.")
        return 0

    if not yes:
        print("\nConfirmer l'exécution ? Tapez 'oui' :")
        if input().strip().lower() != "oui":
            print("Annulé.")
            return 1

    print("\n--- EXÉCUTION ---")
    # 1. Écrire les nouveaux fichiers mergés
    for plan in plans:
        target = OPS_DIR / plan["target_name"]
        save_json(target, plan["merged_ops"])
        print(f"  ✓ Créé : {target.name} ({plan['merged_count']} ops)")

    # 2. Construire le mapping global old(file,index) → new(file,index)
    global_reindex: dict[tuple[str, int], tuple[str, int]] = {}
    for plan in plans:
        for k, v in plan["reindex"].items():
            global_reindex[k] = v

    # 3. Update GED metadata (clés réelles : file/index)
    if ged_impacted:
        raw = load_json(GED_METADATA_FILE)
        docs = raw.get("documents", raw) if "documents" in raw else raw
        ged_count = 0
        for item in ged_impacted:
            doc_id = item["doc_id"]
            old_file = item["old_file"]
            old_idx = item["old_index"]
            if old_idx is None:
                continue
            new = global_reindex.get((old_file, old_idx))
            if new is None:
                continue
            new_file, new_idx = new
            docs[doc_id]["operation_ref"]["file"] = new_file
            docs[doc_id]["operation_ref"]["index"] = new_idx
            ged_count += 1
        save_json(GED_METADATA_FILE, raw)
        print(f"  ✓ GED metadata : {ged_count} entrée(s) rebindée(s)")

    # 4. Update OCR refs (clés réelles : file/index)
    ocr_count = 0
    for ocr_path in ocr_impacted:
        try:
            data = load_json(ocr_path)
        except Exception:
            continue
        ref = data.get("operation_ref") or {}
        old_file = ref.get("file")
        old_idx = ref.get("index")
        if old_idx is None:
            continue
        new = global_reindex.get((old_file, old_idx))
        if new is None:
            continue
        new_file, new_idx = new
        data["operation_ref"]["file"] = new_file
        data["operation_ref"]["index"] = new_idx
        save_json(ocr_path, data)
        ocr_count += 1
    if ocr_impacted:
        print(f"  ✓ .ocr.json : {ocr_count} fichier(s) rebindé(s)")

    # 5. Archiver les sources
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    for plan in plans:
        for fp in plan["sources"]:
            archive_path = ARCHIVE_DIR / f"{fp.name}.bak_{ts}"
            shutil.move(str(fp), str(archive_path))
    archived_count = sum(len(plan["sources"]) for plan in plans)
    print(f"  ✓ Archivé : {archived_count} fichier(s) source(s) dans _archive/")

    # 6. Recovery des orphelins (refs vers fichiers déjà archivés précédemment)
    recover_orphan_refs_to_archived(dry_run=False, all_merged_plans=plans)

    print(f"\n=== Terminé ===")
    print(f"Mois consolidés : {len(plans)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, required=True, help="Année à traiter (ex. 2025)")
    parser.add_argument("--dry-run", action="store_true", help="Analyse sans écrire")
    parser.add_argument("--yes", action="store_true", help="Skip la confirmation interactive")
    args = parser.parse_args()
    return process_year(args.year, dry_run=args.dry_run, yes=args.yes)


if __name__ == "__main__":
    sys.exit(main())
