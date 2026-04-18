"""Dédoublonne un fichier d'opérations (intra-fichier) + rebind GED/OCR refs.

Garde la version la plus enrichie (enrichment_score) pour chaque groupe de
doublons (hash op-identité : Date + Libellé.strip + Débit + Crédit). En cas
d'égalité de score, garde le premier indice rencontré.

Usage :
    python scripts/dedup_operations_file.py <filename> [--dry-run] [--yes]

Exemple :
    python scripts/dedup_operations_file.py operations_split_202501_20260414_233641.json --dry-run
    python scripts/dedup_operations_file.py operations_split_202501_20260414_233641.json --yes
"""
from __future__ import annotations

import argparse
import shutil
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from merge_overlapping_monthly_files import (  # type: ignore
    ARCHIVE_DIR,
    GED_METADATA_FILE,
    JUSTIFS_EN_ATTENTE,
    JUSTIFS_TRAITES,
    OPS_DIR,
    enrichment_score,
    load_json,
    op_hash,
    save_json,
)


def dedup_file(target: Path, dry_run: bool) -> dict:
    """Dédoublonne target et rebind refs. Retourne résumé dict."""
    ops = load_json(target)
    if not isinstance(ops, list):
        raise ValueError(f"{target.name} n'est pas une liste JSON")

    # Grouper par hash
    by_hash: dict[tuple, list[tuple[int, dict]]] = defaultdict(list)
    for idx, op in enumerate(ops):
        by_hash[op_hash(op)].append((idx, op))

    # Déterminer winners (max score, tie → premier indice)
    keep_indices: set[int] = set()
    drop_indices: list[int] = []
    dup_groups: list[dict] = []
    for h, lst in by_hash.items():
        if len(lst) == 1:
            keep_indices.add(lst[0][0])
            continue
        ranked = sorted(lst, key=lambda t: (-enrichment_score(t[1]), t[0]))
        winner_idx = ranked[0][0]
        losers = [t[0] for t in ranked[1:]]
        keep_indices.add(winner_idx)
        drop_indices.extend(losers)
        dup_groups.append({
            "hash": h,
            "winner_idx": winner_idx,
            "winner_score": enrichment_score(ranked[0][1]),
            "loser_indices": losers,
            "loser_scores": [enrichment_score(ops[i]) for i in losers],
        })

    # Nouvelle liste triée par date asc (stable pour libellé/montant)
    surviving = [(i, ops[i]) for i in sorted(keep_indices)]
    surviving.sort(key=lambda t: (
        str(t[1].get("Date") or ""),
        str(t[1].get("Libellé") or ""),
        float(t[1].get("Débit") or 0) + float(t[1].get("Crédit") or 0),
    ))
    new_ops = [t[1] for t in surviving]

    # Map : old_idx → new_idx (via hash, car les perdants pointent vers le winner)
    winner_hash_to_new: dict[tuple, int] = {}
    for new_idx, (_old, op) in enumerate(surviving):
        winner_hash_to_new[op_hash(op)] = new_idx
    reindex: dict[int, int] = {}
    for old_idx, op in enumerate(ops):
        new_idx = winner_hash_to_new.get(op_hash(op))
        if new_idx is not None:
            reindex[old_idx] = new_idx

    summary = {
        "target": target.name,
        "before": len(ops),
        "after": len(new_ops),
        "removed": len(drop_indices),
        "dup_groups": dup_groups,
        "reindex": reindex,
    }

    if dry_run:
        return summary

    # Archive original
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_path = ARCHIVE_DIR / f"{target.name}.bak_{ts}"
    shutil.copy2(target, archive_path)
    summary["archive"] = str(archive_path.relative_to(PROJECT_ROOT))

    # Écrire le fichier dédupliqué
    save_json(target, new_ops)

    # Rebind GED metadata
    ged_rebinds = 0
    if GED_METADATA_FILE.exists():
        raw = load_json(GED_METADATA_FILE)
        if isinstance(raw, dict):
            docs = raw.get("documents", raw) if "documents" in raw else raw
            if isinstance(docs, dict):
                changed = False
                for doc_id, entry in docs.items():
                    if not isinstance(entry, dict):
                        continue
                    ref = entry.get("operation_ref") or {}
                    if not isinstance(ref, dict):
                        continue
                    if ref.get("file") != target.name:
                        continue
                    old_idx = ref.get("index")
                    if old_idx is None:
                        continue
                    new_idx = reindex.get(old_idx)
                    if new_idx is not None and new_idx != old_idx:
                        ref["index"] = new_idx
                        ged_rebinds += 1
                        changed = True
                if changed:
                    save_json(GED_METADATA_FILE, raw)
    summary["ged_rebinds"] = ged_rebinds

    # Rebind .ocr.json
    ocr_rebinds = 0
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
            if ref.get("file") != target.name:
                continue
            old_idx = ref.get("index")
            if old_idx is None:
                continue
            new_idx = reindex.get(old_idx)
            if new_idx is not None and new_idx != old_idx:
                ref["index"] = new_idx
                save_json(ocr_file, data)
                ocr_rebinds += 1
    summary["ocr_rebinds"] = ocr_rebinds

    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("filename", help="Nom du fichier ops dans data/imports/operations/")
    ap.add_argument("--dry-run", action="store_true", help="N'écrit rien, résumé seulement")
    ap.add_argument("--yes", action="store_true", help="Applique sans prompt")
    args = ap.parse_args()

    target = OPS_DIR / args.filename
    if not target.exists():
        print(f"Fichier introuvable : {target}", file=sys.stderr)
        return 1

    # Dry-run d'abord
    dry = dedup_file(target, dry_run=True)
    print(f"\nFichier : {dry['target']}")
    print(f"Avant   : {dry['before']} ops")
    print(f"Après   : {dry['after']} ops ({dry['removed']} supprimées)")
    print(f"Groupes doublons : {len(dry['dup_groups'])}\n")

    for g in dry["dup_groups"]:
        h = g["hash"]
        print(f"  ▸ {h[0]} | {h[1][:55]:55} | Débit={h[2]:.2f} | Crédit={h[3]:.2f}")
        print(f"      gardé : [{g['winner_idx']}] score={g['winner_score']}")
        for loser_idx, loser_score in zip(g["loser_indices"], g["loser_scores"]):
            print(f"      retiré: [{loser_idx}] score={loser_score}")

    if args.dry_run:
        print("\n(dry-run — aucune modification)")
        return 0

    if not args.yes:
        print()
        resp = input("Appliquer ? [y/N] ")
        if resp.strip().lower() not in ("y", "yes", "o", "oui"):
            print("Annulé.")
            return 0

    result = dedup_file(target, dry_run=False)
    print(f"\n✓ {result['removed']} ops retirées, fichier écrit ({result['after']} ops)")
    print(f"  Archive : {result['archive']}")
    print(f"  GED rebinds : {result['ged_rebinds']}")
    print(f"  OCR rebinds : {result['ocr_rebinds']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
