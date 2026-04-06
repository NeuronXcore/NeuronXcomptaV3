"""
Service pour la génération de rapports V2.
Index JSON, templates, format EUR, déduplication, réconciliation.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import os
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import (
    RAPPORTS_DIR, REPORTS_DIR, REPORTS_INDEX, ASSETS_DIR,
    MOIS_FR, ensure_directories,
)
from backend.services.operation_service import list_operation_files, load_operations

logger = logging.getLogger(__name__)

# ─── Templates prédéfinis ───

REPORT_TEMPLATES: list[dict] = [
    {
        "id": "bnc_annuel",
        "label": "Récapitulatif annuel BNC",
        "description": "Toutes les opérations de l'année — recettes et dépenses",
        "icon": "FileText",
        "format": "pdf",
        "filters": {"type": "all"},
    },
    {
        "id": "ventilation_charges",
        "label": "Ventilation des charges",
        "description": "Dépenses par catégorie et sous-catégorie",
        "icon": "PieChart",
        "format": "excel",
        "filters": {"type": "debit"},
    },
    {
        "id": "recapitulatif_social",
        "label": "Récapitulatif social",
        "description": "Charges URSSAF, CARMF, ODM sur l'année",
        "icon": "Shield",
        "format": "pdf",
        "filters": {"categories": ["Charges sociales"], "type": "debit"},
    },
]


def get_templates() -> list[dict]:
    return REPORT_TEMPLATES


# ─── Index JSON ───

def _load_index() -> dict:
    if REPORTS_INDEX.exists():
        try:
            with open(REPORTS_INDEX, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Erreur chargement index rapports: {e}")
    return {"version": 1, "reports": []}


def _save_index(index: dict) -> None:
    ensure_directories()
    with open(REPORTS_INDEX, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2, default=str)


def reconcile_index() -> None:
    """Réconcilie l'index avec le filesystem."""
    ensure_directories()
    index = _load_index()
    reports = index.get("reports", [])

    # Map existant
    existing_files: set[str] = set()
    for d in [RAPPORTS_DIR, REPORTS_DIR]:
        if d.exists():
            for f in d.iterdir():
                if f.suffix in (".pdf", ".csv", ".xlsx"):
                    existing_files.add(f.name)

    # Supprimer les entrées sans fichier
    before = len(reports)
    reports = [r for r in reports if r["filename"] in existing_files]
    removed = before - len(reports)

    # Indexer les fichiers non référencés
    indexed_files = {r["filename"] for r in reports}
    added = 0
    for fname in existing_files:
        if fname not in indexed_files:
            path = _find_report_path(fname)
            if path:
                stat = path.stat()
                ext = path.suffix[1:].lower()
                fmt = "excel" if ext == "xlsx" else ext
                reports.append({
                    "filename": fname,
                    "title": _clean_filename_title(fname),
                    "description": None,
                    "format": fmt,
                    "generated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "filters": {},
                    "template_id": None,
                    "nb_operations": 0,
                    "total_debit": 0,
                    "total_credit": 0,
                    "file_size": stat.st_size,
                    "file_size_human": _format_size(stat.st_size),
                    "year": None,
                    "quarter": None,
                    "month": None,
                })
                added += 1

    index["reports"] = reports
    _save_index(index)
    if removed or added:
        logger.info(f"Reports index reconciled: {removed} removed, {added} added")


def _clean_filename_title(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"_\d{8}_\d{6}$", "", stem)  # remove timestamp suffix
    stem = re.sub(r"_[a-f0-9]{8}$", "", stem)   # remove hash suffix
    return stem.replace("_", " ").replace("rapport ", "").title()


# ─── Gallery ───

def get_all_reports() -> list[dict]:
    index = _load_index()
    reports = index.get("reports", [])
    reports.sort(key=lambda r: r.get("generated_at", ""), reverse=True)
    return reports


def get_gallery() -> dict:
    reports = get_all_reports()
    years = sorted(set(r.get("year") for r in reports if r.get("year")), reverse=True)
    return {
        "reports": reports,
        "available_years": years,
        "total_count": len(reports),
    }


