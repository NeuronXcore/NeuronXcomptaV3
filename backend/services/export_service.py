"""
Service pour l'export comptable.
Génère des archives ZIP contenant opérations (CSV/PDF/Excel),
relevés bancaires et justificatifs pour un ou plusieurs mois.
"""
from __future__ import annotations

import io
import json
import logging
import shutil
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from backend.core.config import (
    IMPORTS_DIR, EXPORTS_DIR, RAPPORTS_DIR, REPORTS_DIR,
    JUSTIFICATIFS_TRAITES_DIR, MOIS_FR, ensure_directories,
)
from backend.services import operation_service, report_service

logger = logging.getLogger(__name__)


# ─── Périodes disponibles ───

def get_available_periods() -> dict:
    """
    Retourne les mois disponibles et leur statut.
    {
      "periods": [
        {"year": 2024, "month": 9, "month_name": "Septembre", "filename": "...",
         "count": 120, "total_debit": ..., "total_credit": ...,
         "has_export": true, "justificatif_ratio": 45.0}
      ],
      "years": [2024, 2023]
    }
    """
    ensure_directories()

    # 1. Lister les fichiers d'opérations avec leur mois/année
    op_files = operation_service.list_operation_files()
    periods = []

    for f in op_files:
        month = f.get("month")
        year = f.get("year")
        if not month or not year:
            continue

        # Stats justificatifs
        try:
            ops = operation_service.load_operations(f["filename"])
            total = len(ops)
            with_just = sum(1 for op in ops if op.get("Justificatif"))
            ratio = (with_just / total * 100) if total > 0 else 0.0
        except Exception:
            ratio = 0.0

        month_name = MOIS_FR[month - 1].capitalize() if 1 <= month <= 12 else str(month)

        periods.append({
            "year": year,
            "month": month,
            "month_name": month_name,
            "filename": f["filename"],
            "count": f.get("count", 0),
            "total_debit": f.get("total_debit", 0),
            "total_credit": f.get("total_credit", 0),
            "has_export": _has_export(year, month),
            "justificatif_ratio": round(ratio, 1),
        })

    # Trier par année desc, mois desc
    periods.sort(key=lambda p: (p["year"], p["month"]), reverse=True)

    years = sorted(set(p["year"] for p in periods), reverse=True)

    return {"periods": periods, "years": years}


def _has_export(year: int, month: int) -> bool:
    """Vérifie si un export existe déjà pour ce mois."""
    if not EXPORTS_DIR.exists():
        return False
    pattern = f"export_{year}_{month:02d}_*"
    return len(list(EXPORTS_DIR.glob(pattern))) > 0


# ─── Listing exports existants ───

def list_exports() -> list:
    """Liste tous les exports générés."""
    ensure_directories()
    exports = []
    if not EXPORTS_DIR.exists():
        return exports

    for f in sorted(EXPORTS_DIR.iterdir(), reverse=True):
        if f.suffix == ".zip":
            stat = f.stat()
            # Extraire année/mois du nom
            year, month, month_name = _parse_export_filename(f.name)
            exports.append({
                "filename": f.name,
                "year": year,
                "month": month,
                "month_name": month_name or "",
                "size": stat.st_size,
                "size_human": _format_size(stat.st_size),
                "created": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })

    return exports


def _parse_export_filename(filename: str) -> tuple:
    """Parse export_2024_09_Septembre_... → (2024, 9, 'Septembre')"""
    import re
    match = re.match(r"export_(\d{4})_(\d{2})_(\w+)", filename)
    if match:
        return int(match.group(1)), int(match.group(2)), match.group(3)
    return None, None, None


# ─── Génération d'export ───

