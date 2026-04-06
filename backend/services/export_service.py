"""
Service pour l'export comptable.
Genere des archives ZIP contenant operations (CSV/PDF/Excel),
releves bancaires et justificatifs pour un ou plusieurs mois.

Regles comptables :
- Les ops "perso" sont exclues des totaux BNC (section separee)
- Les ops sans categorie / "Autres" vont en compte d'attente
- Les ventilations sont explosees en sous-lignes
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import shutil
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from backend.core.config import (
    IMPORTS_RELEVES_DIR, EXPORTS_DIR, RAPPORTS_DIR, REPORTS_DIR,
    JUSTIFICATIFS_TRAITES_DIR, MOIS_FR, ASSETS_DIR, APP_NAME,
    ensure_directories,
)
from backend.services import operation_service, report_service

logger = logging.getLogger(__name__)


# ─── Helpers utilitaires ───

def _format_amount_fr(amount: float) -> str:
    """1234.56 -> '1 234,56', 0 -> '0,00'"""
    if amount == 0:
        return "0,00"
    formatted = f"{amount:,.2f}"  # "1,234.56"
    formatted = formatted.replace(",", " ").replace(".", ",")
    return formatted


def _export_filename(year: int, month: int, ext: str) -> str:
    """-> 'Export_Comptable_2025-01_Janvier.csv'"""
    mois_label = MOIS_FR[month - 1].capitalize() if 1 <= month <= 12 else f"{month:02d}"
    return f"Export_Comptable_{year}-{month:02d}_{mois_label}.{ext}"


def _get_justificatif_name(op: dict) -> str:
    """Extrait le basename du justificatif ou retourne vide."""
    lien = op.get("Lien justificatif", "") or op.get("justificatif", "") or ""
    if not lien:
        return ""
    return os.path.basename(lien)


def _safe_float(val) -> float:
    """Convertit une valeur en float en gerant NaN et None."""
    if val is None:
        return 0.0
    try:
        f = float(val)
        if f != f:  # NaN check
            return 0.0
        return f
    except (ValueError, TypeError):
        return 0.0


# ─── Preparation des operations ───

def _prepare_export_operations(operations: list, filename: str) -> dict:
    """
    Prepare les operations pour l'export en les classant en 3 groupes.
    Explose les ventilations. Trie par date ASC.

    Returns:
        {
            "pro": [...],
            "perso": [...],
            "attente": [...],
            "totals": { recettes_pro, charges_pro, solde_bnc, total_perso, nb_perso, total_attente, nb_attente }
        }
    """
    pro = []
    perso = []
    attente = []

    for op in operations:
        ventilation = op.get("ventilation") or []

        if ventilation:
            # Exploser les sous-lignes
            n = len(ventilation)
            for i, vline in enumerate(ventilation):
                sub = {
                    "Date": op.get("Date", ""),
                    "Libelle": f"{op.get('Libellé', op.get('Libelle', ''))} [V{i+1}/{n}]",
                    "Debit": _safe_float(vline.get("montant", 0)) if _safe_float(op.get("Débit", 0)) > 0 else 0.0,
                    "Credit": _safe_float(vline.get("montant", 0)) if _safe_float(op.get("Crédit", 0)) > 0 else 0.0,
                    "Categorie": vline.get("categorie", ""),
                    "Sous_categorie": vline.get("sous_categorie", ""),
                    "Justificatif": os.path.basename(vline.get("justificatif", "") or ""),
                    "Commentaire": op.get("Commentaire", ""),
                }
                _classify_line(sub, pro, perso, attente)
        else:
            line = {
                "Date": op.get("Date", ""),
                "Libelle": op.get("Libellé", op.get("Libelle", "")),
                "Debit": _safe_float(op.get("Débit", 0)),
                "Credit": _safe_float(op.get("Crédit", 0)),
                "Categorie": op.get("Catégorie", op.get("Categorie", "")),
                "Sous_categorie": op.get("Sous-catégorie", op.get("Sous_categorie", "")),
                "Justificatif": _get_justificatif_name(op),
                "Commentaire": op.get("Commentaire", ""),
            }
            _classify_line(line, pro, perso, attente)

    # Trier chaque groupe par date ASC
    for group in [pro, perso, attente]:
        group.sort(key=lambda x: x.get("Date", ""))

    # Calculer les totaux
    recettes_pro = sum(l["Credit"] for l in pro)
    charges_pro = sum(l["Debit"] for l in pro)

    totals = {
        "recettes_pro": recettes_pro,
        "charges_pro": charges_pro,
        "solde_bnc": recettes_pro - charges_pro,
        "total_perso": sum(l["Debit"] + l["Credit"] for l in perso),
        "nb_perso": len(perso),
        "total_attente": sum(l["Debit"] + l["Credit"] for l in attente),
        "nb_attente": len(attente),
        "debit_perso": sum(l["Debit"] for l in perso),
        "credit_perso": sum(l["Credit"] for l in perso),
        "debit_attente": sum(l["Debit"] for l in attente),
        "credit_attente": sum(l["Credit"] for l in attente),
    }

    return {"pro": pro, "perso": perso, "attente": attente, "totals": totals}


def _classify_line(line: dict, pro: list, perso: list, attente: list):
    """Classe une ligne normalisee dans le bon groupe."""
    cat = (line.get("Categorie") or "").strip()
    cat_lower = cat.lower()

    if cat_lower == "perso":
        perso.append(line)
    elif cat == "" or cat_lower == "autres" or cat_lower == "ventilé":
        attente.append(line)
    else:
        pro.append(line)


# ─── Periodes disponibles ───

def get_available_periods() -> dict:
    """
    Retourne les mois disponibles et leur statut.
    """
    ensure_directories()

    op_files = operation_service.list_operation_files()
    periods = []

    for f in op_files:
        month = f.get("month")
        year = f.get("year")
        if not month or not year:
            continue

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

    periods.sort(key=lambda p: (p["year"], p["month"]), reverse=True)
    years = sorted(set(p["year"] for p in periods), reverse=True)

    return {"periods": periods, "years": years}


def _has_export(year: int, month: int) -> bool:
    """Verifie si un export existe deja pour ce mois."""
    if not EXPORTS_DIR.exists():
        return False
    # Nouveau format
    pattern_new = f"Export_Comptable_{year}-{month:02d}_*"
    # Ancien format (retrocompatibilite)
    pattern_old = f"export_{year}_{month:02d}_*"
    return (
        len(list(EXPORTS_DIR.glob(pattern_new))) > 0
        or len(list(EXPORTS_DIR.glob(pattern_old))) > 0
    )


# ─── Listing exports existants ───

def list_exports() -> list:
    """Liste tous les exports generes."""
    ensure_directories()
    exports = []
    if not EXPORTS_DIR.exists():
        return exports

    for f in sorted(EXPORTS_DIR.iterdir(), reverse=True):
        if f.suffix == ".zip":
            stat = f.stat()
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
    """Parse le nom d'export (nouveau ou ancien format)."""
    # Nouveau format: Export_Comptable_2025-01_Janvier_...
    match = re.match(r"Export_Comptable_(\d{4})-(\d{2})_(\w+)", filename)
    if match:
        return int(match.group(1)), int(match.group(2)), match.group(3)
    # Ancien format: export_2024_09_Septembre_...
    match = re.match(r"export_(\d{4})_(\d{2})_(\w+)", filename)
    if match:
        return int(match.group(1)), int(match.group(2)), match.group(3)
    return None, None, None