# ─── CRUD ───

def get_report_path(filename: str) -> Optional[Path]:
    return _find_report_path(filename)


def _find_report_path(filename: str) -> Optional[Path]:
    for d in [RAPPORTS_DIR, REPORTS_DIR]:
        path = d / filename
        if path.exists():
            return path
    return None


def delete_report(filename: str) -> bool:
    path = _find_report_path(filename)
    if path:
        path.unlink()
    # Remove from index
    index = _load_index()
    index["reports"] = [r for r in index["reports"] if r["filename"] != filename]
    _save_index(index)
    return path is not None


def update_report_metadata(filename: str, updates: dict) -> Optional[dict]:
    index = _load_index()
    for r in index["reports"]:
        if r["filename"] == filename:
            if updates.get("title") is not None:
                r["title"] = updates["title"]
            if updates.get("description") is not None:
                r["description"] = updates["description"]
            _save_index(index)
            return r
    return None


# ─── Generation ───

def _slugify(text: str, max_len: int = 40) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s-]", "", text.lower())
    text = re.sub(r"[\s-]+", "_", text).strip("_")
    return text[:max_len]


def _format_eur(amount: float) -> str:
    if amount == 0:
        return "—"
    formatted = f"{abs(amount):,.2f}".replace(",", " ").replace(".", ",")
    sign = "-" if amount < 0 else ""
    return f"{sign}{formatted} €"


def _generate_title(filters: dict, template_id: Optional[str] = None) -> str:
    # Period
    year = filters.get("year")
    quarter = filters.get("quarter")
    month = filters.get("month")
    date_from = filters.get("date_from")
    date_to = filters.get("date_to")

    if year and month and 1 <= month <= 12:
        period = f"{MOIS_FR[month - 1].capitalize()} {year}"
    elif year and quarter:
        period = f"T{quarter} {year}"
    elif year:
        period = str(year)
    elif date_from and date_to:
        period = f"{date_from} au {date_to}"
    else:
        period = "Toutes périodes"

    # Template
    if template_id:
        for t in REPORT_TEMPLATES:
            if t["id"] == template_id:
                return f"{t['label']} — {period}"

    # Categories
    cats = filters.get("categories")
    if cats and len(cats) == 1:
        return f"{cats[0]} — {period}"
    elif cats and 2 <= len(cats) <= 4:
        return f"{', '.join(cats)} — {period}"
    elif cats and len(cats) > 4:
        return f"{', '.join(cats[:3])}… (+{len(cats) - 3}) — {period}"
    else:
        return f"Toutes catégories — {period}"


def _dedup_key(filters: dict, fmt: str) -> tuple:
    return (
        filters.get("year"),
        filters.get("quarter"),
        filters.get("month"),
        filters.get("date_from"),
        filters.get("date_to"),
        tuple(sorted(filters.get("categories") or [])),
        fmt,
    )