def generate_export(
    year: int,
    month: int,
    include_csv: bool = True,
    include_pdf: bool = False,
    include_excel: bool = False,
    include_bank_statement: bool = True,
    include_justificatifs: bool = True,
    include_reports: bool = False,
) -> dict:
    """
    Génère un export ZIP complet pour un mois donné.
    Le ZIP contient : opérations (CSV/PDF/Excel), relevé bancaire, justificatifs, rapports.
    """
    ensure_directories()

    # 1. Trouver le fichier d'opérations pour ce mois
    op_files = operation_service.list_operation_files()
    target_file = None
    for f in op_files:
        if f.get("year") == year and f.get("month") == month:
            target_file = f
            break

    if not target_file:
        raise ValueError(f"Aucune opération trouvée pour {month:02d}/{year}")

    operations = operation_service.load_operations(target_file["filename"])
    if not operations:
        raise ValueError(f"Fichier vide pour {month:02d}/{year}")

    month_name = MOIS_FR[month - 1].capitalize() if 1 <= month <= 12 else str(month)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"export_{year}_{month:02d}_{month_name}_{timestamp}.zip"
    zip_path = EXPORTS_DIR / zip_name

    files_included = []
    total_size = 0

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:

        # ── CSV ──
        if include_csv:
            csv_content = _generate_csv_content(operations, month_name, year)
            arc_name = f"operations_{month_name}_{year}.csv"
            zf.writestr(arc_name, csv_content)
            files_included.append({"name": arc_name, "type": "csv"})

        # ── PDF ──
        if include_pdf:
            pdf_bytes = _generate_pdf_content(operations, month_name, year)
            arc_name = f"operations_{month_name}_{year}.pdf"
            zf.writestr(arc_name, pdf_bytes)
            files_included.append({"name": arc_name, "type": "pdf"})

        # ── Excel ──
        if include_excel:
            xlsx_bytes = _generate_excel_content(operations, month_name, year)
            arc_name = f"operations_{month_name}_{year}.xlsx"
            zf.writestr(arc_name, xlsx_bytes)
            files_included.append({"name": arc_name, "type": "xlsx"})

        # ── Relevé bancaire ──
        if include_bank_statement:
            bank_pdf = _find_bank_statement(target_file["filename"])
            if bank_pdf and bank_pdf.exists():
                arc_name = f"releve_bancaire_{month_name}_{year}.pdf"
                zf.write(str(bank_pdf), arcname=arc_name)
                files_included.append({"name": arc_name, "type": "bank_pdf"})

        # ── Justificatifs ──
        if include_justificatifs:
            just_count = 0
            for op in operations:
                lien = op.get("Lien justificatif", "")
                if lien:
                    # Le lien est de la forme "traites/justificatif_xxx.pdf"
                    just_filename = Path(lien).name
                    just_path = JUSTIFICATIFS_TRAITES_DIR / just_filename
                    if just_path.exists():
                        arc_name = f"justificatifs/{just_filename}"
                        zf.write(str(just_path), arcname=arc_name)
                        just_count += 1
            if just_count > 0:
                files_included.append({"name": f"justificatifs/ ({just_count} fichiers)", "type": "justificatifs"})

        # ── Rapports existants ──
        if include_reports:
            reports_added = _add_existing_reports(zf, year, month, month_name)
            for r in reports_added:
                files_included.append({"name": r, "type": "report"})

    # Stats
    total_debit = sum(float(op.get("Débit", 0) or 0) for op in operations)
    total_credit = sum(float(op.get("Crédit", 0) or 0) for op in operations)
    with_just = sum(1 for op in operations if op.get("Justificatif"))

    return {
        "filename": zip_name,
        "year": year,
        "month": month,
        "month_name": month_name,
        "size": zip_path.stat().st_size,
        "size_human": _format_size(zip_path.stat().st_size),
        "operations_count": len(operations),
        "total_debit": total_debit,
        "total_credit": total_credit,
        "solde": total_credit - total_debit,
        "justificatif_count": with_just,
        "files_included": files_included,
        "created": datetime.now().isoformat(),
    }


# ─── Contenu CSV ───

def _generate_csv_content(operations: list, month_name: str, year: int) -> str:
    """Génère le contenu CSV en mémoire."""
    import csv

    output = io.StringIO()
    # BOM pour Excel
    output.write("\ufeff")
    output.write(f"# Export Comptable - {month_name} {year}\n")
    output.write(f"# Généré le {datetime.now().strftime('%d/%m/%Y à %H:%M')}\n")
    output.write(f"# {len(operations)} opérations\n\n")

    columns = ["Date", "Libellé", "Débit", "Crédit", "Catégorie",
               "Sous-catégorie", "Justificatif", "Commentaire"]
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()

    for op in operations:
        row = {}
        for col in columns:
            val = op.get(col, "")
            if isinstance(val, bool):
                val = "Oui" if val else "Non"
            row[col] = val
        writer.writerow(row)

    total_debit = sum(float(op.get("Débit", 0) or 0) for op in operations)
    total_credit = sum(float(op.get("Crédit", 0) or 0) for op in operations)
    output.write(f"\n# Total Débits: {total_debit:.2f} EUR\n")
    output.write(f"# Total Crédits: {total_credit:.2f} EUR\n")
    output.write(f"# Solde: {total_credit - total_debit:.2f} EUR\n")

    return output.getvalue()


# ─── Contenu PDF ───

