"""
One-shot CLI : scanne data/justificatifs/en_attente/ et renomme les PDFs qui ne
respectent pas la convention `fournisseur_YYYYMMDD_montant.XX.pdf`.

Ce script est désormais un **thin wrapper** autour de `backend.services.rename_service`
qui contient toute la logique (partagée avec le post-OCR auto-rename et l'endpoint
`POST /api/justificatifs/scan-rename`).

Stratégie filename-first :
  1. Si le nom matche déjà la convention canonique → skip.
  2. Sinon, tente de parser le nom existant (source de vérité prioritaire).
  3. Sinon, fallback sur l'OCR (supplier filtré contre les mots vides).
  4. Applique via justificatif_service.rename_justificatif() qui met à jour :
       - le PDF
       - le .ocr.json (traçabilité renamed_from)
       - les associations dans les fichiers d'opérations
       - les métadonnées GED

Usage :
    python3 scripts/rename_justificatifs_convention.py --dry-run
    python3 scripts/rename_justificatifs_convention.py
    python3 scripts/rename_justificatifs_convention.py --apply-ocr      # applique aussi les renames OCR
    python3 scripts/rename_justificatifs_convention.py --force-generic  # garde les suppliers OCR douteux
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from backend.core.config import JUSTIFICATIFS_EN_ATTENTE_DIR, ensure_directories
from backend.services import justificatif_service, rename_service


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Liste les renames sans les appliquer")
    parser.add_argument("--force-generic", action="store_true", help="Conserve les renames même si supplier OCR douteux")
    parser.add_argument("--apply-ocr", action="store_true", help="Applique aussi les renames basés sur l'OCR")
    args = parser.parse_args()

    ensure_directories()

    plan = rename_service.scan_and_plan_renames(
        JUSTIFICATIFS_EN_ATTENTE_DIR, force_generic=args.force_generic
    )

    print(f"Scan de {plan['scanned']} PDF(s) dans {JUSTIFICATIFS_EN_ATTENTE_DIR}")
    print()

    print(f"  ✓ déjà canoniques               : {plan['already_canonical']}")
    print(f"  ✓ renames depuis le filename    : {len(plan['to_rename_from_name'])}  (SAFE)")
    print(f"  ⚠ renames depuis l'OCR          : {len(plan['to_rename_from_ocr'])}  (à REVIEW)")
    print(f"  ⚠ OCR manquant/échec            : {len(plan['skipped_no_ocr'])}")
    print(f"  ⚠ supplier OCR douteux          : {len(plan['skipped_bad_supplier'])}")
    print(f"  ⚠ date/montant OCR manquant     : {len(plan['skipped_no_date_amount'])}")
    print()

    if plan["to_rename_from_name"]:
        print("=== Renames SAFE (parsés depuis le filename) ===")
        for item in plan["to_rename_from_name"]:
            print(f"  {item['old']}")
            print(f"    → {item['new']}")

    if plan["to_rename_from_ocr"]:
        print()
        print("=== Renames OCR (filename non structuré — review recommandé) ===")
        for item in plan["to_rename_from_ocr"]:
            print(f"  {item['old']}")
            print(f"    → {item['new']}  (supplier OCR: {item['supplier_ocr']!r})")

    if plan["skipped_bad_supplier"]:
        print()
        print("=== Supplier OCR douteux (action manuelle requise) ===")
        for entry in plan["skipped_bad_supplier"]:
            print(f"  {entry['filename']} (supplier OCR='{entry['supplier']}')")

    if plan["skipped_no_ocr"]:
        print()
        print("=== OCR manquant ===")
        for name in plan["skipped_no_ocr"]:
            print(f"  {name}")

    if plan["skipped_no_date_amount"]:
        print()
        print("=== Date ou montant OCR manquant ===")
        for name in plan["skipped_no_date_amount"]:
            print(f"  {name}")

    total_to_rename = len(plan["to_rename_from_name"]) + len(plan["to_rename_from_ocr"])
    if args.dry_run:
        print()
        print("Dry run — aucun fichier modifié.")
        return 0

    if total_to_rename == 0:
        print()
        print("Rien à renommer.")
        return 0

    to_apply: list = list(plan["to_rename_from_name"])
    if args.apply_ocr:
        to_apply += plan["to_rename_from_ocr"]
    elif plan["to_rename_from_ocr"]:
        print()
        print(
            f"ℹ {len(plan['to_rename_from_ocr'])} rename(s) basés sur l'OCR sont ignorés. "
            "Utiliser --apply-ocr pour les appliquer aussi."
        )

    if not to_apply:
        print()
        print("Rien à appliquer.")
        return 0

    print()
    print(f"Application de {len(to_apply)} rename(s)…")
    ok = 0
    errors: list = []
    for item in to_apply:
        try:
            justificatif_service.rename_justificatif(item["old"], item["new"])
            print(f"  ✓ {item['old']} → {item['new']}")
            ok += 1
        except Exception as e:
            errors.append((item["old"], item["new"], str(e)))
            print(f"  ✗ {item['old']} → {item['new']} : {e}")

    print()
    print(f"Terminé : {ok}/{len(to_apply)} renommages OK")
    if errors:
        print(f"  {len(errors)} erreur(s)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
