"""
Service pour l'export d'un snapshot du drawer CategoryDetailDrawer (Compta Analytique)
en rapport PDF dans la GED.

Le frontend capture la `div` du drawer en PNG via html-to-image, l'envoie au backend
qui l'enrobe dans un PDF A4 (1 page, scaling proportionnel pour préserver le ratio)
et l'enregistre comme rapport GED standard via `register_rapport()`.

Pattern miroir des PDFs de `charges_forfaitaires_service` mais ad-hoc (pas templaté
— pas de dédup par filters, on ajoute un timestamp pour qu'un même utilisateur puisse
en empiler plusieurs en cours d'analyse).
"""
from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Optional

from backend.core.config import REPORTS_DIR, MOIS_FR, ensure_directories
from backend.services import ged_service

logger = logging.getLogger(__name__)


def _slugify(value: str) -> str:
    """Lowercase + strip diacritics + non-alnum → underscore. Pour filenames."""
    if not value:
        return "categorie"
    nfd = unicodedata.normalize("NFKD", value)
    ascii_only = "".join(c for c in nfd if not unicodedata.combining(c))
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_only).strip("_").lower()
    return cleaned or "categorie"


def _format_period_label(year: Optional[int], month: Optional[int], quarter: Optional[int]) -> str:
    """Label humain pour le titre du PDF."""
    if year is None:
        return "période non précisée"
    if month is not None and 1 <= month <= 12:
        return f"{MOIS_FR[month - 1]} {year}"
    if quarter is not None and 1 <= quarter <= 4:
        return f"T{quarter} {year}"
    return f"Année {year}"


def export_category_snapshot(
    png_bytes: bytes,
    category: str,
    year: Optional[int],
    month: Optional[int] = None,
    quarter: Optional[int] = None,
    title: Optional[str] = None,
) -> dict:
    """Wrap PNG bytes dans un PDF A4 1-page, save dans REPORTS_DIR, register en GED.

    Le PDF contient :
    - Header avec titre auto (catégorie + période) et date de capture
    - L'image PNG centrée, redimensionnée pour rentrer dans la page (max 170mm × 240mm)
      avec préservation du ratio
    - Footer minimal "Snapshot Compta Analytique"

    Retourne dict {filename, path, doc_id, ged_url, title}.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        Image as RLImage,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
    )

    ensure_directories()

    period_label = _format_period_label(year, month, quarter)
    auto_title = title or f"Snapshot — {category} · {period_label}"

    # Filename : snapshot_{slug-cat}_{year}{month?}{quarter?}_{ts}.pdf
    # On laisse un timestamp pour permettre plusieurs snapshots en cours d'analyse
    # sans déduplication agressive (l'utilisateur peut en empiler).
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    cat_slug = _slugify(category)
    period_part = ""
    if year is not None:
        period_part = f"_{year}"
        if month is not None:
            period_part += f"-{month:02d}"
        elif quarter is not None:
            period_part += f"-T{quarter}"
    filename = f"snapshot_{cat_slug}{period_part}_{ts}.pdf"
    pdf_path = REPORTS_DIR / filename

    # Calcul des dimensions de l'image. PNG client-side a un ratio variable selon le
    # contenu (drawer ~700px wide × hauteur variable). On scale pour rentrer dans
    # A4 portrait (170mm × 240mm utile après marges 20mm × 28mm pour header+footer).
    from PIL import Image as PILImage
    pil_img = PILImage.open(BytesIO(png_bytes))
    img_w_px, img_h_px = pil_img.size
    if img_w_px <= 0 or img_h_px <= 0:
        raise ValueError("PNG dimensions invalides (0×0)")

    # Cible : on prend la plus grande taille qui rentre dans 170mm × 240mm sans
    # déformer (préservation du ratio).
    max_w_mm = 170.0
    max_h_mm = 240.0
    img_ratio = img_w_px / img_h_px
    max_ratio = max_w_mm / max_h_mm
    if img_ratio >= max_ratio:
        # Image plus large que la zone → bornée par la largeur
        target_w_mm = max_w_mm
        target_h_mm = max_w_mm / img_ratio
    else:
        # Image plus haute → bornée par la hauteur
        target_h_mm = max_h_mm
        target_w_mm = max_h_mm * img_ratio

    # Build PDF
    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=15 * mm,
        bottomMargin=12 * mm,
        title=auto_title,
        author="NeuronXcompta",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "SnapshotTitle",
        parent=styles["Heading2"],
        fontSize=12,
        textColor=colors.HexColor("#3C3489"),
        spaceAfter=4,
    )
    meta_style = ParagraphStyle(
        "SnapshotMeta",
        parent=styles["Normal"],
        fontSize=8,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=8,
    )
    footer_style = ParagraphStyle(
        "SnapshotFooter",
        parent=styles["Normal"],
        fontSize=7,
        textColor=colors.HexColor("#94a3b8"),
        alignment=1,  # center
    )

    captured_at = datetime.now().strftime("%d/%m/%Y à %H:%M")
    story = [
        Paragraph(auto_title, title_style),
        Paragraph(f"Capturé le {captured_at} · Compta Analytique", meta_style),
        RLImage(BytesIO(png_bytes), width=target_w_mm * mm, height=target_h_mm * mm),
        Spacer(1, 6 * mm),
        Paragraph(
            "Snapshot du drawer Compta Analytique — vue figée à un instant T.",
            footer_style,
        ),
    ]
    doc.build(story)

    # Register en GED comme rapport standard.
    # Filters : on passe year/month/quarter/category pour que la GED puisse trier/filtrer
    # naturellement (axe période + axe catégorie).
    filters = {
        "year": year,
        "month": month,
        "quarter": quarter,
        "categories": [category] if category else [],
    }
    description = (
        f"Snapshot capturé le {captured_at}. "
        f"Vue figée du drawer Compta Analytique pour la catégorie « {category} » "
        f"sur la période {period_label}."
    )

    try:
        ged_service.register_rapport(
            filename=filename,
            path=str(pdf_path),
            title=auto_title,
            description=description,
            filters=filters,
            format_type="pdf",
            template_id=None,  # Snapshot ad-hoc, pas de template
        )
        # Enrichissement : marquer ce rapport comme snapshot via rapport_meta
        # (permet à la UI de différencier d'un rapport templaté classique).
        metadata = ged_service.load_metadata()
        docs = metadata.get("documents", {})
        # Le doc_id est généré par register_rapport — on le retrouve par filename
        for doc_id, doc in docs.items():
            if doc.get("filename") == filename and doc.get("type") == "rapport":
                doc.setdefault("rapport_meta", {})
                doc["rapport_meta"]["report_type"] = "snapshot_categorie"
                doc["rapport_meta"]["source_module"] = "compta-analytique"
                doc["rapport_meta"]["snapshot_period"] = period_label
                ged_service.save_metadata(metadata)
                ged_doc_id = doc_id
                break
        else:
            ged_doc_id = f"rapports/{filename}"
    except Exception as exc:
        logger.error("Failed to register snapshot in GED: %s", exc)
        ged_doc_id = None

    return {
        "filename": filename,
        "path": str(pdf_path),
        "doc_id": ged_doc_id,
        "title": auto_title,
        "period_label": period_label,
        "size_bytes": pdf_path.stat().st_size if pdf_path.exists() else 0,
    }