def generate_report(request: dict) -> dict:
    """Génère un rapport V2 avec index, déduplication, format EUR."""
    ensure_directories()

    fmt = request.get("format", "pdf")
    filters = request.get("filters", {})
    template_id = request.get("template_id")
    title = request.get("title") or _generate_title(filters, template_id)
    description = request.get("description")

    # Load operations
    year = filters.get("year")
    quarter = filters.get("quarter")
    month = filters.get("month")

    files = list_operation_files()
    if year:
        files = [f for f in files if f.get("year") == year]
    if month:
        files = [f for f in files if f.get("month") == month]
    if quarter:
        q_start = (quarter - 1) * 3 + 1
        files = [f for f in files if q_start <= (f.get("month") or 0) <= q_start + 2]

    all_ops: list[dict] = []
    for f in files:
        try:
            ops = load_operations(f["filename"])
            all_ops.extend(ops)
        except Exception:
            continue

    if not all_ops:
        # If no year filter, load all
        if not year:
            for f in list_operation_files():
                try:
                    ops = load_operations(f["filename"])
                    all_ops.extend(ops)
                except Exception:
                    continue

    # Apply filters
    filtered = _apply_filters(all_ops, filters)

    if not filtered:
        raise ValueError("Aucune opération après application des filtres")

    # Deduplication check
    replaced = None
    key = _dedup_key(filters, fmt)
    index = _load_index()
    for existing in index["reports"]:
        existing_key = _dedup_key(existing.get("filters", {}), existing.get("format", ""))
        if existing_key == key:
            replaced = existing["filename"]
            old_path = _find_report_path(replaced)
            if old_path and old_path.exists():
                old_path.unlink()
            index["reports"] = [r for r in index["reports"] if r["filename"] != replaced]
            break

    # Generate file
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = _slugify(title)
    ext = {"pdf": ".pdf", "csv": ".csv", "excel": ".xlsx"}.get(fmt, ".pdf")
    filename = f"rapport_{slug}_{timestamp}{ext}"
    filepath = REPORTS_DIR / filename

    if fmt == "csv":
        _generate_csv_v2(filtered, filepath, title)
    elif fmt == "pdf":
        _generate_pdf_v2(filtered, filepath, title, filters)
    elif fmt == "excel":
        _generate_excel_v2(filtered, filepath, title)
    else:
        raise ValueError(f"Format non supporté: {fmt}")

    # Stats
    total_debit = sum(op.get("Débit", 0) for op in filtered)
    total_credit = sum(op.get("Crédit", 0) for op in filtered)
    stat = filepath.stat()

    # Add to index
    meta = {
        "filename": filename,
        "title": title,
        "description": description,
        "format": fmt,
        "generated_at": datetime.now().isoformat(),
        "filters": filters,
        "template_id": template_id,
        "nb_operations": len(filtered),
        "total_debit": round(total_debit, 2),
        "total_credit": round(total_credit, 2),
        "file_size": stat.st_size,
        "file_size_human": _format_size(stat.st_size),
        "year": year,
        "quarter": quarter,
        "month": month,
    }
    index["reports"].append(meta)
    _save_index(index)

    result = {**meta, "replaced": replaced}
    return result


def regenerate_report(filename: str) -> dict:
    """Régénère un rapport existant en gardant titre et description."""
    index = _load_index()
    existing = None
    for r in index["reports"]:
        if r["filename"] == filename:
            existing = r
            break
    if not existing:
        raise ValueError(f"Rapport non trouvé: {filename}")

    # Regenerate with same params
    request = {
        "format": existing["format"],
        "title": existing["title"],
        "description": existing.get("description"),
        "filters": existing.get("filters", {}),
        "template_id": existing.get("template_id"),
    }
    # Remove old entry to avoid dedup removing itself
    index["reports"] = [r for r in index["reports"] if r["filename"] != filename]
    _save_index(index)
    # Delete old file
    old_path = _find_report_path(filename)
    if old_path and old_path.exists():
        old_path.unlink()

    return generate_report(request)


# ─── Filters ───

def _apply_filters(operations: list[dict], filters: dict) -> list[dict]:
    result = operations

    cats = filters.get("categories")
    if cats:
        result = [op for op in result if op.get("Catégorie") in cats]

    subcats = filters.get("subcategories")
    if subcats:
        result = [op for op in result if op.get("Sous-catégorie") in subcats]

    if filters.get("date_from"):
        result = [op for op in result if (op.get("Date") or "") >= filters["date_from"]]
    if filters.get("date_to"):
        result = [op for op in result if (op.get("Date") or "") <= filters["date_to"]]

    op_type = filters.get("type")
    if op_type == "debit":
        result = [op for op in result if op.get("Débit", 0) > 0]
    elif op_type == "credit":
        result = [op for op in result if op.get("Crédit", 0) > 0]

    if filters.get("important_only"):
        result = [op for op in result if op.get("Important")]

    if filters.get("min_amount"):
        min_a = float(filters["min_amount"])
        result = [op for op in result if max(op.get("Débit", 0), op.get("Crédit", 0)) >= min_a]
    if filters.get("max_amount"):
        max_a = float(filters["max_amount"])
        result = [op for op in result if max(op.get("Débit", 0), op.get("Crédit", 0)) <= max_a]

    return result


