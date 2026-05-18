"""Génération PDF de réconciliation Plaquette ↔ NeuronX (Session 40 P1.3).

Distinct du `plaquette_report_service.generate_and_register` qui produit le rapport
de vérification (synthèse BNC + anomalies + tableau complet). Ici on génère un
**document compact orienté négociation** : pour chaque poste comptable, on affiche :

  - Le couple Plaquette / NeuronX / Écart (déjà comparatif)
  - La **Position de repli** (% maintenu calibré dans le sous-drawer)
  - La **Contre-proposition** (montant final que je demande au comptable)
  - L'**Ajustement vs comptable** (= contre-proposition − plaquette = ce que je
    demande EN PLUS / EN MOINS par rapport à la position du comptable)

Le PDF est destiné à être joint au mail au comptable pour matérialiser la position
de négociation. Pattern miroir des autres générateurs ReportLab du projet.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.core.config import ASSETS_DIR, REPORTS_DIR

logger = logging.getLogger(__name__)


# ─── Helpers FR ───


def _fr_euro(montant: Optional[float], default: str = "—") -> str:
    if montant is None:
        return default
    formatted = f"{abs(montant):,.2f}".replace(",", " ").replace(".", ",")
    sign = "−" if montant < 0 else ""
    return f"{sign}{formatted} €"


def _fr_signed_euro(montant: Optional[float]) -> str:
    if montant is None:
        return "—"
    formatted = f"{abs(montant):,.2f}".replace(",", " ").replace(".", ",")
    sign = "−" if montant < 0 else "+"
    return f"{sign}{formatted} €"


def _fr_int_euro(montant: Optional[float]) -> str:
    if montant is None:
        return "—"
    formatted = f"{abs(montant):,.0f}".replace(",", " ")
    sign = "−" if montant < 0 else ""
    return f"{sign}{formatted} €"


# ─── Synthèse data ───


def _build_reconciliation_data(year: int) -> dict:
    """Charge les données + agrège par catégorie + détail par poste.

    Retourne dict prêt pour rendering, avec :
      - synthesis (totaux globaux + BNC initial/simulé)
      - by_category (vue groupée par catégorie NeuronX, avec dédup)
      - by_poste (détail par PCG avec ajustement)
    """
    from backend.services import bnc_service, plaquette_service

    data = plaquette_service.get(year)
    if data is None:
        raise ValueError(f"PlaquetteCheck {year} introuvable")
    items = data.get("items", []) or []

    # Vue par poste PCG (source de vérité, pas de double-comptage)
    poste_rows: list[dict] = []
    total_plaq = 0.0
    total_neuronx = 0.0
    total_contre = 0.0
    total_ajustement = 0.0

    for it in items:
        plaq = it.get("montant_plaquette")
        nx = it.get("montant_neuronx")
        ecart = it.get("ecart")
        concession = it.get("concession") or {}
        contre = concession.get("montant_maintenu") if concession else None
        pct = concession.get("pct_maintenu") if concession else None
        ajustement = None
        if contre is not None and plaq is not None:
            ajustement = contre - plaq

        poste_rows.append({
            "pcg": it.get("compte_pcg") or "—",
            "label": it.get("compte_label") or "—",
            "rubrique": it.get("rubrique_2035") or "—",
            "categories": it.get("categories_neuronx") or [],
            "plaquette": plaq,
            "neuronx": nx,
            "ecart": ecart,
            "statut": it.get("statut") or "non_revu",
            "pct_maintenu": pct,
            "contre_proposition": contre,
            "ajustement": ajustement,
            "source": concession.get("source") if concession else None,
        })

        total_plaq += plaq or 0
        total_neuronx += nx or 0
        if contre is not None:
            total_contre += contre
        else:
            # Si pas de concession (item non à challenger), la contre-proposition = plaquette
            total_contre += plaq or 0
        if ajustement is not None:
            total_ajustement += ajustement

    # BNC initial + simulé via bnc_service
    bnc_initial = None
    bnc_simule = None
    try:
        breakdown = bnc_service.compute_bnc(year)
        bnc_initial = float(breakdown.bnc)
        # delta BNC = somme des montant_concede signés (charges only)
        delta_bnc = 0.0
        for it in items:
            c = it.get("concession") or {}
            mc = c.get("montant_concede")
            if mc is not None:
                delta_bnc += float(mc)
        bnc_simule = bnc_initial + delta_bnc
    except Exception as e:
        logger.warning("compute_bnc(%s) failed: %s", year, e)

    # Vue par catégorie NeuronX (informative, déduplique le double-mapping)
    # Pour éviter le double-comptage : assigne chaque item à sa PREMIÈRE catégorie
    cat_rows: dict[str, dict] = defaultdict(lambda: {
        "category": "",
        "n_postes": 0,
        "total_plaquette": 0.0,
        "total_neuronx": 0.0,
        "total_ecart": 0.0,
        "total_contre": 0.0,
        "total_ajustement": 0.0,
        "postes": [],
    })
    for row in poste_rows:
        cats = row["categories"]
        # Toutes les catégories de l'item (multi-mapping affiché tel quel, l'utilisateur
        # comprendra que le total cat n'est pas un sub-total exclusif).
        for cat in cats:
            cat_data = cat_rows[cat]
            cat_data["category"] = cat
            cat_data["n_postes"] += 1
            cat_data["total_plaquette"] += row["plaquette"] or 0
            cat_data["total_neuronx"] += row["neuronx"] or 0
            cat_data["total_ecart"] += row["ecart"] or 0
            if row["contre_proposition"] is not None:
                cat_data["total_contre"] += row["contre_proposition"]
            else:
                cat_data["total_contre"] += row["plaquette"] or 0
            if row["ajustement"] is not None:
                cat_data["total_ajustement"] += row["ajustement"]
            cat_data["postes"].append({
                "pcg": row["pcg"],
                "label": row["label"],
                "plaquette": row["plaquette"],
                "neuronx": row["neuronx"],
                "contre_proposition": row["contre_proposition"],
                "ajustement": row["ajustement"],
            })

    # Tri par |total_ajustement| desc (les plus impactants en haut)
    sorted_cats = sorted(
        cat_rows.values(),
        key=lambda c: abs(c["total_ajustement"]),
        reverse=True,
    )

    return {
        "year": year,
        "generated_at": datetime.now().isoformat(),
        "ged_doc_id": data.get("ged_doc_id"),
        "status": data.get("status", "en_cours"),
        "synthesis": {
            "total_plaquette": total_plaq,
            "total_neuronx": total_neuronx,
            "total_contre_proposition": total_contre,
            "total_ajustement": total_ajustement,
            "bnc_initial": bnc_initial,
            "bnc_simule": bnc_simule,
            "delta_bnc": (bnc_simule - bnc_initial) if (bnc_initial is not None and bnc_simule is not None) else None,
            "nb_postes": len(poste_rows),
            "nb_categories": len(cat_rows),
        },
        "by_category": sorted_cats,
        "by_poste": poste_rows,
    }


# ─── Rendu PDF ReportLab ───


def _build_pdf(data: dict, output_path: Path) -> None:
    """Génère le PDF de réconciliation.

    Layout :
      - Page de garde : titre + métadonnées
      - Synthèse globale : 5 KPI cards (Plaquette / NeuronX / Contre-proposition / Δ BNC / Statut)
      - Vue par catégorie NeuronX (tableau 6 colonnes)
      - Détail par poste comptable (tableau 8 colonnes)
    """
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak,
    )

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=landscape(A4),
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        title=f"Réconciliation plaquette {data['year']}",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title", parent=styles["Heading1"], fontSize=16, textColor=colors.HexColor("#3C3489"),
        spaceAfter=8, fontName="Helvetica-Bold",
    )
    h2_style = ParagraphStyle(
        "H2", parent=styles["Heading2"], fontSize=12, textColor=colors.HexColor("#3C3489"),
        spaceAfter=6, spaceBefore=12, fontName="Helvetica-Bold",
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#1f2937"),
        spaceAfter=4,
    )
    note_style = ParagraphStyle(
        "Note", parent=styles["Normal"], fontSize=7,
        textColor=colors.HexColor("#6b7280"), fontName="Helvetica-Oblique",
    )

    story: list = []

    # ─── Header ─────────────────────────────────────────────────────────────
    logo_path = ASSETS_DIR / "logo_lockup_light_400.png"
    if logo_path.exists():
        try:
            img = Image(str(logo_path), width=42 * mm, height=10.5 * mm)
            img.hAlign = "LEFT"
            story.append(img)
            story.append(Spacer(1, 4 * mm))
        except Exception as e:
            logger.debug("logo load failed: %s", e)

    story.append(Paragraph(
        f"Réconciliation plaquette comptable — Exercice {data['year']}",
        title_style,
    ))
    gen_at = data["generated_at"][:19].replace("T", " ")
    story.append(Paragraph(
        f"Document généré le {gen_at} · Position de négociation par poste comptable",
        note_style,
    ))
    story.append(Spacer(1, 4 * mm))

    # ─── Synthèse globale ───────────────────────────────────────────────────
    synth = data["synthesis"]
    bnc_init_s = _fr_int_euro(synth["bnc_initial"])
    bnc_sim_s = _fr_int_euro(synth["bnc_simule"])
    delta_bnc_s = _fr_signed_euro(synth["delta_bnc"]) if synth["delta_bnc"] is not None else "—"

    synth_data = [
        ["Total Plaquette\ncomptable", "Total NeuronX\nrevendiqué", "Total\nContre-proposition", "Ajustement\nvs comptable", "BNC initial\nNeuronX", "BNC simulé\ndéclaré"],
        [
            _fr_int_euro(synth["total_plaquette"]),
            _fr_int_euro(synth["total_neuronx"]),
            _fr_int_euro(synth["total_contre_proposition"]),
            _fr_signed_euro(synth["total_ajustement"]),
            bnc_init_s,
            bnc_sim_s,
        ],
    ]
    synth_table = Table(synth_data, colWidths=[44 * mm] * 6)
    synth_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEEDFE")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#3C3489")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 7),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTSIZE", (0, 1), (-1, 1), 11),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
        ("TEXTCOLOR", (3, 1), (3, 1), colors.HexColor("#D97706")),  # Ajustement en orange
        ("TEXTCOLOR", (5, 1), (5, 1), colors.HexColor("#7F77DD")),  # BNC simulé violet
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#9CA3AF")),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(synth_table)
    story.append(Spacer(1, 4 * mm))

    delta_label = (
        "BNC monte (moins de charges) — plus d'IR"
        if synth["delta_bnc"] and synth["delta_bnc"] > 0
        else "BNC baisse (plus de charges) — moins d'IR"
        if synth["delta_bnc"] and synth["delta_bnc"] < 0
        else "Pas d'impact BNC"
    )
    story.append(Paragraph(
        f"<b>Impact BNC</b> : {delta_bnc_s} ({delta_label}) — calcul charges concédées. "
        f"<b>{synth['nb_postes']} postes</b> analysés sur <b>{synth['nb_categories']} catégories</b> NeuronX.",
        body_style,
    ))
    story.append(Spacer(1, 4 * mm))

    # ─── Vue par catégorie NeuronX ─────────────────────────────────────────
    story.append(Paragraph("Réconciliation par catégorie NeuronX", h2_style))
    story.append(Paragraph(
        "Tri par ampleur de l'ajustement demandé (vs position du comptable). "
        "Note : un poste PCG peut apparaître dans plusieurs catégories (mapping multi-cat).",
        note_style,
    ))
    story.append(Spacer(1, 2 * mm))

    cat_header = [
        "Catégorie NeuronX", "Postes", "Plaquette", "NeuronX", "Écart", "Contre-prop.", "Ajustement",
    ]
    cat_table_data = [cat_header]
    for c in data["by_category"]:
        cat_table_data.append([
            c["category"],
            str(c["n_postes"]),
            _fr_int_euro(c["total_plaquette"]),
            _fr_int_euro(c["total_neuronx"]),
            _fr_signed_euro(c["total_ecart"]),
            _fr_int_euro(c["total_contre"]),
            _fr_signed_euro(c["total_ajustement"]),
        ])
    # Total row
    cat_table_data.append([
        "TOTAL (cat. multi-mapping inclus)",
        str(sum(c["n_postes"] for c in data["by_category"])),
        _fr_int_euro(sum(c["total_plaquette"] for c in data["by_category"])),
        _fr_int_euro(sum(c["total_neuronx"] for c in data["by_category"])),
        _fr_signed_euro(sum(c["total_ecart"] for c in data["by_category"])),
        _fr_int_euro(sum(c["total_contre"] for c in data["by_category"])),
        _fr_signed_euro(sum(c["total_ajustement"] for c in data["by_category"])),
    ])

    cat_table = Table(cat_table_data, colWidths=[60*mm, 12*mm, 28*mm, 28*mm, 28*mm, 28*mm, 28*mm])
    cat_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3C3489")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 7.5),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("BACKGROUND", (5, 1), (5, -2), colors.HexColor("#EEEDFE")),
        ("TEXTCOLOR", (5, 1), (5, -2), colors.HexColor("#3C3489")),
        ("FONTNAME", (5, 1), (5, -1), "Helvetica-Bold"),
        ("BACKGROUND", (6, 1), (6, -2), colors.HexColor("#FEF3C7")),
        ("TEXTCOLOR", (6, 1), (6, -2), colors.HexColor("#92400E")),
        ("FONTNAME", (6, 1), (6, -1), "Helvetica-Bold"),
        # Total row
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#1F2937")),
        ("TEXTCOLOR", (0, -1), (-1, -1), colors.white),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#F9FAFB")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(cat_table)

    story.append(PageBreak())

    # ─── Détail par poste comptable ────────────────────────────────────────
    story.append(Paragraph("Détail par poste comptable PCG", h2_style))
    story.append(Paragraph(
        "Vue exhaustive de chaque ligne plaquette avec position de repli individuelle. "
        "La colonne <b>Ajustement</b> indique ce que je demande EN PLUS (+) ou EN MOINS (−) "
        "par rapport à la position initiale du comptable.",
        note_style,
    ))
    story.append(Spacer(1, 2 * mm))

    poste_header = [
        "PCG", "Poste comptable", "Catégorie(s) NeuronX", "Plaquette", "NeuronX",
        "%", "Contre-prop.", "Ajustement", "Statut",
    ]
    poste_table_data = [poste_header]
    for r in data["by_poste"]:
        cats_str = ", ".join(r["categories"][:2]) + (f" +{len(r['categories']) - 2}" if len(r["categories"]) > 2 else "")
        pct_s = f"{int(r['pct_maintenu'])}%" if r["pct_maintenu"] is not None else "—"
        statut_short = {
            "non_revu": "Non revu", "ok": "OK", "a_challenger": "Challenger",
            "refus_justifie": "Refus", "en_discussion": "Discussion", "resolu": "Résolu",
        }.get(r["statut"], r["statut"])
        poste_table_data.append([
            r["pcg"][:8],
            r["label"][:30],
            cats_str[:30] or "—",
            _fr_int_euro(r["plaquette"]),
            _fr_int_euro(r["neuronx"]),
            pct_s,
            _fr_int_euro(r["contre_proposition"]) if r["contre_proposition"] is not None else "—",
            _fr_signed_euro(r["ajustement"]) if r["ajustement"] is not None else "—",
            statut_short,
        ])
    # Total
    poste_table_data.append([
        "", f"TOTAL ({len(data['by_poste'])} postes)", "",
        _fr_int_euro(synth["total_plaquette"]),
        _fr_int_euro(synth["total_neuronx"]),
        "",
        _fr_int_euro(synth["total_contre_proposition"]),
        _fr_signed_euro(synth["total_ajustement"]),
        "",
    ])

    poste_table = Table(
        poste_table_data,
        colWidths=[14*mm, 47*mm, 38*mm, 24*mm, 24*mm, 11*mm, 26*mm, 26*mm, 19*mm],
        repeatRows=1,
    )
    poste_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3C3489")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 7),
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("ALIGN", (3, 0), (7, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (6, 1), (6, -2), colors.HexColor("#EEEDFE")),
        ("TEXTCOLOR", (6, 1), (6, -2), colors.HexColor("#3C3489")),
        ("FONTNAME", (6, 1), (6, -1), "Helvetica-Bold"),
        ("BACKGROUND", (7, 1), (7, -2), colors.HexColor("#FEF3C7")),
        ("TEXTCOLOR", (7, 1), (7, -2), colors.HexColor("#92400E")),
        ("FONTNAME", (7, 1), (7, -1), "Helvetica-Bold"),
        # Total
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#1F2937")),
        ("TEXTCOLOR", (0, -1), (-1, -1), colors.white),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#F9FAFB")]),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(poste_table)

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(
        "<b>Lecture</b> : Ajustement <b>positif</b> (+) = je demande au comptable d'augmenter ce poste "
        "dans la déclaration (charges plus élevées → BNC plus bas → moins d'IR). "
        "Ajustement <b>négatif</b> (−) = j'accepte de baisser ma position par rapport à NeuronX initial.",
        note_style,
    ))

    doc.build(story)


# ─── API publique ───


def generate_reconciliation_pdf(year: int) -> Path:
    """Génère le PDF de réconciliation pour l'année, retourne le path."""
    data = _build_reconciliation_data(year)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"reconciliation_plaquette_{year}_{timestamp}.pdf"
    output_path = REPORTS_DIR / filename
    _build_pdf(data, output_path)
    return output_path


