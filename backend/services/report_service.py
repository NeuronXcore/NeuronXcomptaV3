"""
Service pour la génération de rapports.
Refactoré depuis utils/report_generation.py de V2.
"""

import csv
import hashlib
import io
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd

from backend.core.config import (
    RAPPORTS_DIR, REPORTS_DIR, MOIS_FR, ensure_directories,
)
from backend.services.operation_service import load_operations

logger = logging.getLogger(__name__)


def list_report_files() -> list[dict]:
    """Liste tous les rapports générés."""
    ensure_directories()
    reports = []
    for d in [RAPPORTS_DIR, REPORTS_DIR]:
        if not d.exists():
            continue
        for f in sorted(d.iterdir(), reverse=True):
            if f.suffix in (".pdf", ".csv", ".xlsx"):
                stat = f.stat()
                reports.append({
                    "filename": f.name,
                    "format": f.suffix[1:].upper(),
                    "size": stat.st_size,
                    "size_human": _format_size(stat.st_size),
                    "created": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "path": str(f),
                    "directory": d.name,
                })
    return reports


def get_report_path(filename: str) -> Optional[Path]:
    """Retourne le chemin absolu d'un rapport."""
    for d in [RAPPORTS_DIR, REPORTS_DIR]:
        path = d / filename
        if path.exists():
            return path
    return None


def delete_report(filename: str) -> bool:
    """Supprime un rapport."""
    path = get_report_path(filename)
    if path:
        path.unlink()
        return True
    return False


def generate_report(
    source_files: list[str],
    format: str = "csv",
    filters: Optional[dict] = None,
    title: Optional[str] = None,
) -> dict:
    """
    Génère un rapport à partir des fichiers d'opérations sélectionnés.

    Args:
        source_files: Liste de noms de fichiers JSON à inclure
        format: "csv", "pdf", ou "xlsx"
        filters: Filtres optionnels (category, date_from, date_to, important, a_revoir, etc.)
        title: Titre personnalisé du rapport

    Returns:
        dict avec filename, path, operations_count, etc.
    """
    ensure_directories()

    # 1. Charger et combiner les opérations
    all_operations = []
    for fname in source_files:
        try:
            ops = load_operations(fname)
            all_operations.extend(ops)
        except FileNotFoundError:
            logger.warning(f"Fichier {fname} non trouvé, ignoré")

    if not all_operations:
        raise ValueError("Aucune opération trouvée dans les fichiers sélectionnés")

    # 2. Appliquer les filtres
    filtered = _apply_filters(all_operations, filters or {})

    if not filtered:
        raise ValueError("Aucune opération après application des filtres")

    # 3. Générer le rapport selon le format
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    period = _detect_period(filtered)
    hash_src = hashlib.md5("_".join(source_files).encode()).hexdigest()[:8]

    if format == "csv":
        filename = f"rapport_{hash_src}_{period}_{timestamp}.csv"
        filepath = RAPPORTS_DIR / filename
        _generate_csv(filtered, filepath, title)
    elif format == "pdf":
        filename = f"rapport_{hash_src}_{period}_{timestamp}.pdf"
        filepath = RAPPORTS_DIR / filename
        _generate_pdf(filtered, filepath, title, period)
    elif format == "xlsx":
        filename = f"rapport_{hash_src}_{period}_{timestamp}.xlsx"
        filepath = RAPPORTS_DIR / filename
        _generate_excel(filtered, filepath, title)
    else:
        raise ValueError(f"Format non supporté: {format}")

    # 4. Stats du rapport
    total_debit = sum(op.get("Débit", 0) for op in filtered)
    total_credit = sum(op.get("Crédit", 0) for op in filtered)
    categorized = sum(1 for op in filtered if op.get("Catégorie") and op.get("Catégorie") != "Autres")

    return {
        "filename": filename,
        "format": format.upper(),
        "operations_count": len(filtered),
        "total_debit": total_debit,
        "total_credit": total_credit,
        "solde": total_credit - total_debit,
        "categorized": categorized,
        "period": period,
        "size": filepath.stat().st_size,
        "size_human": _format_size(filepath.stat().st_size),
        "created": datetime.now().isoformat(),
    }


