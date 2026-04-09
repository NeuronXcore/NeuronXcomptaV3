"""
Service pour l'export du compte d'attente (PDF & CSV).
Genere des fichiers par mois ou par annee, les enregistre dans la GED.
"""
from __future__ import annotations

import io
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import (
    IMPORTS_OPERATIONS_DIR, EXPORTS_DIR, REPORTS_DIR, MOIS_FR, ASSETS_DIR, APP_NAME,
    ensure_directories,
)
from backend.services import operation_service
from backend.services.export_service import _format_amount_fr, _safe_float

logger = logging.getLogger(__name__)


# ─── Helpers ───

def _export_filename(year: int, month: Optional[int], ext: str) -> str:
    """compte_attente_janvier.pdf ou compte_attente_2025.pdf"""
    if month:
        mois_label = MOIS_FR[month - 1].lower()
        return f"compte_attente_{mois_label}.{ext}"
    else:
        return f"compte_attente_{year}.{ext}"


def _collect_attente_operations(year: int, month: Optional[int] = None) -> list:
    """
    Collecte toutes les operations en attente pour l'annee (et mois si specifie).
    Filtre : compte_attente == True OU categorie vide/None/"Autres".
    """
    ensure_directories()
    all_ops = []

    if not IMPORTS_OPERATIONS_DIR.exists():
        return all_ops

    op_files = operation_service.list_operation_files()
    for f in op_files:
        if f.get("year") != year:
            continue
        if month and f.get("month") != month:
            continue

        try:
            operations = operation_service.load_operations(f["filename"])
        except Exception as e:
            logger.warning("Impossible de charger %s: %s", f["filename"], e)
            continue

        for i, op in enumerate(operations):
            cat = (op.get("Catégorie") or op.get("Categorie") or "").strip()
            is_attente = op.get("compte_attente", False)
            is_empty_cat = cat in ("", "Autres", "Non catégorisé", "?")

            if is_attente or is_empty_cat:
                # Normaliser les champs
                debit = _safe_float(op.get("Débit") or op.get("Debit") or 0)
                credit = _safe_float(op.get("Crédit") or op.get("Credit") or 0)
                alertes = op.get("alertes", []) or []
                alerte_types = ", ".join(alertes) if alertes else "a_categoriser"

                all_ops.append({
                    "Date": op.get("Date", ""),
                    "Libelle": op.get("Libellé") or op.get("Libelle") or "",
                    "Categorie": cat,
                    "Sous_categorie": (op.get("Sous-catégorie") or op.get("Sous_categorie") or "").strip(),
                    "Debit": debit,
                    "Credit": credit,
                    "Type_alerte": alerte_types,
                    "Commentaire": op.get("Commentaire") or op.get("alerte_note") or "",
                })

    # Tri par date croissante
    all_ops.sort(key=lambda o: o.get("Date", ""))
    return all_ops


# ─── CSV ───

def _generate_csv(operations: list, year: int, month: Optional[int]) -> str:
    """Genere le CSV du compte d'attente. BOM UTF-8, ;, CRLF, montants FR."""
    columns = ["Date", "Libellé", "Catégorie", "Sous-catégorie", "Débit", "Crédit", "Type alerte", "Commentaire"]
    lines = [";".join(columns)]

    if not operations:
        lines.append(";".join(["", "Aucune opération en compte d'attente", "", "", "0,00", "0,00", "", ""]))
    else:
        for op in operations:
            debit_str = _format_amount_fr(op["Debit"]) if op["Debit"] > 0 else "0,00"
            credit_str = _format_amount_fr(op["Credit"]) if op["Credit"] > 0 else "0,00"
            libelle = op.get("Libelle", "")
            if ";" in libelle:
                libelle = f'"{libelle}"'
            comment = op.get("Commentaire", "") or ""
            if ";" in comment:
                comment = f'"{comment}"'
            lines.append(";".join([
                op.get("Date", ""),
                libelle,
                op.get("Categorie", ""),
                op.get("Sous_categorie", ""),
                debit_str,
                credit_str,
                op.get("Type_alerte", ""),
                comment,
            ]))

    # Totaux
    total_debit = sum(o["Debit"] for o in operations)
    total_credit = sum(o["Credit"] for o in operations)
    solde = total_credit - total_debit
    lines.append("")
    lines.append(";".join([
        "", "TOTAL", "", "",
        _format_amount_fr(total_debit),
        _format_amount_fr(total_credit),
        "", f"Solde: {_format_amount_fr(solde)}",
    ]))
    lines.append(";".join([
        "", f"{len(operations)} opération(s) en compte d'attente",
        "", "", "", "", "", "",
    ]))

    content = "\r\n".join(lines) + "\r\n"
    return "\ufeff" + content