# ─── Generation d'export ───

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
    Genere un export ZIP complet pour un mois donne.
    """
    ensure_directories()

    op_files = operation_service.list_operation_files()
    target_file = None
    for f in op_files:
        if f.get("year") == year and f.get("month") == month:
            target_file = f
            break

    if not target_file:
        raise ValueError(f"Aucune operation trouvee pour {month:02d}/{year}")

    operations = operation_service.load_operations(target_file["filename"])
    if not operations:
        raise ValueError(f"Fichier vide pour {month:02d}/{year}")

    month_name = MOIS_FR[month - 1].capitalize() if 1 <= month <= 12 else str(month)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"Export_Comptable_{year}-{month:02d}_{month_name}_{timestamp}.zip"
    zip_path = EXPORTS_DIR / zip_name

    # Preparer les operations classees
    prepared = _prepare_export_operations(operations, target_file["filename"])

    files_included = []

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:

        # ── CSV ──
        if include_csv:
            csv_content = _generate_csv_content(prepared, month_name, year)
            arc_name = _export_filename(year, month, "csv")
            zf.writestr(arc_name, csv_content)
            files_included.append({"name": arc_name, "type": "csv"})

        # ── PDF ──
        if include_pdf:
            pdf_bytes = _generate_pdf_content(prepared, month_name, year, month)
            arc_name = _export_filename(year, month, "pdf")
            zf.writestr(arc_name, pdf_bytes)
            files_included.append({"name": arc_name, "type": "pdf"})

        # ── Excel ──
        if include_excel:
            xlsx_bytes = _generate_excel_content(prepared, month_name, year)
            arc_name = _export_filename(year, month, "xlsx")
            zf.writestr(arc_name, xlsx_bytes)
            files_included.append({"name": arc_name, "type": "xlsx"})

        # ── Releve bancaire ──
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

    totals = prepared["totals"]

    return {
        "filename": zip_name,
        "year": year,
        "month": month,
        "month_name": month_name,
        "size": zip_path.stat().st_size,
        "size_human": _format_size(zip_path.stat().st_size),
        "operations_count": len(operations),
        "total_debit": totals["charges_pro"],
        "total_credit": totals["recettes_pro"],
        "solde": totals["solde_bnc"],
        "justificatif_count": sum(1 for op in operations if op.get("Justificatif")),
        "files_included": files_included,
        "created": datetime.now().isoformat(),
    }


# ─── Contenu CSV ───

def _generate_csv_content(prepared: dict, month_name: str, year: int) -> str:
    """
    Genere le contenu CSV avec separateur ;, format FR, sections pro/perso/attente.
    UTF-8 BOM + CRLF.
    """
    lines = []

    columns = ["Date", "Libellé", "Débit", "Crédit", "Catégorie",
               "Sous-catégorie", "Justificatif", "Commentaire"]

    lines.append(";".join(columns))

    def _csv_row(line: dict) -> str:
        debit = _format_amount_fr(line["Debit"]) if line["Debit"] > 0 else "0,00"
        credit = _format_amount_fr(line["Credit"]) if line["Credit"] > 0 else "0,00"
        libelle = line.get("Libelle", "")
        # Escape ; in fields
        if ";" in libelle:
            libelle = f'"{libelle}"'
        comment = line.get("Commentaire", "") or ""
        if ";" in comment:
            comment = f'"{comment}"'
        return ";".join([
            line.get("Date", ""),
            libelle,
            debit,
            credit,
            line.get("Categorie", ""),
            line.get("Sous_categorie", ""),
            line.get("Justificatif", ""),
            comment,
        ])

    # Section professionnelle
    for line in prepared["pro"]:
        lines.append(_csv_row(line))

    totals = prepared["totals"]

    # Ligne vide + total pro
    lines.append("")
    lines.append(";".join([
        "", "",
        _format_amount_fr(totals["charges_pro"]),
        _format_amount_fr(totals["recettes_pro"]),
        "", "", "", "TOTAL PROFESSIONNEL",
    ]))

    # Section perso
    if prepared["perso"]:
        lines.append("")
        for line in prepared["perso"]:
            lines.append(_csv_row(line))
        lines.append(";".join([
            "", "",
            _format_amount_fr(totals["debit_perso"]),
            _format_amount_fr(totals["credit_perso"]),
            "", "", "",
            f"MOUVEMENTS PERSONNELS EXCLUS ({totals['nb_perso']} opérations)",
        ]))

    # Section attente
    if prepared["attente"]:
        lines.append("")
        for line in prepared["attente"]:
            lines.append(_csv_row(line))
        lines.append(";".join([
            "", "",
            _format_amount_fr(totals["debit_attente"]),
            _format_amount_fr(totals["credit_attente"]),
            "", "", "",
            f"COMPTE D'ATTENTE ({totals['nb_attente']} opérations)",
        ]))

    # Joindre avec CRLF + BOM
    content = "\r\n".join(lines) + "\r\n"
    return "\ufeff" + content


# ─── Contenu PDF ───

def _generate_pdf_content(prepared: dict, month_name: str, year: int, month: int) -> bytes:
    """Genere un PDF professionnel avec logo, sections, totaux, pagination."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import cm, mm
    from reportlab.platypus import (
        BaseDocTemplate, PageTemplate, Frame,
        Table, TableStyle, Paragraph, Spacer, Image,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

    page_w, page_h = landscape(A4)
    margin_lr = 1.5 * cm
    margin_tb = 1.5 * cm

    # ── Styles ──
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ExportTitle", parent=styles["Heading1"],
        fontSize=16, spaceAfter=2, alignment=TA_CENTER,
    )
    sub_style = ParagraphStyle(
        "ExportSub", parent=styles["Normal"],
        fontSize=10, spaceAfter=2, textColor=colors.HexColor("#666666"),
        alignment=TA_CENTER,
    )
    date_style = ParagraphStyle(
        "ExportDate", parent=styles["Normal"],
        fontSize=9, spaceAfter=10, textColor=colors.HexColor("#999999"),
        alignment=TA_CENTER,
    )
    cell_style = ParagraphStyle(
        "Cell", parent=styles["Normal"], fontSize=7, leading=9,
    )
    cell_right = ParagraphStyle(
        "CellR", parent=styles["Normal"], fontSize=7, leading=9, alignment=TA_RIGHT,
    )
    section_style = ParagraphStyle(
        "Section", parent=styles["Normal"], fontSize=9, leading=11,
        textColor=colors.HexColor("#333333"),
    )
    recap_style = ParagraphStyle(
        "Recap", parent=styles["Normal"], fontSize=9, leading=13,
    )
    recap_bold = ParagraphStyle(
        "RecapB", parent=styles["Normal"], fontSize=10, leading=13,
        fontName="Helvetica-Bold",
    )

    # ── Column widths ──
    usable_w = page_w - 2 * margin_lr
    col_date = 70
    col_debit = 80
    col_credit = 80
    col_cat = 80
    col_subcat = 70
    col_just = 100
    col_libelle = usable_w - col_date - col_debit - col_credit - col_cat - col_subcat - col_just
    col_widths = [col_date, col_libelle, col_debit, col_credit, col_cat, col_subcat, col_just]

    # ── Footer callback ──
    footer_info = {"month_name": month_name, "year": year}

    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setStrokeColor(colors.HexColor("#CCCCCC"))
        canvas.line(margin_lr, margin_tb - 8 * mm, page_w - margin_lr, margin_tb - 8 * mm)
        canvas.drawString(margin_lr, margin_tb - 12 * mm, f"Page {doc.page}")
        right_text = f"{APP_NAME} — {footer_info['month_name']} {footer_info['year']}"
        canvas.drawRightString(page_w - margin_lr, margin_tb - 12 * mm, right_text)
        canvas.restoreState()

    # ── Build doc ──
    buffer = io.BytesIO()
    doc = BaseDocTemplate(
        buffer, pagesize=landscape(A4),
        leftMargin=margin_lr, rightMargin=margin_lr,
        topMargin=margin_tb, bottomMargin=margin_tb + 5 * mm,
    )
    frame = Frame(
        margin_lr, margin_tb, usable_w, page_h - 2 * margin_tb - 5 * mm,
        id="main",
    )
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=_footer)])

    elements = []

    # ── Header with logo ──
    logo_path = ASSETS_DIR / "logo_lockup_light_400.png"
    header_parts = []
    if logo_path.exists():
        try:
            logo = Image(str(logo_path), width=120, height=40)
            logo.hAlign = "LEFT"
            header_parts.append(logo)
            elements.append(logo)
            elements.append(Spacer(1, 6))
        except Exception:
            pass

    elements.append(Paragraph(f"Export Comptable", title_style))
    elements.append(Paragraph(f"{month_name} {year}", sub_style))
    elements.append(Paragraph(
        f"Généré le {datetime.now().strftime('%d/%m/%Y')}", date_style
    ))
    elements.append(Spacer(1, 8))

    totals = prepared["totals"]

    # ── Section helper ──
    def _section_header_row(text: str) -> list:
        """Returns a full-width section header for the table."""
        return [Paragraph(f"<b>{text}</b>", section_style),
                "", "", "", "", "", ""]

    def _build_data_rows(ops: list) -> list:
        """Convert normalized op dicts to table rows."""
        rows = []
        for idx, line in enumerate(ops):
            debit_str = _format_amount_fr(line["Debit"]) if line["Debit"] > 0 else ""
            credit_str = _format_amount_fr(line["Credit"]) if line["Credit"] > 0 else ""
            rows.append([
                line.get("Date", ""),
                Paragraph(str(line.get("Libelle", ""))[:90], cell_style),
                Paragraph(debit_str, cell_right),
                Paragraph(credit_str, cell_right),
                str(line.get("Categorie", "")),
                str(line.get("Sous_categorie", "")),
                str(line.get("Justificatif", ""))[:20],
            ])
        return rows

    def _total_row(label: str, debit: float, credit: float) -> list:
        return [
            Paragraph(f"<b>{label}</b>", cell_style),
            "",
            Paragraph(f"<b>{_format_amount_fr(debit)}</b>", cell_right),
            Paragraph(f"<b>{_format_amount_fr(credit)}</b>", cell_right),
            "", "", "",
        ]

    # ── Build main table data ──
    headers = ["Date", "Libellé", "Débit", "Crédit", "Catégorie", "Sous-cat.", "Justificatif"]
    table_data = [headers]

    # Section PRO header
    table_data.append(_section_header_row("OPÉRATIONS PROFESSIONNELLES"))
    pro_start = len(table_data)
    table_data.extend(_build_data_rows(prepared["pro"]))
    pro_end = len(table_data)
    table_data.append(_total_row("TOTAL PROFESSIONNEL", totals["charges_pro"], totals["recettes_pro"]))
    total_pro_row = len(table_data) - 1

    # Section PERSO
    perso_header_row = None
    total_perso_row = None
    if prepared["perso"]:
        table_data.append(_section_header_row(
            f"MOUVEMENTS PERSONNELS EXCLUS ({totals['nb_perso']} opérations)"
        ))
        perso_header_row = len(table_data) - 1
        perso_start = len(table_data)
        table_data.extend(_build_data_rows(prepared["perso"]))
        table_data.append(_total_row("TOTAL PERSO", totals["debit_perso"], totals["credit_perso"]))
        total_perso_row = len(table_data) - 1

    # Section ATTENTE
    attente_header_row = None
    total_attente_row = None
    if prepared["attente"]:
        table_data.append(_section_header_row(
            f"COMPTE D'ATTENTE ({totals['nb_attente']} opérations)"
        ))
        attente_header_row = len(table_data) - 1
        attente_start = len(table_data)
        table_data.extend(_build_data_rows(prepared["attente"]))
        table_data.append(_total_row("TOTAL ATTENTE", totals["debit_attente"], totals["credit_attente"]))
        total_attente_row = len(table_data) - 1

    # ── Table style ──
    style_cmds = [
        # Header row
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#811971")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        # Global
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DDDDDD")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        # Amounts right-aligned
        ("ALIGN", (2, 1), (3, -1), "RIGHT"),
        # Section header: PRO
        ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#D5E8F0")),
        ("SPAN", (0, 1), (-1, 1)),
        # Total PRO
        ("BACKGROUND", (0, total_pro_row), (-1, total_pro_row), colors.HexColor("#E8E8E8")),
    ]

    # Alternating row colors for PRO data rows
    for i in range(pro_start, pro_end):
        if (i - pro_start) % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), colors.white))
        else:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F8F8F8")))

    # Section headers and totals for perso
    if perso_header_row is not None:
        style_cmds.append(("BACKGROUND", (0, perso_header_row), (-1, perso_header_row), colors.HexColor("#D5E8F0")))
        style_cmds.append(("SPAN", (0, perso_header_row), (-1, perso_header_row)))
    if total_perso_row is not None:
        style_cmds.append(("BACKGROUND", (0, total_perso_row), (-1, total_perso_row), colors.HexColor("#E8E8E8")))
        # Alternating for perso data
        perso_data_start = perso_header_row + 1 if perso_header_row is not None else 0
        for i in range(perso_data_start, total_perso_row):
            if (i - perso_data_start) % 2 == 0:
                style_cmds.append(("BACKGROUND", (0, i), (-1, i), colors.white))
            else:
                style_cmds.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F8F8F8")))

    # Section headers and totals for attente
    if attente_header_row is not None:
        style_cmds.append(("BACKGROUND", (0, attente_header_row), (-1, attente_header_row), colors.HexColor("#D5E8F0")))
        style_cmds.append(("SPAN", (0, attente_header_row), (-1, attente_header_row)))
    if total_attente_row is not None:
        style_cmds.append(("BACKGROUND", (0, total_attente_row), (-1, total_attente_row), colors.HexColor("#E8E8E8")))
        attente_data_start = attente_header_row + 1 if attente_header_row is not None else 0
        for i in range(attente_data_start, total_attente_row):
            if (i - attente_data_start) % 2 == 0:
                style_cmds.append(("BACKGROUND", (0, i), (-1, i), colors.white))
            else:
                style_cmds.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F8F8F8")))

    ops_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    ops_table.setStyle(TableStyle(style_cmds))
    elements.append(ops_table)

    # ── Recapitulatif ──
    elements.append(Spacer(1, 16))

    recap_data = [
        [Paragraph("<b>RÉCAPITULATIF</b>", recap_bold), ""],
        [Paragraph("Recettes professionnelles :", recap_style),
         Paragraph(f"<b>{_format_amount_fr(totals['recettes_pro'])} €</b>", ParagraphStyle("RR", parent=recap_style, alignment=TA_RIGHT))],
        [Paragraph("Charges professionnelles :", recap_style),
         Paragraph(f"<b>{_format_amount_fr(totals['charges_pro'])} €</b>", ParagraphStyle("RR2", parent=recap_style, alignment=TA_RIGHT))],
        [Paragraph("<b>Solde BNC :</b>", recap_bold),
         Paragraph(f"<b>{_format_amount_fr(totals['solde_bnc'])} €</b>", ParagraphStyle("RR3", parent=recap_bold, alignment=TA_RIGHT))],
    ]
    if totals["nb_perso"] > 0:
        recap_data.append([
            Paragraph(f"Mouvements personnels exclus ({totals['nb_perso']} ops) :", recap_style),
            Paragraph(f"{_format_amount_fr(totals['total_perso'])} €", ParagraphStyle("RR4", parent=recap_style, alignment=TA_RIGHT)),
        ])
    if totals["nb_attente"] > 0:
        recap_data.append([
            Paragraph(f"En attente de ventilation ({totals['nb_attente']} ops) :", recap_style),
            Paragraph(f"{_format_amount_fr(totals['total_attente'])} €", ParagraphStyle("RR5", parent=recap_style, alignment=TA_RIGHT)),
        ])

    recap_table = Table(recap_data, colWidths=[usable_w * 0.55, usable_w * 0.45])
    recap_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F0F4F8")),
        ("SPAN", (0, 0), (-1, 0)),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#FAFAFA")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#CCCCCC")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(recap_table)

    doc.build(elements)
    return buffer.getvalue()


