"""
One-shot CLI : scanne le dossier justificatifs et répare les incohérences
disque ↔ opérations (duplicatas, orphelins, liens fantômes).

Thin wrapper autour de `backend.services.justificatif_service.scan_link_issues`
et `apply_link_repair`. La même logique est exposée via :
  - GET /api/justificatifs/scan-links (dry-run)
  - POST /api/justificatifs/repair-links (apply)
  - Appel automatique au démarrage du backend (lifespan, silencieux + logs)

Usage :
    python3 scripts/repair_justificatif_links.py --dry-run
    python3 scripts/repair_justificatif_links.py
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.services import justificatif_service  # noqa: E402


def print_plan(plan: dict) -> None:
    s = plan["scanned"]
    print(f"Scan : {s['traites']} traites, {s['attente']} en_attente, {s['op_refs']} liens op")

    def show(header: str, items: list, formatter=lambda i: i["name"]) -> None:
        print(f"\n=== {header} ({len(items)}) ===")
        for item in items:
            print(f"  {formatter(item)}")

    show(
        "A1. Duplicatas en_attente/ (hash identique à la copie traites/)",
        plan["duplicates_to_delete_attente"],
        lambda i: f"{i['name']}  (ref={i['refs']}, hash={i['hash'][:8]})",
    )
    show(
        "A2. Misplaced : en_attente/ → traites/",
        plan["misplaced_to_move_to_traites"],
        lambda i: f"{i['name']}  (ref={i['refs']})",
    )
    show(
        "B1. Orphelins duplicatas dans traites/",
        plan["orphans_to_delete_traites"],
        lambda i: f"{i['name']}  (hash={i['hash'][:8]})",
    )
    show(
        "B2. Orphelins : traites/ → en_attente/",
        plan["orphans_to_move_to_attente"],
    )
    show(
        "C. Liens fantômes (fichier absent)",
        plan["ghost_refs"],
        lambda i: f"{i['op_file']}[{i['op_idx']}] → {i['name']}",
    )
    show(
        "[SKIP] Conflits de hashes (inspection manuelle requise)",
        plan["hash_conflicts"],
        lambda i: f"{i['name']} (attente={i['hash_attente'][:8]} vs traites={i['hash_traites'][:8]})",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Scan seulement, sans modification")
    args = parser.parse_args()

    if args.dry_run:
        print("*** DRY-RUN : aucune modification effectuée ***\n")

    plan = justificatif_service.scan_link_issues()
    print_plan(plan)

    if args.dry_run:
        print("\nRelance sans --dry-run pour appliquer.")
        return

    result = justificatif_service.apply_link_repair(plan=plan)
    print("\n=== Résultat ===")
    print(f"  deleted_from_attente : {result['deleted_from_attente']}")
    print(f"  moved_to_traites     : {result['moved_to_traites']}")
    print(f"  deleted_from_traites : {result['deleted_from_traites']}")
    print(f"  moved_to_attente     : {result['moved_to_attente']}")
    print(f"  ghost_refs_cleared   : {result['ghost_refs_cleared']}")
    print(f"  conflicts_skipped    : {result['conflicts_skipped']}")
    if result["errors"]:
        print(f"\n  ERREURS ({len(result['errors'])}):")
        for e in result["errors"]:
            print(f"    {e}")


if __name__ == "__main__":
    main()