# ─── CSV Generation ───

def _generate_csv_v2(operations: list[dict], filepath: Path, title: str):
    with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
        f.write("Date;Libellé;Catégorie;Sous-catégorie;Débit;Crédit;Justificatif;Commentaire\n")
        for op in operations:
            date = op.get("Date", "")
            lib = str(op.get("Libellé", "")).replace(";", ",")
            cat = str(op.get("Catégorie", ""))
            scat = str(op.get("Sous-catégorie", ""))
            debit = f"{op.get('Débit', 0):.2f}".replace(".", ",") if op.get("Débit", 0) else ""
            credit = f"{op.get('Crédit', 0):.2f}".replace(".", ",") if op.get("Crédit", 0) else ""
            lien = op.get("Lien justificatif", "") or ""
            just_name = os.path.basename(lien) if lien else ""
            comment = str(op.get("Commentaire", "") or "").replace(";", ",")
            f.write(f"{date};{lib};{cat};{scat};{debit};{credit};{just_name};{comment}\n")

        total_d = sum(op.get("Débit", 0) for op in operations)
        total_c = sum(op.get("Crédit", 0) for op in operations)
        nb_just = sum(1 for op in operations if op.get("Lien justificatif"))
        f.write(f";TOTAUX;;;{total_d:.2f};{total_c:.2f};{nb_just}/{len(operations)};\n".replace(".", ","))


# ─── PDF Generation ───

