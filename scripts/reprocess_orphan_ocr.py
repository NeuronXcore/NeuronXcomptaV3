"""
One-shot : pour chaque PDF dans data/justificatifs/en_attente/ qui n'a pas son
.ocr.json associé, lance l'extraction OCR via ocr_service.extract_from_pdf().

Usage :
    python3 scripts/reprocess_orphan_ocr.py
    python3 scripts/reprocess_orphan_ocr.py --filter uber    # uniquement les uber_*
    python3 scripts/reprocess_orphan_ocr.py --dry-run        # liste sans traiter
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

# Rendre le package backend importable
REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from backend.core.config import JUSTIFICATIFS_EN_ATTENTE_DIR, ensure_directories
from backend.services import ocr_service


def find_orphans(directory: Path, name_filter: str | None) -> list[Path]:
    orphans: list[Path] = []
    for pdf in sorted(directory.glob("*.pdf")):
        if name_filter and name_filter.lower() not in pdf.name.lower():
            continue
        ocr_cache = pdf.with_suffix(".ocr.json")
        if not ocr_cache.exists():
            orphans.append(pdf)
    return orphans


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--filter", default=None, help="Substring filter on filename")
    parser.add_argument("--dry-run", action="store_true", help="List only, no processing")
    args = parser.parse_args()

    ensure_directories()
    orphans = find_orphans(JUSTIFICATIFS_EN_ATTENTE_DIR, args.filter)

    if not orphans:
        print("Aucun PDF orphelin trouvé.")
        return 0

    print(f"{len(orphans)} PDF(s) orphelin(s) sans .ocr.json :")
    for p in orphans:
        print(f"  - {p.name}")

    if args.dry_run:
        return 0

    print()
    print("Lancement OCR…")
    ok = 0
    ko = 0
    start = time.time()
    for i, pdf in enumerate(orphans, 1):
        t0 = time.time()
        try:
            result = ocr_service.extract_from_pdf(pdf)
            status = result.get("status", "unknown")
            supplier = (result.get("extracted_data", {}) or {}).get("supplier", "?")
            amount = (result.get("extracted_data", {}) or {}).get("best_amount", "?")
            date = (result.get("extracted_data", {}) or {}).get("best_date", "?")
            elapsed = time.time() - t0
            if status == "success":
                ok += 1
                print(
                    f"  [{i}/{len(orphans)}] ✓ {pdf.name} "
                    f"→ {supplier} · {date} · {amount} ({elapsed:.1f}s)"
                )
            else:
                ko += 1
                print(f"  [{i}/{len(orphans)}] ✗ {pdf.name} → status={status} ({elapsed:.1f}s)")
        except Exception as e:
            ko += 1
            print(f"  [{i}/{len(orphans)}] ✗ {pdf.name} → erreur: {e}")

    total = time.time() - start
    print()
    print(f"Terminé : {ok} OK, {ko} erreurs en {total:.1f}s")
    return 0 if ko == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