def _delete_previous_reconciliation_reports(year: int) -> int:
    """Supprime les anciennes versions du PDF de réconciliation pour cette année.

    Auto-replace : la GED ne contient qu'un seul rapport actif par exercice.
    Préserve les snapshots protégés (Session 39 P1).
    """
    from backend.services import ged_service

    metadata = ged_service.load_metadata()
    docs = metadata.get("documents", {})
    to_delete: list[str] = []
    for doc_id, doc in docs.items():
        if doc.get("type") != "rapport":
            continue
        if doc.get("protected"):
            continue
        rapport_meta = doc.get("rapport_meta") or {}
        if rapport_meta.get("source_module") != "plaquette":
            continue
        if rapport_meta.get("report_type") != "plaquette_reconciliation":
            continue
        doc_year = (rapport_meta.get("filters") or {}).get("year") or doc.get("year")
        if doc_year == year:
            to_delete.append(doc_id)
    deleted = 0
    for doc_id in to_delete:
        try:
            if ged_service.delete_document(doc_id):
                deleted += 1
        except Exception as e:
            logger.warning("Suppression ancien rapport réconciliation %s échouée: %s", doc_id, e)
    return deleted


def generate_and_register(year: int) -> dict:
    """Génère le PDF + enregistre en GED comme rapport (auto-replace).

    Returns:
        {filename, ged_doc_id, size_bytes, generated_at, year, replaced_count}
    """
    from backend.services import ged_service

    replaced_count = _delete_previous_reconciliation_reports(year)

    pdf_path = generate_reconciliation_pdf(year)
    filename = pdf_path.name
    size = pdf_path.stat().st_size

    template_id = "plaquette_reconciliation"
    title = f"Réconciliation plaquette comptable — {year}"
    description = (
        f"Document de négociation : position de repli par poste comptable "
        f"avec ajustements demandés au comptable (exercice {year})"
    )

    try:
        ged_service.register_rapport(
            filename=filename,
            path=str(pdf_path),
            title=title,
            description=description,
            filters={"year": year, "module": "plaquette_reconciliation"},
            format_type="pdf",
            template_id=template_id,
            protected=False,
        )
        from backend.services.ged_service import load_metadata, save_metadata
        metadata = load_metadata()
        rel_path = pdf_path.relative_to(Path.cwd()) if pdf_path.is_absolute() else pdf_path
        doc_id = str(rel_path)
        if doc_id in metadata.get("documents", {}):
            metadata["documents"][doc_id]["rapport_meta"]["source_module"] = "plaquette"
            metadata["documents"][doc_id]["rapport_meta"]["report_type"] = template_id
            save_metadata(metadata)
        ged_doc_id = doc_id
    except Exception as e:
        logger.warning("Failed to register reconciliation rapport in GED: %s", e)
        ged_doc_id = None

    return {
        "filename": filename,
        "ged_doc_id": ged_doc_id,
        "size_bytes": size,
        "generated_at": datetime.now().isoformat(),
        "year": year,
        "replaced_count": replaced_count,
    }