def _apply_filters(operations: list[dict], filters: dict) -> list[dict]:
    """Applique les filtres sur les opérations."""
    result = operations

    # Filtre par catégorie
    if filters.get("category"):
        result = [op for op in result if op.get("Catégorie") == filters["category"]]

    # Filtre par sous-catégorie
    if filters.get("subcategory"):
        result = [op for op in result if op.get("Sous-catégorie") == filters["subcategory"]]

    # Filtre par date
    if filters.get("date_from"):
        date_from = filters["date_from"]
        result = [op for op in result if (op.get("Date", "") or "") >= date_from]

    if filters.get("date_to"):
        date_to = filters["date_to"]
        result = [op for op in result if (op.get("Date", "") or "") <= date_to]

    # Filtre opérations importantes
    if filters.get("important_only"):
        result = [op for op in result if op.get("Important")]

    # Filtre à revoir
    if filters.get("a_revoir_only"):
        result = [op for op in result if op.get("A_revoir")]

    # Filtre avec justificatif
    if filters.get("with_justificatif"):
        result = [op for op in result if op.get("Justificatif")]

    # Filtre montant minimum
    if filters.get("min_amount"):
        min_amt = float(filters["min_amount"])
        result = [op for op in result if max(op.get("Débit", 0), op.get("Crédit", 0)) >= min_amt]

    return result


def _detect_period(operations: list[dict]) -> str:
    """Détecte la période couverte par les opérations."""
    dates = []
    for op in operations:
        d = op.get("Date", "")
        if d:
            dates.append(d)
    if not dates:
        return "sans_date"

    dates.sort()
    first = dates[0]
    last = dates[-1]

    # Essayer d'extraire mois/année
    try:
        parts = first.replace("-", "/").split("/")
        if len(parts) >= 3:
            if len(parts[0]) == 4:  # YYYY-MM-DD
                month = int(parts[1])
                year = parts[0]
            else:  # DD/MM/YYYY
                month = int(parts[1])
                year = parts[2]
            month_name = MOIS_FR[month - 1] if 1 <= month <= 12 else str(month)
            return f"{month_name}_{year}"
    except (ValueError, IndexError):
        pass

    return f"{first}_to_{last}"


def _generate_csv(operations: list[dict], filepath: Path, title: Optional[str] = None):
    """Génère un rapport CSV."""
    columns = [
        "Date", "Libellé", "Débit", "Crédit", "Catégorie",
        "Sous-catégorie", "Justificatif", "Important", "A_revoir", "Commentaire"
    ]

    with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
        # BOM pour Excel
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")

        # Titre en commentaire
        if title:
            f.write(f"# {title}\n")
            f.write(f"# Généré le {datetime.now().strftime('%d/%m/%Y à %H:%M')}\n")
            f.write(f"# {len(operations)} opérations\n")

        writer.writeheader()
        for op in operations:
            row = {}
            for col in columns:
                val = op.get(col, "")
                if isinstance(val, bool):
                    val = "Oui" if val else "Non"
                row[col] = val
            writer.writerow(row)

        # Totaux
        total_debit = sum(op.get("Débit", 0) for op in operations)
        total_credit = sum(op.get("Crédit", 0) for op in operations)
        f.write(f"\n# Total Débits: {total_debit:.2f} EUR\n")
        f.write(f"# Total Crédits: {total_credit:.2f} EUR\n")
        f.write(f"# Solde: {total_credit - total_debit:.2f} EUR\n")


