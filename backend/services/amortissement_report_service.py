"""
PDF rapport "État des amortissements {year}".

ReportLab A4 portrait : logo + titre + tableau registre des dotations annuelles
+ totaux + récapitulatif + référence légale (art. 39-1-2° CGI / PCG 214-13).

Pattern strict blanchissage/repas/véhicule (charges_forfaitaires_service).
"""
from __future__ import annotations

import logging
from pathlib import Path

from backend.core.config import ASSETS_DIR

logger = logging.getLogger(__name__)


def _fr_euro(montant: float) -> str:
    """1 234,56 €"""
    if montant is None:
        return "0,00 €"
    formatted = f"{montant:,.2f}"
    return formatted.replace(",", " ").replace(".", ",") + " €"


def _format_date_fr(iso: str) -> str:
    """2024-03-15 → 15/03/2024"""
    if not iso or len(iso) < 10:
        return iso or ""
    return f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}"


def generate_dotation_pdf(year: int, output_path: Path) -> Path:
    """Génère le PDF 'État des amortissements {year}' et retourne `output_path`.

    Structure : logo + titre + tableau registre (1 ligne par immo contributive)
    + ligne totaux + récapitulatif + référence légale.
    """
    # Import différé pour éviter le cycle amortissement_service ↔ amortissement_report_service
    from backend.services import amortissement_service
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        Image,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    detail = amortissement_service.get_virtual_detail(year)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    styles = getSampleStyleSheet()
    story: list = []

    # Logo
    logo_path = ASSETS_DIR / "logo_lockup_light_400.png"
    if logo_path.exists():
        story.append(Image(str(logo_path), width=60 * mm, height=15 * mm))
        story.append(Spacer(1, 5 * mm))

    # Titre
    story.append(Paragraph(
        f"État des amortissements — Exercice {year}",
        styles["Title"],
    ))
    story.append(Spacer(1, 4 * mm))

    # Tableau registre — 1 ligne par immo contributive
    headers = [
        "Désignation", "Acquis le", "Durée", "Base",
        "VNC début", "Dotation", "Q-part", "VNC fin", "Poste",
    ]
    data: list[list[str]] = [headers]

    if detail.nb_immos_actives == 0:
        data.append(["Aucune immobilisation active sur l'exercice", "", "", "", "", "", "", "", ""])
    else:
        for immo in detail.immos:
            designation = immo.designation or ""
            if len(designation) > 35:
                designation = designation[:35] + "…"
            data.append([
                designation,
                _format_date_fr(immo.date_acquisition),
                f"{immo.duree} ans",
                _fr_euro(immo.base_amortissable),
                _fr_euro(immo.vnc_debut),
                _fr_euro(immo.dotation_deductible),
                f"{immo.quote_part_pro:.0f} %",
                _fr_euro(immo.vnc_fin),
                immo.poste or "—",
            ])

        # Ligne totaux
        data.append([
            "TOTAL", "", "", "",
            "",
            _fr_euro(detail.total_deductible),
            "", "", "",
        ])

    table = Table(
        data,
        repeatRows=1,
        colWidths=[
            45 * mm, 20 * mm, 15 * mm, 22 * mm, 22 * mm,
            22 * mm, 12 * mm, 22 * mm, 20 * mm,
        ],
    )

    style_cmds: list = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3C3489")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
        ("ALIGN", (3, 1), (7, -1), "RIGHT"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]

    if detail.nb_immos_actives > 0:
        style_cmds += [
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EEEDFE")),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ]

    table.setStyle(TableStyle(style_cmds))
    story.append(table)
    story.append(Spacer(1, 6 * mm))

    # Récapitulatif
    recap_text = (
        f"<b>Dotation brute de l'exercice :</b> {_fr_euro(detail.total_brute)}<br/>"
        f"<b>Dotation déductible :</b> {_fr_euro(detail.total_deductible)}<br/>"
        f"<b>Immobilisations actives :</b> {detail.nb_immos_actives}"
    )
    story.append(Paragraph(recap_text, styles["Normal"]))
    story.append(Spacer(1, 8 * mm))

    # Référence légale
    ref_style = ParagraphStyle(
        "ref",
        parent=styles["Italic"],
        fontSize=8,
        textColor=colors.HexColor("#666666"),
    )
    story.append(Paragraph(
        "Référence : art. 39-1-2° du CGI, PCG art. 214-13 (amortissement linéaire "
        "avec pro rata temporis). Régime BNC — comptabilité de recettes.",
        ref_style,
    ))

    doc.build(story)
    logger.info(
        "PDF dotation amortissements généré: %s (%d immos, %.2f € déductible)",
        output_path.name, detail.nb_immos_actives, detail.total_deductible,
    )
    return output_path
