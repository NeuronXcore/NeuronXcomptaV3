"""Déduplique les ops mal placées entre fichiers mensuels.

Cas typique : op du 29/04 dupliquée à la fois dans operations_merged_202504 (fichier
correct, version associée+lockée) et operations_merged_202505 (mal placée, version vide).

Algorithme :
  1. Pour chaque fichier mensuel canonique (operations_{merged|split}_YYYYMM_*.json),
     identifier les ops dont Date.YYYY-MM ≠ YYYYMM du filename = "ops mal placées".
  2. Pour chaque op mal placée, chercher un duplicat (par hash op-identité)
     dans le fichier dont le filename correspond à Date.YYYY-MM = "fichier correct".
  3. Si duplicat trouvé : comparer enrichment_score.
     - Garder la version du fichier correct.
     - Si la version mal placée a des champs enrichis manquants côté correct,
       merger ces champs (Catégorie, Justificatif, Lien justificatif, locked, etc.).
     - Supprimer la version mal placée.
     - Remapper les refs GED + .ocr.json (misplaced_file, misplaced_idx) →
       (correct_file, correct_idx).
  4. Si pas de duplicat : laisser l'op telle quelle (mal placée mais unique — sera traitée
     manuellement, probablement bug d'import à investiguer).
  5. Réindexer les ops survivantes dans les fichiers modifiés (suppression
     décale les indices des ops suivantes).
  6. Archiver les fichiers source modifiés dans data/imports/operations/_archive/.

Usage :
    python scripts/dedup_cross_month_files.py            # DRY-RUN par défaut
    python scripts/dedup_cross_month_files.py --yes      # APPLIQUER
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

# Réutilise les helpers de merge_overlapping_monthly_files
sys.path.insert(0, str(Path(__file__).resolve().parent))
from merge_overlapping_monthly_files import (  # type: ignore
    op_hash,
    enrichment_score,
    load_json,
    save_json,
    OPS_DIR,
    ARCHIVE_DIR,
    GED_METADATA_FILE,
    JUSTIFS_TRAITES,
    JUSTIFS_EN_ATTENTE,
)

FILENAME_YM_RE = re.compile(r"_(?:merged|split)_(\d{4})(\d{2})_")

# Champs à fusionner du mal placé vers le correct si le correct est moins enrichi
MERGEABLE_FIELDS_TEXT = (
    "Catégorie",
    "Sous-catégorie",
    "Lien justificatif",
    "Commentaire",
    "rapprochement_mode",
    "locked_at",
)
MERGEABLE_FIELDS_BOOL = ("Justificatif", "locked", "Important", "A_revoir", "lettre")
MERGEABLE_FIELDS_OBJ = ("ventilation", "alertes")


def parse_filename_year_month(filename: str) -> Optional[tuple[int, int]]:
    m = FILENAME_YM_RE.search(filename)
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)))


def build_target_to_files() -> dict[tuple[int, int], list[Path]]:
    grouped: dict[tuple[int, int], list[Path]] = defaultdict(list)
    for f in sorted(OPS_DIR.iterdir()):
        if f.suffix != ".json" or f.name.startswith("_"):
            continue
        ym = parse_filename_year_month(f.name)
        if ym:
            grouped[ym].append(f)
    return grouped


def merge_enriched_fields(correct_op: dict, misplaced_op: dict) -> tuple[dict, list[str]]:
    """Copie les champs enrichis manquants côté correct depuis misplaced.

    Retourne (correct_op_modifié, [champs_modifiés]).
    """
    modified_fields = []
    out = dict(correct_op)

    for f in MERGEABLE_FIELDS_TEXT:
        cur = (out.get(f) or "").strip() if isinstance(out.get(f), str) else out.get(f)
        mis = (misplaced_op.get(f) or "").strip() if isinstance(misplaced_op.get(f), str) else misplaced_op.get(f)
        if not cur and mis:
            out[f] = misplaced_op[f]
            modified_fields.append(f)
        elif f == "Catégorie" and cur in ("Autres",) and mis and mis not in ("Autres", ""):
            out[f] = misplaced_op[f]
            modified_fields.append(f)

    for f in MERGEABLE_FIELDS_BOOL:
        if not out.get(f) and misplaced_op.get(f):
            out[f] = misplaced_op[f]
            modified_fields.append(f)

    for f in MERGEABLE_FIELDS_OBJ:
        if not out.get(f) and misplaced_op.get(f):
            out[f] = misplaced_op[f]
            modified_fields.append(f)

    return out, modified_fields


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--yes", action="store_true", help="Appliquer les changements (sinon dry-run).")
    args = parser.parse_args()
    dry_run = not args.yes

    print(f"Mode : {'DRY-RUN' if dry_run else 'APPLIQUER'}")
    print(f"Cwd  : {OPS_DIR}")
    print()

    # 1) Index fichiers par mois cible (filename)
    target_to_files = build_target_to_files()
    file_to_ym: dict[Path, tuple[int, int]] = {}
    for ym, files in target_to_files.items():
        for f in files:
            file_to_ym[f] = ym
    print(f"Fichiers mensuels canoniques détectés : {len(file_to_ym)}")

    # 2) Charger toutes les ops, identifier les mal placées
    file_ops: dict[Path, list[dict]] = {}
    misplaced: list[dict] = []  # [{file, idx, op, date_ym}]
    for filepath, (fy, fm) in file_to_ym.items():
        try:
            ops = load_json(filepath)
        except Exception:
            continue
        if not isinstance(ops, list):
            continue
        file_ops[filepath] = ops
        target_str = f"{fy:04d}-{fm:02d}"
        for idx, op in enumerate(ops):
            d = (op.get("Date") or "")[:7]
            if d and d != target_str:
                misplaced.append({"file": filepath, "idx": idx, "op": op, "date_ym": d})

    print(f"Ops mal placées : {len(misplaced)}")

    # 3) Construire l'index hash → [(file, idx, op)] pour TOUTES les ops
    all_index: dict[tuple, list[tuple[Path, int, dict]]] = defaultdict(list)
    for filepath, ops in file_ops.items():
        for idx, op in enumerate(ops):
            all_index[op_hash(op)].append((filepath, idx, op))

    # 4) Pour chaque op mal placée : chercher un duplicat dans le fichier correct
    plan_remove: dict[Path, list[tuple[int, Path, int]]] = defaultdict(list)  # misplaced_file → [(idx, correct_file, correct_idx)]
    plan_merge: list[dict] = []  # [{correct_file, correct_idx, fields_to_set, source_op}]
    uniques_misplaced: list[dict] = []

    for m in misplaced:
        h = op_hash(m["op"])
        try:
            target_ym = tuple(int(x) for x in m["date_ym"].split("-"))
        except (ValueError, TypeError):
            uniques_misplaced.append(m)
            continue
        correct_files = target_to_files.get(target_ym, [])

        # Chercher un duplicat dans le fichier correct
        correct_match = None
        for fp, idx, cop in all_index[h]:
            if fp == m["file"] and idx == m["idx"]:
                continue
            if fp in correct_files:
                correct_match = (fp, idx, cop)
                break

        if correct_match is None:
            uniques_misplaced.append(m)
            continue

        cf, cidx, cop = correct_match
        e_misplaced = enrichment_score(m["op"])
        e_correct = enrichment_score(cop)

        # Toujours garder la version dans le fichier correct.
        # Si misplaced a des champs enrichis manquants → merge.
        if e_misplaced > e_correct:
            merged_op, modified_fields = merge_enriched_fields(cop, m["op"])
            if modified_fields:
                plan_merge.append({
                    "correct_file": cf, "correct_idx": cidx,
                    "merged_op": merged_op, "modified_fields": modified_fields,
                })
        plan_remove[m["file"]].append((m["idx"], cf, cidx))

    # 5) Statistiques
    n_dup = sum(len(v) for v in plan_remove.values())
    n_merge = len(plan_merge)
    print(f"Doublons à supprimer : {n_dup}")
    print(f"Merges enrichis (correct-file op à enrichir) : {n_merge}")
    print(f"Uniques mal placés (non touchés — bug import à investiguer) : {len(uniques_misplaced)}")
    print()

    # 6) Affichage du plan détaillé
    print("=== PLAN — Suppressions (dans le fichier mal placé) ===")
    for mfile in sorted(plan_remove.keys()):
        items = plan_remove[mfile]
        print(f"\n  {mfile.name} : {len(items)} ops à supprimer")
        for misplaced_idx, cf, cidx in sorted(items):
            op = file_ops[mfile][misplaced_idx]
            d = op.get("Date", "")
            lib = (op.get("Libellé") or "")[:50]
            mlock = "🔒" if op.get("locked") else " "
            mjust = "📎" if op.get("Lien justificatif") else " "
            print(f"    {mlock}{mjust} [idx {misplaced_idx:>3}] {d} {lib}  →  garde {cf.name}[{cidx}]")

    if plan_merge:
        print()
        print("=== PLAN — Merges enrichis (champs ajoutés au correct depuis le mal placé) ===")
        for m in plan_merge:
            cf = m["correct_file"].name
            print(f"  {cf}[{m['correct_idx']}] : ajout des champs {m['modified_fields']}")

    if uniques_misplaced:
        print()
        print("=== INFO — Ops uniques mal placées (non touchées) ===")
        for u in uniques_misplaced:
            d = u["op"].get("Date", "")
            lib = (u["op"].get("Libellé") or "")[:50]
            mlock = "🔒" if u["op"].get("locked") else " "
            mjust = "📎" if u["op"].get("Lien justificatif") else " "
            print(f"  {mlock}{mjust} {u['file'].name}[{u['idx']:>3}] {d} {lib}")

    if dry_run:
        print()
        print("─" * 80)
        print("DRY-RUN terminé. Aucune modification appliquée.")
        print("Relance avec `--yes` pour appliquer.")
        return

    # 7) APPLY : merges puis suppressions, avec reindex map
    print()
    print("─" * 80)
    print("APPLICATION")

    # Step 7a : appliquer les merges enrichis sur les fichiers correct (pas de reindex requis)
    files_to_save: dict[Path, list[dict]] = {}
    for m in plan_merge:
        cf = m["correct_file"]
        if cf not in files_to_save:
            files_to_save[cf] = list(file_ops[cf])
        files_to_save[cf][m["correct_idx"]] = m["merged_op"]
        print(f"  merge: {cf.name}[{m['correct_idx']}] += {m['modified_fields']}")

    # Step 7b : pour chaque misplaced_file, retirer les indices à supprimer (du plus grand au plus petit)
    # et construire un reindex_map (old_idx_in_misplaced → new_idx_in_misplaced) pour les ops survivantes,
    # ET un redirect map (misplaced_file, old_idx) → (correct_file, correct_idx) pour les ops supprimées.
    redirect_refs: dict[tuple[str, int], tuple[str, int]] = {}
    reindex_refs: dict[tuple[str, int], tuple[str, int]] = {}

    for mfile, items in plan_remove.items():
        ops_current = files_to_save.get(mfile, list(file_ops[mfile]))
        indices_to_remove = sorted({idx for idx, _cf, _ci in items}, reverse=True)
        # Build redirect map for removed indices
        item_by_idx = {idx: (cf, ci) for idx, cf, ci in items}
        for old_idx in indices_to_remove:
            cf, ci = item_by_idx[old_idx]
            redirect_refs[(mfile.name, old_idx)] = (cf.name, ci)
        # Build reindex map for survivors (their new index after removals)
        survivors: list[dict] = []
        for old_idx, op in enumerate(ops_current):
            if old_idx in set(indices_to_remove):
                continue
            new_idx = len(survivors)
            survivors.append(op)
            if old_idx != new_idx:
                reindex_refs[(mfile.name, old_idx)] = (mfile.name, new_idx)
        files_to_save[mfile] = survivors
        print(f"  remove: {mfile.name} ({len(indices_to_remove)} ops supprimées, {len(survivors)} survivants)")

    # Step 7c : archiver les fichiers source modifiés et écrire les nouveaux
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    for fp, new_ops in files_to_save.items():
        backup = ARCHIVE_DIR / f"{fp.name}.bak_{ts}"
        shutil.copy2(fp, backup)
        save_json(fp, new_ops)
        print(f"  saved {fp.name} ({len(new_ops)} ops, archive {backup.name})")

    # Step 7d : updater GED metadata
    if GED_METADATA_FILE.exists():
        raw = load_json(GED_METADATA_FILE)
        docs = raw.get("documents", raw) if isinstance(raw, dict) and "documents" in raw else raw
        ged_updated = 0
        if isinstance(docs, dict):
            for doc_id, entry in docs.items():
                if not isinstance(entry, dict):
                    continue
                ref = entry.get("operation_ref") or {}
                if not isinstance(ref, dict):
                    continue
                key = (ref.get("file"), ref.get("index"))
                if key[0] is None or key[1] is None:
                    continue
                if key in redirect_refs:
                    new_file, new_idx = redirect_refs[key]
                    ref["file"] = new_file
                    ref["index"] = new_idx
                    entry["operation_ref"] = ref
                    ged_updated += 1
                elif key in reindex_refs:
                    new_file, new_idx = reindex_refs[key]
                    ref["file"] = new_file
                    ref["index"] = new_idx
                    entry["operation_ref"] = ref
                    ged_updated += 1
        if ged_updated:
            save_json(GED_METADATA_FILE, raw)
            print(f"  GED metadata: {ged_updated} refs updated")

    # Step 7e : updater .ocr.json refs
    ocr_updated = 0
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
            key = (ref.get("file"), ref.get("index"))
            if key[0] is None or key[1] is None:
                continue
            if key in redirect_refs:
                new_file, new_idx = redirect_refs[key]
                ref["file"] = new_file
                ref["index"] = new_idx
                data["operation_ref"] = ref
                save_json(ocr_file, data)
                ocr_updated += 1
            elif key in reindex_refs:
                new_file, new_idx = reindex_refs[key]
                ref["file"] = new_file
                ref["index"] = new_idx
                data["operation_ref"] = ref
                save_json(ocr_file, data)
                ocr_updated += 1
    if ocr_updated:
        print(f"  .ocr.json refs: {ocr_updated} updated")

    print()
    print("✅ Terminé.")


if __name__ == "__main__":
    main()