def _generate_pdf_content(operations: list, month_name: str, year: int) -> bytes:
    """Génère un PDF en mémoire et retourne les bytes."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A4),
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("T", parent=styles["Heading1"], fontSize=16, spaceAfter=12)
    sub_style = ParagraphStyle("S", parent=styles["Normal"], fontSize=10, spaceAfter=6, textColor=colors.HexColor("#666"))
    small_style = ParagraphStyle("Sm", parent=styles["Normal"], fontSize=7, leading=9)

    elements = []
    elements.append(Paragraph(f"Export Comptable - {month_name} {year}", title_style))
    elements.append(Paragraph(
        f"Généré le {datetime.now().strftime('%d/%m/%Y à %H:%M')} | {len(operations)} opérations", sub_style
    ))
    elements.append(Spacer(1, 12))

    # Résumé
    total_d = sum(float(op.get("Débit", 0) or 0) for op in operations)
    total_c = sum(float(op.get("Crédit", 0) or 0) for op in operations)
    summary = Table(
        [["Total Crédits", f"{total_c:,.2f} EUR"],
         ["Total Débits", f"{total_d:,.2f} EUR"],
         ["Solde", f"{total_c - total_d:,.2f} EUR"]],
        colWidths=[4 * cm, 5 * cm],
    )
    summary.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0f0f0")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(summary)
    elements.append(Spacer(1, 16))

    # Tableau
    headers = ["Date", "Libellé", "Débit", "Crédit", "Catégorie", "Just."]
    table_data = [headers]
    for op in operations[:300]:
        table_data.append([
            str(op.get("Date", "")),
            Paragraph(str(op.get("Libellé", ""))[:80], small_style),
            f"{op.get('Débit', 0):.2f}" if float(op.get("Débit", 0) or 0) > 0 else "",
            f"{op.get('Crédit', 0):.2f}" if float(op.get("Crédit", 0) or 0) > 0 else "",
            str(op.get("Catégorie", "")),
            "Oui" if op.get("Justificatif") else "",
        ])

    col_widths = [2.5 * cm, 10 * cm, 2.5 * cm, 2.5 * cm, 4 * cm, 2 * cm]
    ops_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    ops_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#811971")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("ALIGN", (2, 1), (3, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#dddddd")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9f9f9")]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(ops_table)

    doc.build(elements)
    return buffer.getvalue()


# ─── Contenu Excel ───

def _generate_excel_content(operations: list, month_name: str, year: int) -> bytes:
    """Génère un fichier Excel en mémoire et retourne les bytes."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Opérations"

    header_font = Font(bold=True, color="FFFFFF", size=10)
    header_fill = PatternFill(start_color="811971", end_color="811971", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin", color="DDDDDD"),
        right=Side(style="thin", color="DDDDDD"),
        top=Side(style="thin", color="DDDDDD"),
        bottom=Side(style="thin", color="DDDDDD"),
    )

    columns = ["Date", "Libellé", "Débit", "Crédit", "Catégorie",
               "Sous-catégorie", "Justificatif", "Commentaire"]

    for col_idx, col_name in enumerate(columns, 1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border

    for row_idx, op in enumerate(operations, 2):
        for col_idx, col_name in enumerate(columns, 1):
            val = op.get(col_name, "")
            if isinstance(val, bool):
                val = "Oui" if val else "Non"
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = thin_border
            if col_name in ("Débit", "Crédit"):
                cell.number_format = '#,##0.00'
                cell.alignment = Alignment(horizontal="right")

    col_widths = [12, 45, 12, 12, 18, 18, 12, 25]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


# ─── Relevé bancaire ───

def _find_bank_statement(operation_filename: str) -> Optional[Path]:
    """Trouve le PDF du relevé bancaire associé au fichier d'opérations."""
    # Le fichier JSON est operations_YYYYMMDD_HHMMSS_HASH.json
    # Le relevé bancaire est pdf_HASH.pdf
    import re
    match = re.search(r"operations_\d{8}_\d{6}_([a-f0-9]+)\.json", operation_filename)
    if match:
        file_id = match.group(1)
        pdf_path = IMPORTS_DIR / f"pdf_{file_id}.pdf"
        if pdf_path.exists():
            return pdf_path
    return None


# ─── Rapports existants ───

def _add_existing_reports(zf: zipfile.ZipFile, year: int, month: int, month_name: str) -> list:
    """Ajoute les rapports existants pour ce mois au ZIP."""
    added = []
    month_name_lower = month_name.lower()

    for reports_dir in [RAPPORTS_DIR, REPORTS_DIR]:
        if not reports_dir.exists():
            continue
        for f in reports_dir.iterdir():
            if f.suffix in (".pdf", ".csv", ".xlsx"):
                name_lower = f.name.lower()
                # Vérifier si le rapport correspond au mois
                if (month_name_lower in name_lower or
                    f"_{year}_{month:02d}_" in name_lower or
                    f"_{month:02d}_{year}" in name_lower):
                    arc_name = f"rapports/{f.name}"
                    zf.write(str(f), arcname=arc_name)
                    added.append(arc_name)

    return added


# ─── Suppression ───

def delete_export(filename: str) -> bool:
    """Supprime un export."""
    path = EXPORTS_DIR / filename
    if path.exists() and path.suffix == ".zip":
        path.unlink()
        return True
    return False


# ─── Download path ───

def get_export_path(filename: str) -> Optional[Path]:
    """Retourne le chemin absolu d'un export."""
    path = EXPORTS_DIR / filename
    if path.exists():
        return path
    return None


# ─── Utils ───

def _format_size(size_bytes: int) -> str:
    """Formate la taille en bytes lisible."""
    if size_bytes < 1024:
        return f"{size_bytes} o"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.0f} Ko"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} Mo"