# ─── PDF ───

def _generate_pdf(operations: list, year: int, month: Optional[int]) -> bytes:
    """Genere un PDF du compte d'attente avec logo, tableau, recapitulatif, footer page."""
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

    # Styles
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CATitle", parent=styles["Heading1"],
        fontSize=16, spaceAfter=2, alignment=TA_CENTER,
    )
    sub_style = ParagraphStyle(
        "CASub", parent=styles["Normal"],
        fontSize=10, spaceAfter=2, textColor=colors.HexColor("#666666"),
        alignment=TA_CENTER,
    )
    date_style = ParagraphStyle(
        "CADate", parent=styles["Normal"],
        fontSize=9, spaceAfter=10, textColor=colors.HexColor("#999999"),
        alignment=TA_CENTER,
    )
    cell_style = ParagraphStyle(
        "CACell", parent=styles["Normal"], fontSize=7, leading=9,
    )
    cell_right = ParagraphStyle(
        "CACellR", parent=styles["Normal"], fontSize=7, leading=9, alignment=TA_RIGHT,
    )
    recap_style = ParagraphStyle(
        "CARecap", parent=styles["Normal"], fontSize=9, leading=13,
    )
    recap_bold = ParagraphStyle(
        "CARecapB", parent=styles["Normal"], fontSize=10, leading=13,
        fontName="Helvetica-Bold",
    )
    empty_style = ParagraphStyle(
        "CAEmpty", parent=styles["Normal"], fontSize=11, leading=14,
        textColor=colors.HexColor("#888888"), alignment=TA_CENTER,
    )

    # Colonnes
    usable_w = page_w - 2 * margin_lr
    col_date = 65
    col_debit = 75
    col_credit = 75
    col_cat = 80
    col_subcat = 70
    col_alerte = 90
    col_libelle = usable_w - col_date - col_debit - col_credit - col_cat - col_subcat - col_alerte
    col_widths = [col_date, col_libelle, col_cat, col_subcat, col_debit, col_credit, col_alerte]

    # Titre periode
    if month:
        period_label = f"{MOIS_FR[month - 1].capitalize()} {year}"
    else:
        period_label = f"Année {year}"

    # Footer callback
    footer_info = {"period": period_label}

    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setStrokeColor(colors.HexColor("#CCCCCC"))
        y_line = margin_tb - 8 * mm
        canvas.line(margin_lr, y_line, page_w - margin_lr, y_line)
        canvas.drawString(margin_lr, y_line - 4 * mm, f"Page {doc.page}")
        gen_date = datetime.now().strftime("%d/%m/%Y %H:%M")
        right_text = f"{APP_NAME} — Compte d'attente — {footer_info['period']} — {gen_date}"
        canvas.drawRightString(page_w - margin_lr, y_line - 4 * mm, right_text)
        canvas.restoreState()

    # Document
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

    # Logo
    logo_path = ASSETS_DIR / "logo_lockup_light_400.png"
    if logo_path.exists():
        try:
            logo = Image(str(logo_path), width=120, height=40)
            logo.hAlign = "LEFT"
            elements.append(logo)
            elements.append(Spacer(1, 6))
        except Exception:
            pass

    elements.append(Paragraph("Compte d'Attente", title_style))
    elements.append(Paragraph(period_label, sub_style))
    nb_ops = len(operations)
    elements.append(Paragraph(
        f"Généré le {datetime.now().strftime('%d/%m/%Y')} — {nb_ops} opération(s)",
        date_style,
    ))
    elements.append(Spacer(1, 8))

    # Cas vide
    if not operations:
        elements.append(Spacer(1, 40))
        elements.append(Paragraph(
            "Aucune opération en compte d'attente pour cette période",
            empty_style,
        ))
        elements.append(Spacer(1, 20))
    else:
        # Tableau
        headers = ["Date", "Libellé", "Catégorie", "Sous-cat.", "Débit", "Crédit", "Type alerte"]
        table_data = [headers]

        for op in operations:
            debit_str = _format_amount_fr(op["Debit"]) if op["Debit"] > 0 else ""
            credit_str = _format_amount_fr(op["Credit"]) if op["Credit"] > 0 else ""
            table_data.append([
                op.get("Date", ""),
                Paragraph(str(op.get("Libelle", ""))[:90], cell_style),
                str(op.get("Categorie", "")),
                str(op.get("Sous_categorie", "")),
                Paragraph(debit_str, cell_right),
                Paragraph(credit_str, cell_right),
                str(op.get("Type_alerte", "")),
            ])

        style_cmds = [
            # Header
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
            ("ALIGN", (4, 1), (5, -1), "RIGHT"),
        ]

        # Alternance couleurs
        for i in range(1, len(table_data)):
            if i % 2 == 0:
                style_cmds.append(
                    ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F9F9F9"))
                )

        table = Table(table_data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle(style_cmds))
        elements.append(table)

    elements.append(Spacer(1, 12))

    # Recapitulatif
    total_debit = sum(o["Debit"] for o in operations)
    total_credit = sum(o["Credit"] for o in operations)
    solde = total_credit - total_debit

    recap_data = [
        [Paragraph("<b>Récapitulatif</b>", recap_bold), "", ""],
        ["Total Débits", _format_amount_fr(total_debit), ""],
        ["Total Crédits", _format_amount_fr(total_credit), ""],
        [Paragraph("<b>Solde</b>", recap_bold), Paragraph(f"<b>{_format_amount_fr(solde)}</b>", recap_bold), ""],
        ["", "", ""],
    ]

    # Comptage par type d'alerte
    alerte_counts: dict[str, int] = {}
    for op in operations:
        for a in (op.get("Type_alerte", "") or "").split(", "):
            a = a.strip()
            if a:
                alerte_counts[a] = alerte_counts.get(a, 0) + 1

    if alerte_counts:
        recap_data.append([Paragraph("<b>Par type d'alerte</b>", recap_bold), "", ""])
        for atype, count in sorted(alerte_counts.items()):
            recap_data.append([f"  {atype}", str(count), ""])

    recap_table = Table(recap_data, colWidths=[200, 120, usable_w - 320])
    recap_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8E8E8")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 3), (1, 3), 1, colors.HexColor("#333333")),
    ]))
    elements.append(recap_table)

    doc.build(elements)
    return buffer.getvalue()