def _generate_pdf(operations: list[dict], filepath: Path, title: Optional[str] = None, period: str = ""):
    """Génère un rapport PDF avec ReportLab."""
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    except ImportError:
        raise RuntimeError("reportlab n'est pas installé. Installez-le avec: pip install reportlab")

    doc = SimpleDocTemplate(
        str(filepath),
        pagesize=landscape(A4),
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Heading1"],
        fontSize=16,
        spaceAfter=12,
        textColor=colors.HexColor("#333333"),
    )
    subtitle_style = ParagraphStyle(
        "ReportSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        spaceAfter=6,
        textColor=colors.HexColor("#666666"),
    )
    small_style = ParagraphStyle(
        "Small",
        parent=styles["Normal"],
        fontSize=7,
        leading=9,
    )

    elements = []

    # Titre
    report_title = title or f"Rapport - {period.replace('_', ' ').title()}"
    elements.append(Paragraph(report_title, title_style))
    elements.append(Paragraph(
        f"Généré le {datetime.now().strftime('%d/%m/%Y à %H:%M')} | {len(operations)} opérations",
        subtitle_style,
    ))
    elements.append(Spacer(1, 12))

    # Résumé financier
    total_debit = sum(op.get("Débit", 0) for op in operations)
    total_credit = sum(op.get("Crédit", 0) for op in operations)
    solde = total_credit - total_debit

    summary_data = [
        ["Total Crédits", f"{total_credit:,.2f} EUR"],
        ["Total Débits", f"{total_debit:,.2f} EUR"],
        ["Solde", f"{solde:,.2f} EUR"],
    ]
    summary_table = Table(summary_data, colWidths=[4 * cm, 5 * cm])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0f0f0")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 16))

    # Tableau des opérations
    headers = ["Date", "Libellé", "Débit", "Crédit", "Catégorie", "Sous-cat."]
    table_data = [headers]

    for op in operations[:200]:  # Limiter à 200 pour le PDF
        row = [
            str(op.get("Date", "")),
            Paragraph(str(op.get("Libellé", ""))[:80], small_style),
            f"{op.get('Débit', 0):.2f}" if op.get("Débit", 0) > 0 else "",
            f"{op.get('Crédit', 0):.2f}" if op.get("Crédit", 0) > 0 else "",
            str(op.get("Catégorie", "")),
            str(op.get("Sous-catégorie", "")),
        ]
        table_data.append(row)

    col_widths = [2.5 * cm, 10 * cm, 2.5 * cm, 2.5 * cm, 3.5 * cm, 3 * cm]
    ops_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    ops_table.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#811971")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        # Body
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("ALIGN", (2, 1), (3, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#dddddd")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9f9f9")]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(ops_table)

    if len(operations) > 200:
        elements.append(Spacer(1, 8))
        elements.append(Paragraph(
            f"Note: Seules les 200 premières opérations sur {len(operations)} sont affichées.",
            subtitle_style,
        ))

    doc.build(elements)


def _generate_excel(operations: list[dict], filepath: Path, title: Optional[str] = None):
    """Génère un rapport Excel multi-feuilles."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    except ImportError:
        raise RuntimeError("openpyxl n'est pas installé. Installez-le avec: pip install openpyxl")

    wb = openpyxl.Workbook()

    # ─── Feuille 1: Opérations ────────────────
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

    columns = ["Date", "Libellé", "Débit", "Crédit", "Catégorie", "Sous-catégorie",
               "Justificatif", "Important", "A_revoir", "Commentaire"]

    # Header
    for col_idx, col_name in enumerate(columns, 1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border

    # Data
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

    # Adjust column widths
    col_widths = [12, 45, 12, 12, 18, 18, 12, 10, 10, 25]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    # Freeze header
    ws.freeze_panes = "A2"

    # ─── Feuille 2: Analyse par catégorie ────────────────
    ws2 = wb.create_sheet("Analyse par catégorie")

    # Calculer les stats par catégorie
    cat_stats = {}
    for op in operations:
        cat = op.get("Catégorie", "Non catégorisé") or "Non catégorisé"
        if cat not in cat_stats:
            cat_stats[cat] = {"debit": 0, "credit": 0, "count": 0}
        cat_stats[cat]["debit"] += op.get("Débit", 0)
        cat_stats[cat]["credit"] += op.get("Crédit", 0)
        cat_stats[cat]["count"] += 1

    total_expenses = sum(v["debit"] for v in cat_stats.values())

    headers2 = ["Catégorie", "Nb Opérations", "Débits", "Crédits", "Montant Net", "% Dépenses"]
    for col_idx, name in enumerate(headers2, 1):
        cell = ws2.cell(row=1, column=col_idx, value=name)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border

    for row_idx, (cat, stats) in enumerate(sorted(cat_stats.items()), 2):
        net = stats["credit"] - stats["debit"]
        pct = (stats["debit"] / total_expenses * 100) if total_expenses > 0 else 0
        values = [cat, stats["count"], stats["debit"], stats["credit"], net, round(pct, 1)]
        for col_idx, val in enumerate(values, 1):
            cell = ws2.cell(row=row_idx, column=col_idx, value=val)
            cell.border = thin_border
            if col_idx in (3, 4, 5):
                cell.number_format = '#,##0.00'

    col_widths2 = [25, 15, 15, 15, 15, 15]
    for i, w in enumerate(col_widths2, 1):
        ws2.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws2.freeze_panes = "A2"

    # ─── Feuille 3: Résumé ────────────────
    ws3 = wb.create_sheet("Résumé")

    total_debit = sum(op.get("Débit", 0) for op in operations)
    total_credit = sum(op.get("Crédit", 0) for op in operations)

    summary_data = [
        ("Rapport", title or "Rapport NeuronXcompta"),
        ("Date de génération", datetime.now().strftime("%d/%m/%Y %H:%M")),
        ("Nombre d'opérations", len(operations)),
        ("Total Débits", total_debit),
        ("Total Crédits", total_credit),
        ("Solde", total_credit - total_debit),
        ("Catégories utilisées", len(cat_stats)),
    ]

    for row_idx, (label, value) in enumerate(summary_data, 1):
        cell_label = ws3.cell(row=row_idx, column=1, value=label)
        cell_label.font = Font(bold=True)
        cell_val = ws3.cell(row=row_idx, column=2, value=value)
        if isinstance(value, float):
            cell_val.number_format = '#,##0.00'

    ws3.column_dimensions["A"].width = 25
    ws3.column_dimensions["B"].width = 30

    wb.save(str(filepath))


def _format_size(size_bytes: int) -> str:
    """Formate la taille en bytes lisible."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