# ─── Contenu Excel ───

def _generate_excel_content(prepared: dict, month_name: str, year: int) -> bytes:
    """Genere un fichier Excel avec les 3 sections."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Opérations"

    header_font = Font(bold=True, color="FFFFFF", size=10)
    header_fill = PatternFill(start_color="811971", end_color="811971", fill_type="solid")
    section_fill = PatternFill(start_color="D5E8F0", end_color="D5E8F0", fill_type="solid")
    total_fill = PatternFill(start_color="E8E8E8", end_color="E8E8E8", fill_type="solid")
    total_font = Font(bold=True, size=10)
    thin_border = Border(
        left=Side(style="thin", color="DDDDDD"),
        right=Side(style="thin", color="DDDDDD"),
        top=Side(style="thin", color="DDDDDD"),
        bottom=Side(style="thin", color="DDDDDD"),
    )

    columns = ["Date", "Libellé", "Débit", "Crédit", "Catégorie",
               "Sous-catégorie", "Justificatif", "Commentaire"]

    # Header row
    for col_idx, col_name in enumerate(columns, 1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border

    row_idx = 2

    def _write_section_header(ws, row, text):
        cell = ws.cell(row=row, column=1, value=text)
        cell.font = Font(bold=True, size=10)
        for c in range(1, 9):
            ws.cell(row=row, column=c).fill = section_fill
            ws.cell(row=row, column=c).border = thin_border
        return row + 1

    def _write_ops(ws, row, ops):
        for line in ops:
            ws.cell(row=row, column=1, value=line.get("Date", "")).border = thin_border
            ws.cell(row=row, column=2, value=line.get("Libelle", "")).border = thin_border
            c3 = ws.cell(row=row, column=3, value=line["Debit"] if line["Debit"] > 0 else 0)
            c3.number_format = '#,##0.00'
            c3.alignment = Alignment(horizontal="right")
            c3.border = thin_border
            c4 = ws.cell(row=row, column=4, value=line["Credit"] if line["Credit"] > 0 else 0)
            c4.number_format = '#,##0.00'
            c4.alignment = Alignment(horizontal="right")
            c4.border = thin_border
            ws.cell(row=row, column=5, value=line.get("Categorie", "")).border = thin_border
            ws.cell(row=row, column=6, value=line.get("Sous_categorie", "")).border = thin_border
            ws.cell(row=row, column=7, value=line.get("Justificatif", "")).border = thin_border
            ws.cell(row=row, column=8, value=line.get("Commentaire", "")).border = thin_border
            row += 1
        return row

    def _write_total_row(ws, row, label, debit, credit):
        ws.cell(row=row, column=1, value=label).font = total_font
        for c in range(1, 9):
            ws.cell(row=row, column=c).fill = total_fill
            ws.cell(row=row, column=c).border = thin_border
        c3 = ws.cell(row=row, column=3, value=debit)
        c3.number_format = '#,##0.00'
        c3.alignment = Alignment(horizontal="right")
        c3.font = total_font
        c4 = ws.cell(row=row, column=4, value=credit)
        c4.number_format = '#,##0.00'
        c4.alignment = Alignment(horizontal="right")
        c4.font = total_font
        return row + 1

    totals = prepared["totals"]

    # PRO section
    row_idx = _write_section_header(ws, row_idx, "OPÉRATIONS PROFESSIONNELLES")
    row_idx = _write_ops(ws, row_idx, prepared["pro"])
    row_idx = _write_total_row(ws, row_idx, "TOTAL PROFESSIONNEL", totals["charges_pro"], totals["recettes_pro"])
    row_idx += 1  # blank row

    # PERSO section
    if prepared["perso"]:
        row_idx = _write_section_header(ws, row_idx, f"MOUVEMENTS PERSONNELS EXCLUS ({totals['nb_perso']} opérations)")
        row_idx = _write_ops(ws, row_idx, prepared["perso"])
        row_idx = _write_total_row(ws, row_idx, "TOTAL PERSO", totals["debit_perso"], totals["credit_perso"])
        row_idx += 1

    # ATTENTE section
    if prepared["attente"]:
        row_idx = _write_section_header(ws, row_idx, f"COMPTE D'ATTENTE ({totals['nb_attente']} opérations)")
        row_idx = _write_ops(ws, row_idx, prepared["attente"])
        row_idx = _write_total_row(ws, row_idx, "TOTAL ATTENTE", totals["debit_attente"], totals["credit_attente"])

    col_widths = [12, 45, 12, 12, 18, 18, 18, 25]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


# ─── Releve bancaire ───

def _find_bank_statement(operation_filename: str) -> Optional[Path]:
    """Trouve le PDF du releve bancaire associe au fichier d'operations."""
    match = re.search(r"operations_\d{8}_\d{6}_([a-f0-9]+)\.json", operation_filename)
    if match:
        file_id = match.group(1)
        pdf_path = IMPORTS_RELEVES_DIR / f"pdf_{file_id}.pdf"
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