# ─── GED Deduplication ───

def _find_existing_ged_entry(year: int, month: Optional[int], ext: str) -> Optional[str]:
    """Cherche un document GED existant avec le meme report_type/year/month/format."""
    from backend.services.ged_service import load_metadata

    metadata = load_metadata()
    docs = metadata.get("documents", {})

    for doc_id, doc in docs.items():
        if doc.get("type") != "rapport":
            continue
        rmeta = doc.get("rapport_meta") or {}
        filters = rmeta.get("filters") or {}
        if (
            filters.get("report_type") == "compte_attente"
            and filters.get("year") == year
            and filters.get("month") == month
            and rmeta.get("format") == ext
        ):
            return doc.get("filename") or Path(doc_id).name

    return None


# ─── Orchestrateur ───

def export_compte_attente(year: int, month: Optional[int], fmt: str) -> dict:
    """
    Genere l'export du compte d'attente (CSV ou PDF), l'enregistre dans data/exports/
    et dans la GED. Retourne AlerteExportResponse.
    """
    ensure_directories()
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    operations = _collect_attente_operations(year, month)

    filename = _export_filename(year, month, fmt)
    # Stocker dans REPORTS_DIR (scanné par la GED) + copie dans EXPORTS_DIR (download)
    reports_path = REPORTS_DIR / filename
    exports_path = EXPORTS_DIR / filename

    if fmt == "csv":
        content = _generate_csv(operations, year, month)
        reports_path.write_text(content, encoding="utf-8")
        exports_path.write_text(content, encoding="utf-8")
    elif fmt == "pdf":
        pdf_bytes = _generate_pdf(operations, year, month)
        reports_path.write_bytes(pdf_bytes)
        exports_path.write_bytes(pdf_bytes)
    else:
        raise ValueError(f"Format non supporté: {fmt}")

    output_path = reports_path

    total_debit = sum(o["Debit"] for o in operations)
    total_credit = sum(o["Credit"] for o in operations)

    # Enregistrement GED
    try:
        from backend.services.ged_service import register_rapport

        # Deduplication
        replaced = _find_existing_ged_entry(year, month, fmt)

        period_label = MOIS_FR[month - 1].capitalize() if month else f"Année"
        title = f"Compte d'attente — {period_label} {year}"

        register_rapport(
            filename=filename,
            path=str(output_path),
            title=title,
            description=f"{len(operations)} opération(s) en attente",
            filters={
                "year": year,
                "month": month,
                "report_type": "compte_attente",
                "categories": ["__compte_attente__"],
            },
            format_type=fmt,
            template_id=None,
            replaced_filename=replaced,
        )
        logger.info("Export compte d'attente enregistré dans la GED: %s", filename)
    except Exception as e:
        logger.warning("Impossible d'enregistrer dans la GED: %s", e)

    return {
        "filename": filename,
        "nb_operations": len(operations),
        "total_debit": total_debit,
        "total_credit": total_credit,
    }