def _generate_pdf_v2(operations: list[dict], filepath: Path, title: str, filters: dict):
    try:
        from reportlab.lib import colors
        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.units import cm, mm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    except ImportError:
        raise RuntimeError("reportlab non installé")

    PRIMARY = HexColor("#811971")

    doc = SimpleDocTemplate(
        str(filepath), pagesize=landscape(A4),
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=2 * cm, bottomMargin=1.5 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("RTitle", parent=styles["Heading1"], fontSize=14,
                                  spaceAfter=4, textColor=PRIMARY)
    subtitle_style = ParagraphStyle("RSub", parent=styles["Normal"], fontSize=8,
                                     textColor=HexColor("#888888"), spaceAfter=8)
    small_style = ParagraphStyle("RSmall", parent=styles["Normal"], fontSize=7, leading=9)

    elements = []

    # Logo
    logo_path = ASSETS_DIR / "logo_lockup_light_400.png"
    if logo_path.exists():
        try:
            logo = Image(str(logo_path), width=120, height=40)
            logo.hAlign = "LEFT"
            elements.append(logo)
            elements.append(Spacer(1, 6))
        except Exception:
            pass  # Graceful fallback if logo can't be loaded

    # Header
    elements.append(Paragraph(title, title_style))
    filter_desc = _describe_filters(filters)
    elements.append(Paragraph(
        f"Généré le {datetime.now().strftime('%d/%m/%Y à %H:%M')} | {len(operations)} opérations | {filter_desc}",
        subtitle_style
    ))
    elements.append(Spacer(1, 8))

    # Justificatif styles
    from reportlab.lib.enums import TA_CENTER
    just_yes_style = ParagraphStyle("RJustYes", parent=small_style, textColor=HexColor("#16a34a"),
                                     alignment=TA_CENTER)
    just_no_style = ParagraphStyle("RJustNo", parent=small_style, textColor=HexColor("#aaaaaa"),
                                    alignment=TA_CENTER)
    just_name_style = ParagraphStyle("RJustName", parent=small_style, fontSize=5.5, leading=7,
                                      textColor=HexColor("#666666"))

    # Comment style
    comment_style = ParagraphStyle("RComment", parent=small_style, fontSize=6, leading=7,
                                    textColor=HexColor("#555555"), fontName="Helvetica-Oblique")

    # Table
    headers = ["Date", "Libellé", "Catégorie", "Sous-cat.", "Débit", "Crédit", "Just.", "Commentaire"]
    table_data = [headers]

    for op in operations[:500]:
        debit = op.get("Débit", 0)
        credit = op.get("Crédit", 0)
        lien = op.get("Lien justificatif", "") or ""
        has_just = bool(lien)
        just_name = os.path.basename(lien) if lien else ""
        comment = str(op.get("Commentaire", "") or "")
        # Checkbox ☑ or ☐ + filename on second line
        if has_just:
            just_cell = Paragraph(f"☑ <font size=5>{just_name[:25]}</font>", just_yes_style)
        else:
            just_cell = Paragraph("☐", just_no_style)
        row = [
            str(op.get("Date", "")),
            Paragraph(str(op.get("Libellé", ""))[:80], small_style),
            str(op.get("Catégorie", "")),
            str(op.get("Sous-catégorie", "")),
            _format_eur(debit) if debit else "",
            _format_eur(credit) if credit else "",
            just_cell,
            Paragraph(comment[:40], comment_style) if comment else "",
        ]
        table_data.append(row)

    # Totals row
    total_d = sum(op.get("Débit", 0) for op in operations)
    total_c = sum(op.get("Crédit", 0) for op in operations)
    nb_just = sum(1 for op in operations if op.get("Lien justificatif"))
    table_data.append(["", "TOTAUX", "", "", _format_eur(total_d), _format_eur(total_c),
                        f"{nb_just}/{len(operations)}", ""])

    col_widths = [2 * cm, 6.5 * cm, 2.8 * cm, 2.5 * cm, 2.5 * cm, 2.5 * cm, 2.8 * cm, 2.7 * cm]
    table = Table(table_data, colWidths=col_widths, repeatRows=1)

    n_rows = len(table_data)
    style_cmds = [
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        # Body
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("ALIGN", (4, 1), (5, -1), "RIGHT"),
        ("ALIGN", (6, 0), (6, 0), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#dddddd")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, HexColor("#f5f5f5")]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        # Totals row
        ("BACKGROUND", (0, n_rows - 1), (-1, n_rows - 1), HexColor("#f0e8ef")),
        ("FONTNAME", (0, n_rows - 1), (-1, n_rows - 1), "Helvetica-Bold"),
        ("FONTSIZE", (0, n_rows - 1), (-1, n_rows - 1), 8),
        ("LINEABOVE", (0, n_rows - 1), (-1, n_rows - 1), 1.5, PRIMARY),
    ]
    table.setStyle(TableStyle(style_cmds))
    elements.append(table)

    if len(operations) > 500:
        elements.append(Spacer(1, 8))
        elements.append(Paragraph(
            f"Note : seules les 500 premières opérations sur {len(operations)} sont affichées.",
            subtitle_style
        ))

    doc.build(elements)


def _describe_filters(filters: dict) -> str:
    parts = []
    if filters.get("categories"):
        parts.append(", ".join(filters["categories"]))
    if filters.get("type") == "debit":
        parts.append("Dépenses")
    elif filters.get("type") == "credit":
        parts.append("Recettes")
    return " | ".join(parts) if parts else "Tous"


# ─── Excel Generation ───

def _generate_excel_v2(operations: list[dict], filepath: Path, title: str):
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, numbers
    except ImportError:
        raise RuntimeError("openpyxl non installé")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Opérations"

    header_font = Font(bold=True, color="FFFFFF", size=10)
    header_fill = PatternFill(start_color="811971", end_color="811971", fill_type="solid")
    total_fill = PatternFill(start_color="F0E8EF", end_color="F0E8EF", fill_type="solid")
    border = Border(
        left=Side(style="thin", color="DDDDDD"), right=Side(style="thin", color="DDDDDD"),
        top=Side(style="thin", color="DDDDDD"), bottom=Side(style="thin", color="DDDDDD"),
    )

    columns = ["Date", "Libellé", "Catégorie", "Sous-catégorie", "Débit", "Crédit"]

    for ci, name in enumerate(columns, 1):
        cell = ws.cell(row=1, column=ci, value=name)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = border

    for ri, op in enumerate(operations, 2):
        for ci, col in enumerate(columns, 1):
            val = op.get(col, "")
            if col in ("Débit", "Crédit"):
                val = val if val else 0
            cell = ws.cell(row=ri, column=ci, value=val)
            cell.border = border
            if col in ("Débit", "Crédit"):
                cell.number_format = '#,##0.00 €'
                cell.alignment = Alignment(horizontal="right")

    # Totals row
    n = len(operations) + 2
    ws.cell(row=n, column=2, value="TOTAUX").font = Font(bold=True)
    for ci in (5, 6):
        col_letter = openpyxl.utils.get_column_letter(ci)
        cell = ws.cell(row=n, column=ci, value=f"=SUM({col_letter}2:{col_letter}{n - 1})")
        cell.font = Font(bold=True)
        cell.fill = total_fill
        cell.number_format = '#,##0.00 €'
        cell.border = border

    widths = [12, 40, 18, 18, 14, 14]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    # Sheet 2: Category summary (if > 10 ops)
    if len(operations) > 10:
        ws2 = wb.create_sheet("Résumé")
        cat_stats: dict[str, dict] = {}
        for op in operations:
            cat = op.get("Catégorie", "Non catégorisé") or "Non catégorisé"
            if cat not in cat_stats:
                cat_stats[cat] = {"debit": 0, "credit": 0, "count": 0}
            cat_stats[cat]["debit"] += op.get("Débit", 0)
            cat_stats[cat]["credit"] += op.get("Crédit", 0)
            cat_stats[cat]["count"] += 1

        h2 = ["Catégorie", "Nb ops", "Total Débit", "Total Crédit", "Solde"]
        for ci, name in enumerate(h2, 1):
            cell = ws2.cell(row=1, column=ci, value=name)
            cell.font = header_font
            cell.fill = header_fill
            cell.border = border

        for ri, (cat, s) in enumerate(sorted(cat_stats.items()), 2):
            vals = [cat, s["count"], s["debit"], s["credit"], s["credit"] - s["debit"]]
            for ci, v in enumerate(vals, 1):
                cell = ws2.cell(row=ri, column=ci, value=v)
                cell.border = border
                if ci >= 3:
                    cell.number_format = '#,##0.00 €'

        for i, w in enumerate([25, 10, 15, 15, 15], 1):
            ws2.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
        ws2.freeze_panes = "A2"

    wb.save(str(filepath))


# ─── Helpers ───

def _format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} o"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} Ko"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} Mo"


