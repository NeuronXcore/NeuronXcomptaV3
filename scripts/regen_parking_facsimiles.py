"""Regénère en place les fac-similés parking (PARC CONSUL DUPUY) avec le background scan.

Les .ocr.json + liens opérations + metadata GED restent intacts — seul le PDF est réécrit.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.core.config import JUSTIFICATIFS_TRAITES_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR
from backend.services import operation_service, template_service
from backend.services.template_service import (
    _build_field_values,
    _find_justificatif,
    _generate_pdf_blank_overlay,
    get_template,
)

TEMPLATE_ID = "tpl_c3df54e2"  # PARC CONSUL DUPUY


def regen_one(pdf_path: Path, tpl, source_pdf: Path) -> tuple[bool, str]:
    ocr_path = pdf_path.with_suffix(".ocr.json")
    if not ocr_path.exists():
        return False, f"no .ocr.json: {ocr_path.name}"

    with open(ocr_path, encoding="utf-8") as f:
        ocr = json.load(f)

    if ocr.get("template_id") != tpl.id:
        return False, f"template_id mismatch: {ocr.get('template_id')}"

    op_ref = ocr.get("operation_ref") or {}
    op_file = op_ref.get("file")
    op_idx = op_ref.get("index")
    if not op_file or op_idx is None:
        return False, "no operation_ref"

    ops = operation_service.load_operations(op_file)
    if not (0 <= op_idx < len(ops)):
        return False, f"op index out of range: {op_idx}/{len(ops)}"
    operation = ops[op_idx]

    field_values = _build_field_values(tpl, operation, {})
    old_size = pdf_path.stat().st_size
    _generate_pdf_blank_overlay(pdf_path, source_pdf, field_values, tpl)
    new_size = pdf_path.stat().st_size
    return True, f"{old_size} -> {new_size} bytes"


def main():
    tpl = get_template(TEMPLATE_ID)
    if not tpl:
        print(f"Template {TEMPLATE_ID} non trouve")
        sys.exit(1)

    source_pdf = _find_justificatif(tpl.source_justificatif) if tpl.source_justificatif else None
    if not source_pdf:
        print(f"Source PDF introuvable: {tpl.source_justificatif}")
        sys.exit(1)

    print(f"Template: {tpl.vendor} (source={source_pdf.name})")

    targets: list[Path] = []
    for d in (JUSTIFICATIFS_TRAITES_DIR, JUSTIFICATIFS_EN_ATTENTE_DIR):
        targets.extend(sorted(d.glob("parc-consul-dupuy_*_fs.pdf")))

    print(f"{len(targets)} fac-similes a regenerer\n")
    ok = 0
    errors = 0
    for p in targets:
        try:
            success, msg = regen_one(p, tpl, source_pdf)
            status = "OK" if success else "SKIP"
            print(f"[{status}] {p.name}: {msg}")
            if success:
                ok += 1
            else:
                errors += 1
        except Exception as e:
            print(f"[ERR] {p.name}: {e}")
            errors += 1

    print(f"\nTotal: {ok} OK, {errors} KO")


if __name__ == "__main__":
    main()