# ─── Favorites ───

def toggle_favorite(filename: str) -> Optional[dict]:
    index = _load_index()
    for r in index["reports"]:
        if r["filename"] == filename:
            r["favorite"] = not r.get("favorite", False)
            _save_index(index)
            return r
    return None


# ─── Report Tree (triple vue) ───

def get_report_tree() -> dict:
    """Construit un arbre triple vue : by_year, by_category, by_format."""
    reports = get_all_reports()

    # By year
    by_year_map: dict[int, list[dict]] = {}
    no_year: list[dict] = []
    for r in reports:
        y = r.get("year")
        if y:
            by_year_map.setdefault(y, []).append(r)
        else:
            no_year.append(r)

    by_year = []
    for y in sorted(by_year_map.keys(), reverse=True):
        children = []
        # Group by quarter/month
        by_month: dict[int, int] = {}
        for r in by_year_map[y]:
            m = r.get("month") or 0
            by_month[m] = by_month.get(m, 0) + 1
        for m in sorted(by_month.keys()):
            label = MOIS_FR[m - 1].capitalize() if 1 <= m <= 12 else "Général"
            children.append({"id": f"year-{y}-{m}", "label": label, "count": by_month[m], "children": []})
        by_year.append({"id": f"year-{y}", "label": str(y), "count": len(by_year_map[y]), "children": children, "icon": "Calendar"})
    if no_year:
        by_year.append({"id": "year-none", "label": "Non daté", "count": len(no_year), "children": []})

    # By category
    by_cat_map: dict[str, int] = {}
    no_cat = 0
    for r in reports:
        cats = (r.get("filters") or {}).get("categories")
        if cats:
            for c in cats:
                by_cat_map[c] = by_cat_map.get(c, 0) + 1
        else:
            no_cat += 1

    by_category = []
    for cat in sorted(by_cat_map.keys()):
        by_category.append({"id": f"cat-{cat}", "label": cat, "count": by_cat_map[cat], "children": [], "icon": "Tag"})
    if no_cat:
        by_category.append({"id": "cat-none", "label": "Toutes catégories", "count": no_cat, "children": []})

    # By format
    by_fmt_map: dict[str, int] = {}
    for r in reports:
        fmt = r.get("format", "pdf")
        by_fmt_map[fmt] = by_fmt_map.get(fmt, 0) + 1

    fmt_icons = {"pdf": "FileText", "csv": "Sheet", "excel": "Table2"}
    by_format = []
    for fmt in ["pdf", "csv", "excel"]:
        if fmt in by_fmt_map:
            by_format.append({"id": f"fmt-{fmt}", "label": fmt.upper(), "count": by_fmt_map[fmt], "children": [], "icon": fmt_icons.get(fmt, "FileText")})

    return {"by_year": by_year, "by_category": by_category, "by_format": by_format}


# ─── Pending Reports (rappels) ───

def get_pending_reports(year: int) -> list[dict]:
    """Retourne les rapports mensuels manquants pour les mois passés."""
    now = datetime.now()
    current_month = now.month if year == now.year else (12 if year < now.year else 0)

    reports = get_all_reports()
    generated_months: set[int] = set()
    for r in reports:
        if r.get("year") == year and r.get("month"):
            generated_months.add(r["month"])

    pending = []
    for m in range(1, current_month + 1):
        if m not in generated_months:
            label = MOIS_FR[m - 1].capitalize()
            pending.append({
                "type": "mensuel",
                "period": f"{label} {year}",
                "message": f"Rapport {label} {year} non généré",
                "year": year,
                "month": m,
                "quarter": None,
            })

    # Check quarterly
    generated_quarters: set[int] = set()
    for r in reports:
        if r.get("year") == year and r.get("quarter"):
            generated_quarters.add(r["quarter"])

    current_q = (current_month - 1) // 3 + 1
    for q in range(1, current_q + 1):
        q_end_month = q * 3
        if q_end_month <= current_month and q not in generated_quarters:
            pending.append({
                "type": "trimestriel",
                "period": f"T{q} {year}",
                "message": f"Rapport trimestriel T{q} {year} non généré",
                "year": year,
                "month": None,
                "quarter": q,
            })

    return pending


# ─── Compare Reports ───

def compare_reports(filename_a: str, filename_b: str) -> dict:
    """Compare deux rapports et retourne les deltas."""
    index = _load_index()
    report_a = None
    report_b = None
    for r in index["reports"]:
        if r["filename"] == filename_a:
            report_a = r
        if r["filename"] == filename_b:
            report_b = r

    if not report_a or not report_b:
        raise ValueError("Un ou plusieurs rapports introuvables")

    delta_debit = report_a["total_debit"] - report_b["total_debit"]
    delta_credit = report_a["total_credit"] - report_b["total_credit"]
    delta_ops = report_a["nb_operations"] - report_b["nb_operations"]
    delta_debit_pct = (delta_debit / report_b["total_debit"] * 100) if report_b["total_debit"] else 0
    delta_credit_pct = (delta_credit / report_b["total_credit"] * 100) if report_b["total_credit"] else 0

    return {
        "report_a": report_a,
        "report_b": report_b,
        "delta_debit": round(delta_debit, 2),
        "delta_credit": round(delta_credit, 2),
        "delta_ops": delta_ops,
        "delta_debit_pct": round(delta_debit_pct, 1),
        "delta_credit_pct": round(delta_credit_pct, 1),
    }


# Legacy compatibility
def list_report_files() -> list[dict]:
    """Legacy: liste tous les rapports (compatible avec l'ancien code)."""
    return get_all_reports()
