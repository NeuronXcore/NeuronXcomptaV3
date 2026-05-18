"""Génération du rapport PDF de vérification de plaquette comptable.

Le rapport PDF est l'output central du module : il agrège la synthèse BNC,
les anomalies à régulariser (statut a_challenger), les points méthodologiques
en discussion, et le tableau complet par poste comptable.

Format : A4 portrait, ReportLab, logo NeuronX, ~3-5 pages typique.

Le PDF est enregistré dans `data/reports/` et référencé en GED comme
`type: "rapport"` avec `rapport_meta.report_type = "plaquette_check"`.
"""
from __future__ import annotations

import logging
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


def _fr_pct(value: Optional[float], decimals: int = 1) -> str:
    if value is None:
        return "—"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:.{decimals}f} %"


# ─── Références juridiques BOI / CGI / PCG ───
# Chaque entrée a un id (clé), un titre, le texte officiel (extrait court), une URL BOFIP/Légifrance.
# Le matching item → référence se fait par mots-clés présents dans le commentaire de l'item.

_BOI_CGI_REFERENCES: dict[str, dict] = {
    "forfait_repas": {
        "title": "BOI-BNC-BASE-40-60-§50 + article 93 CGI — Forfait repas pris seul sur le lieu de travail",
        "extrait": (
            "Les frais supplémentaires de repas constitués par la fraction qui excède la "
            "valeur du repas pris à domicile (5,35 € en 2025) et qui n'excède pas le plafond "
            "des frais de restauration (20,20 € en 2025) sont déductibles, sous réserve que "
            "le contribuable justifie de l'éloignement entre son lieu d'exercice et son domicile. "
            "La déduction maximale est de 14,85 € par repas en 2025."
        ),
        "url": "https://bofip.impots.gouv.fr/bofip/3185-PGP.html/identifiant=BOI-BNC-BASE-40-60",
        "keywords": ["BOI-BNC-BASE-40-60", "forfait repas", "BNC-BASE-40-60"],
    },
    "immobilisations_seuil": {
        "title": "Article 38 sexies annexe III CGI + BOI-BIC-CHG-20-30-30-§40 — Seuil d'immobilisation",
        "extrait": (
            "Le matériel et l'outillage de faible valeur (≤ 500 € HT, soit 600 € TTC) peuvent "
            "être passés directement en charges au titre de l'exercice de leur acquisition, "
            "par mesure de simplification. Au-delà de ce seuil, l'immobilisation est obligatoire "
            "(PCG art. 211-6) avec amortissement sur la durée d'usage. Le caractère professionnel "
            "doit être démontré pour chaque acquisition."
        ),
        "url": "https://bofip.impots.gouv.fr/bofip/3214-PGP.html/identifiant=BOI-BIC-CHG-20-30-30",
        "keywords": ["38 sexies", "BOI-BIC-CHG-20-30-30", "seuil 500", "immobilis"],
    },
    "honoraires_retrocedes": {
        "title": "Article 240 CGI + BOI-BNC-DECLA-10-30 — Honoraires rétrocédés et déclaration DAS2",
        "extrait": (
            "Les honoraires versés à des tiers (remplaçants, confrères) sont déductibles du revenu "
            "non commercial sous réserve d'être inscrits sur la déclaration DAS2 lorsqu'ils "
            "atteignent ou excèdent 1 200 € par bénéficiaire et par an (article 240 CGI). "
            "Le bénéficiaire, la nature de la prestation et le montant doivent être documentés."
        ),
        "url": "https://bofip.impots.gouv.fr/bofip/3231-PGP.html/identifiant=BOI-BNC-DECLA-10-30",
        "keywords": ["BOI-BNC-DECLA-10-30", "article 240", "DAS2", "honoraires rétrocédés"],
    },
    "pieces_justificatives": {
        "title": "Article 93 CGI + BOI-BNC-BASE-40-10-§20 — Caractère probant des pièces",
        "extrait": (
            "Pour être déductible, une charge professionnelle doit être justifiée par une pièce "
            "probante détaillée mentionnant la nature de la dépense, son montant, sa date et le "
            "fournisseur. Le caractère professionnel de la dépense doit être démontrable. "
            "Une simple écriture comptable sans facture rattachée est insuffisante en cas de contrôle."
        ),
        "url": "https://bofip.impots.gouv.fr/bofip/3187-PGP.html/identifiant=BOI-BNC-BASE-40-10",
        "keywords": ["BOI-BNC-BASE-40-10", "article 93", "pièce justif"],
    },
    "quote_part_vehicule": {
        "title": "BOI-BNC-BASE-40-60-40 + article 39-4° CGI — Frais de véhicule et quote-part professionnelle",
        "extrait": (
            "Les frais de véhicule (crédit-bail, carburant, entretien, assurance) sont déductibles "
            "au prorata de l'usage professionnel. L'usage professionnel doit être démontré par "
            "un carnet de bord ou un calcul kilométrique justifié (distance domicile-travail × "
            "nombre de trajets + kilomètres supplémentaires professionnels, rapporté au total annuel). "
            "Les amortissements sont par ailleurs plafonnés selon la classe CO2 du véhicule (art. 39-4° CGI)."
        ),
        "url": "https://bofip.impots.gouv.fr/bofip/3186-PGP.html/identifiant=BOI-BNC-BASE-40-60",
        "keywords": ["BOI-BNC-BASE-40-60-40", "39-4", "quote-part véhicule", "QP véhicule"],
    },
    "csg_reforme_2025": {
        "title": "Article 154 quinquies CGI + Décret 2024-688 du 5/7/2024 — Assiette unifiée CSG/CRDS 2025",
        "extrait": (
            "La contribution sociale généralisée (CSG) est déductible du revenu imposable à hauteur "
            "de 6,8 % de l'assiette sociale. À compter de 2025 (décret 2024-688), l'assiette unifiée "
            "des cotisations sociales pour les TNS BNC est désormais égale au BNC × 74 % (abattement 26 %). "
            "Le reste — CSG non déductible (2,4 %) + CRDS (0,5 %) — n'est pas admis en déduction fiscale "
            "et constitue une charge personnelle."
        ),
        "url": "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000049998497/",
        "keywords": ["154 quinquies", "Décret 2024-688", "réforme 2025", "BNC × 0,74", "abattement 26"],
    },
    "dotations_amort": {
        "title": "Article 39-1-2° CGI + PCG art. 214-13 — Amortissements et plan nominatif",
        "extrait": (
            "Les amortissements sont admis en déduction dans la limite de ceux généralement admis "
            "d'après les usages de chaque nature d'industrie, commerce ou exploitation. Chaque "
            "immobilisation doit faire l'objet d'un plan d'amortissement nominatif documenté "
            "(date d'acquisition, base amortissable, durée, mode linéaire ou exceptionnel) consigné "
            "dans le registre des immobilisations. La conservation du registre est obligatoire."
        ),
        "url": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033817781/",
        "keywords": ["39-1-2", "PCG 214-13", "registre immobilisations", "plan amortissement"],
    },
    "blanchissage": {
        "title": "BOI-BNC-BASE-40-20 — Frais de blanchissage professionnel forfaitaire",
        "extrait": (
            "Les frais d'entretien et de blanchissage des vêtements professionnels (blouses, "
            "pantalons, serviettes) peuvent être évalués forfaitairement sur la base du tarif "
            "qu'aurait coûté un pressing professionnel, avec une décote de 30 % lorsque "
            "le blanchissage est effectué à domicile. Le forfait s'applique par jour travaillé."
        ),
        "url": "https://bofip.impots.gouv.fr/bofip/3186-PGP.html/identifiant=BOI-BNC-BASE-40-20",
        "keywords": ["BOI-BNC-BASE-40-20", "blanchissage", "décote domicile"],
    },
}


# ─── Statuts ───


_STATUT_LABELS = {
    "non_revu": "Non revu",
    "ok": "OK",
    "a_challenger": "À CHALLENGER",
    "refus_justifie": "Refus justifié",
    "en_discussion": "En discussion",
    "resolu": "Résolu",
}

_STATUT_COLORS = {
    "non_revu": "#9CA3AF",
    "ok": "#16A34A",
    "a_challenger": "#D97706",
    "refus_justifie": "#DC2626",
    "en_discussion": "#0EA5E9",
    "resolu": "#10B981",
}


# ─── Generation principale ───


def generate_report(year: int, output_path: Optional[Path] = None) -> Path:
    """Génère le PDF de vérification plaquette pour l'année donnée.

    Retourne le chemin du PDF généré (dans REPORTS_DIR par défaut).
    """
    from backend.services import plaquette_service

    data = plaquette_service.get(year)
    if data is None:
        raise ValueError(f"Plaquette {year} introuvable — créez-la d'abord via /api/plaquette/{year}")

    if output_path is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        output_path = REPORTS_DIR / f"verification_plaquette_{year}_{ts}.pdf"

    _render_pdf(data, year, output_path)
    return output_path


def _render_pdf(data: dict, year: int, output_path: Path) -> None:
    """Rend le PDF avec ReportLab."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        Image as RLImage, PageBreak, KeepTogether,
    )

    styles = getSampleStyleSheet()
    style_title = ParagraphStyle(
        "title", parent=styles["Heading1"], fontSize=18, leading=22,
        textColor=colors.HexColor("#3C3489"), spaceAfter=4, alignment=0,
    )
    style_subtitle = ParagraphStyle(
        "subtitle", parent=styles["Normal"], fontSize=10, leading=14,
        textColor=colors.HexColor("#6B7280"), spaceAfter=10,
    )
    style_h2 = ParagraphStyle(
        "h2", parent=styles["Heading2"], fontSize=13, leading=17,
        textColor=colors.HexColor("#3C3489"), spaceBefore=16, spaceAfter=8,
        borderPadding=4,
    )
    style_h3 = ParagraphStyle(
        "h3", parent=styles["Heading3"], fontSize=11, leading=14,
        textColor=colors.HexColor("#1F2937"), spaceBefore=10, spaceAfter=4,
    )
    style_body = ParagraphStyle(
        "body", parent=styles["Normal"], fontSize=9, leading=12,
        textColor=colors.HexColor("#1F2937"),
    )
    style_callout = ParagraphStyle(
        "callout", parent=styles["Normal"], fontSize=10, leading=14,
        textColor=colors.HexColor("#854F0B"),
        backColor=colors.HexColor("#FEF3C7"),
        borderPadding=8, spaceAfter=12,
    )
    style_callout_ok = ParagraphStyle(
        "callout_ok", parent=styles["Normal"], fontSize=10, leading=14,
        textColor=colors.HexColor("#3B6D11"),
        backColor=colors.HexColor("#EAF3DE"),
        borderPadding=8, spaceAfter=12,
    )
    style_callout_info = ParagraphStyle(
        "callout_info", parent=styles["Normal"], fontSize=9, leading=12,
        textColor=colors.HexColor("#0F4A6B"),
        backColor=colors.HexColor("#DBEAFE"),
        borderPadding=8, spaceAfter=10,
    )
    style_small = ParagraphStyle(
        "small", parent=styles["Normal"], fontSize=8, leading=10,
        textColor=colors.HexColor("#6B7280"),
    )
    style_comment = ParagraphStyle(
        "comment", parent=styles["Normal"], fontSize=8.5, leading=11,
        textColor=colors.HexColor("#1F2937"), leftIndent=6,
    )

    doc = SimpleDocTemplate(
        str(output_path), pagesize=A4,
        topMargin=15 * mm, bottomMargin=15 * mm,
        leftMargin=15 * mm, rightMargin=15 * mm,
        title=f"Vérification plaquette {year}",
        author="NeuronXcompta",
    )

    story: list = []

    # ─── Header logo + titre ───
    logo_path = ASSETS_DIR / "logo_lockup_light_400.png"
    if logo_path.exists():
        try:
            logo = RLImage(str(logo_path), width=50 * mm, height=14 * mm)
            logo.hAlign = "LEFT"
            story.append(logo)
            story.append(Spacer(1, 6))
        except Exception:
            pass

    story.append(Paragraph(
        f"Vérification de la plaquette comptable — Exercice {year}", style_title
    ))
    cabinet = data.get("cabinet_template", "sygnatures_marenco").replace("_", " ").title()
    now_fr = datetime.now().strftime("%d/%m/%Y à %H:%M")
    story.append(Paragraph(
        f"Cabinet comptable : <b>{cabinet}</b> · Édité le {now_fr}", style_subtitle
    ))

    # ─── Section 1 : Synthèse BNC ───
    story.append(Paragraph("1. Synthèse BNC fiscal", style_h2))

    totaux = data.get("totaux_plaquette", {}) or {}
    recettes_p = totaux.get("recettes")
    depenses_p = totaux.get("depenses")
    benefice_p = totaux.get("benefice")
    recettes_n1 = totaux.get("recettes_n1")
    benefice_n1 = totaux.get("benefice_n1")

    # Calculer NeuronX en agrégeant les montant_neuronx (charges déductibles)
    items = data.get("items", []) or []
    recettes_nx = _resolve_recettes_neuronx(year)
    bnc_nx = _resolve_bnc_neuronx(year)
    # charges déductibles NeuronX ≈ somme montant_neuronx hors recettes/bilan/dotation
    charges_nx = _resolve_charges_neuronx(year)

    def _var_n1(actual, n1):
        if actual is None or n1 is None or n1 == 0:
            return None
        return ((actual - n1) / abs(n1)) * 100

    synthese_rows = [
        ["", "Plaquette", "NeuronX", "Écart", "vs N-1"],
        [
            Paragraph("<b>Recettes pro</b>", style_body),
            _fr_euro(recettes_p),
            _fr_euro(recettes_nx),
            _fr_signed_euro(recettes_nx - recettes_p if (recettes_nx is not None and recettes_p is not None) else None),
            _fr_pct(_var_n1(recettes_p, recettes_n1)),
        ],
        [
            Paragraph("<b>Charges déductibles</b>", style_body),
            _fr_euro(depenses_p),
            _fr_euro(charges_nx),
            _fr_signed_euro(charges_nx - depenses_p if (charges_nx is not None and depenses_p is not None) else None),
            _fr_pct(_var_n1(depenses_p, totaux.get("depenses_n1"))),
        ],
        [
            Paragraph("<b>Bénéfice fiscal (BNC)</b>", style_body),
            _fr_euro(benefice_p),
            _fr_euro(bnc_nx),
            _fr_signed_euro(bnc_nx - benefice_p if (bnc_nx is not None and benefice_p is not None) else None),
            _fr_pct(_var_n1(benefice_p, benefice_n1)),
        ],
    ]
    t = Table(synthese_rows, colWidths=[42 * mm, 32 * mm, 32 * mm, 32 * mm, 22 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3C3489")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BACKGROUND", (0, 3), (-1, 3), colors.HexColor("#EEEDFE")),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, 2), [colors.HexColor("#F9FAFB"), colors.white]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D1D5DB")),
    ]))
    story.append(t)
    story.append(Spacer(1, 8))

    # Callout pédagogique sur l'écart BNC
    if bnc_nx is not None and benefice_p is not None:
        ecart_bnc = bnc_nx - benefice_p
        if abs(ecart_bnc) < 2000:
            txt = f"<b>BNC NeuronX et BNC comptable convergent à {_fr_euro(abs(ecart_bnc))} près</b> — l'écart est dans la marge d'erreur méthodologique (quote-parts, arrondis, choix conservateurs). Aucune action critique."
            story.append(Paragraph(txt, style_callout_ok))
        elif ecart_bnc < 0:
            txt = f"<b>BNC NeuronX inférieur de {_fr_euro(abs(ecart_bnc))} au BNC comptable.</b> NeuronX a déduit davantage de charges (forfait repas, abonnements, immobilisations…) qui n'apparaissent pas dans la 2035. Économie d'impôts potentielle si les anomalies ci-dessous sont régularisées."
            story.append(Paragraph(txt, style_callout))
        else:
            txt = f"<b>BNC NeuronX supérieur de {_fr_euro(ecart_bnc)} au BNC comptable.</b> Le comptable a déduit des charges absentes de NeuronX (à investiguer) ou applique une méthode plus large."
            story.append(Paragraph(txt, style_callout))

    # Récap statuts
    counts = {}
    for it in items:
        s = it.get("statut", "non_revu")
        counts[s] = counts.get(s, 0) + 1

    statut_rows = [["Statut", "Nombre", "Description"]]
    desc_map = {
        "a_challenger": "Anomalies à régulariser (sujet email au comptable)",
        "en_discussion": "Points méthodologiques à clarifier",
        "ok": "Postes en correspondance correcte",
        "non_revu": "Postes non encore audités",
        "refus_justifie": "Refus du comptable validé par le patient",
        "resolu": "Anomalies résolues après échange",
    }
    for k in ["a_challenger", "en_discussion", "ok", "non_revu", "refus_justifie", "resolu"]:
        if counts.get(k):
            statut_rows.append([
                _STATUT_LABELS[k],
                str(counts.get(k, 0)),
                desc_map.get(k, ""),
            ])
    if len(statut_rows) > 1:
        t = Table(statut_rows, colWidths=[40 * mm, 20 * mm, 100 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3F4F6")),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (1, 0), (1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D1D5DB")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(t)

    # ─── Section 2 : Anomalies à régulariser (a_challenger) ───
    a_challenger = [i for i in items if i.get("statut") == "a_challenger"]
    if a_challenger:
        story.append(Paragraph(
            f"2. Anomalies à régulariser ({len(a_challenger)})", style_h2
        ))
        story.append(Paragraph(
            "Postes pour lesquels NeuronX et la plaquette comptable présentent un écart significatif "
            "nécessitant une clarification ou une régularisation. Le commentaire détaille l'argumentaire à transmettre au comptable. "
            "Pour chaque ligne, le top 10 des opérations NeuronX concernées est listé en pièce de preuve.",
            style_small,
        ))
        story.append(Spacer(1, 6))

        for idx, item in enumerate(a_challenger, 1):
            story.append(_render_anomaly_card(
                item, idx, style_h3, style_body, style_comment, style_small,
                mm, colors, Table, TableStyle, Paragraph, Spacer, KeepTogether,
                year=year, include_ops=True,
            ))

    # ─── Section 3 : Points méthodologiques en discussion ───
    en_discussion = [i for i in items if i.get("statut") == "en_discussion"]
    if en_discussion:
        story.append(Paragraph(
            f"3. Points méthodologiques à clarifier ({len(en_discussion)})", style_h2
        ))
        story.append(Paragraph(
            "Postes où l'écart est dû à une différence méthodologique (réforme fiscale, mode de calcul, "
            "ventilation comptable) plutôt qu'à une erreur. À discuter pour aligner les approches.",
            style_callout_info,
        ))

        for idx, item in enumerate(en_discussion, 1):
            story.append(_render_anomaly_card(
                item, idx, style_h3, style_body, style_comment, style_small,
                mm, colors, Table, TableStyle, Paragraph, Spacer, KeepTogether,
                year=year, include_ops=False,
            ))

    # ─── Section 4 : Tableau complet ───
    story.append(PageBreak())
    story.append(Paragraph("4. Tableau complet par poste comptable", style_h2))

    table_rows = [["PCG", "Libellé", "Plaquette", "NeuronX", "Écart", "Statut"]]
    for item in sorted(items, key=lambda i: i.get("compte_pcg") or ""):
        pcg = item.get("compte_pcg") or "—"
        lbl = (item.get("compte_label") or "")[:38]
        mp = item.get("montant_plaquette")
        mn = item.get("montant_neuronx")
        ec = item.get("ecart")
        statut = _STATUT_LABELS.get(item.get("statut", "non_revu"), "—")
        table_rows.append([
            pcg, lbl,
            _fr_euro(mp), _fr_euro(mn),
            _fr_signed_euro(ec) if ec is not None else "—",
            statut,
        ])

    t = Table(table_rows, colWidths=[20 * mm, 60 * mm, 28 * mm, 28 * mm, 28 * mm, 26 * mm], repeatRows=1)

    table_style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3C3489")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 8.5),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("ALIGN", (2, 0), (4, -1), "RIGHT"),
        ("ALIGN", (5, 0), (5, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D1D5DB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]
    # Coloration par statut (texte)
    for i, item in enumerate(sorted(items, key=lambda x: x.get("compte_pcg") or ""), start=1):
        statut = item.get("statut", "non_revu")
        col = _STATUT_COLORS.get(statut, "#9CA3AF")
        table_style.append(("TEXTCOLOR", (5, i), (5, i), colors.HexColor(col)))
        if statut == "a_challenger":
            table_style.append(("FONTNAME", (5, i), (5, i), "Helvetica-Bold"))
    t.setStyle(TableStyle(table_style))
    story.append(t)

    story.append(Spacer(1, 14))
    story.append(Paragraph(
        f"Rapport généré par NeuronXcompta v3.0 — Exercice {year} — {data.get('cabinet_template', 'sygnatures_marenco')} "
        f"— {len(items)} postes analysés — Génération atomique {now_fr}",
        style_small,
    ))

    # ─── Section 5 : Annexe juridique (références BOI/CGI/PCG) ───
    cited_refs = _detect_cited_references(items)
    if cited_refs:
        story.append(PageBreak())
        story.append(Paragraph(
            f"5. Annexe — Références juridiques ({len(cited_refs)})", style_h2
        ))
        story.append(Paragraph(
            "Textes officiels invoqués dans l'argumentaire ci-dessus. Ces références sont "
            "extraites automatiquement des commentaires des items à challenger et en discussion. "
            "Elles permettent au comptable de vérifier la doctrine applicable.",
            style_callout_info,
        ))

        for ref_key in cited_refs:
            ref = _BOI_CGI_REFERENCES[ref_key]
            story.append(_render_legal_card(
                ref, style_h3, style_body, style_comment, style_small,
                mm, colors, Table, TableStyle, Paragraph, Spacer, KeepTogether,
            ))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)


def _detect_cited_references(items: list[dict]) -> list[str]:
    """Pour chaque item en a_challenger/en_discussion, détecte les BOI/CGI cités
    via mots-clés dans le commentaire. Retourne la liste des clés `_BOI_CGI_REFERENCES`
    pertinentes, dans l'ordre où elles apparaissent.

    Le blanchissage est toujours cité s'il y a au moins 1 item OK lié (pour mémoire).
    """
    relevant = [
        i for i in items
        if i.get("statut") in ("a_challenger", "en_discussion", "ok")
    ]
    cited: list[str] = []
    for ref_key, ref in _BOI_CGI_REFERENCES.items():
        keywords = [k.lower() for k in ref.get("keywords", [])]
        if not keywords:
            continue
        for item in relevant:
            haystack = f"{item.get('commentaire') or ''} {item.get('compte_label') or ''}".lower()
            if any(k in haystack for k in keywords):
                cited.append(ref_key)
                break
    return cited


def _render_legal_card(
    ref: dict,
    style_h3, style_body, style_comment, style_small,
    mm, colors, Table, TableStyle, Paragraph, Spacer, KeepTogether,
):
    """Card d'une référence juridique : titre + extrait + URL."""
    title = ref.get("title", "")
    extrait = ref.get("extrait", "")
    url = ref.get("url", "")

    title_p = Paragraph(f"<b>{title}</b>", style_h3)
    extrait_p = Paragraph(
        f"<i>{extrait.replace(chr(10), '<br/>')}</i>",
        style_comment,
    )
    url_p = Paragraph(
        f"<font size='7' color='#3C3489'><i>Source : <link href='{url}'>{url}</link></i></font>",
        style_small,
    )
    return KeepTogether([title_p, Spacer(1, 4), extrait_p, Spacer(1, 3), url_p, Spacer(1, 10)])


def _render_anomaly_card(
    item: dict, idx: int,
    style_h3, style_body, style_comment, style_small,
    mm, colors, Table, TableStyle, Paragraph, Spacer, KeepTogether,
    year: Optional[int] = None,
    include_ops: bool = False,
):
    """Carde anomalie/discussion : header + montants + commentaire + (optionnel) top 10 ops NeuronX.

    Si `include_ops=True` et `year` fourni, ajoute une mini-table des 10 plus grosses
    opérations NeuronX correspondantes (pour les anomalies a_challenger).
    """
    pcg = item.get("compte_pcg") or "—"
    label = item.get("compte_label") or "—"
    mp = item.get("montant_plaquette")
    mn = item.get("montant_neuronx")
    ec = item.get("ecart")
    commentaire = item.get("commentaire") or "(aucun commentaire)"
    rubrique = item.get("rubrique_2035")
    cats = item.get("categories_neuronx") or []
    item_id = item.get("item_id") or ""

    statut = item.get("statut", "a_challenger")
    accent_color = _STATUT_COLORS.get(statut, "#D97706")

    # Header card : numéro + compte + libellé + rubrique
    head_data = [
        [
            Paragraph(f"<b>{idx}. Compte {pcg} — {label}</b>", style_h3),
            Paragraph(f"<i>Rubrique 2035 : {rubrique or 'n/a'}</i><br/>"
                      f"<i>Cat. NeuronX : {', '.join(cats) if cats else 'n/a'}</i>", style_comment),
        ]
    ]
    head = Table(head_data, colWidths=[110 * mm, 70 * mm])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 1.5, colors.HexColor(accent_color)),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    # Tableau montants
    montant_data = [
        ["Plaquette", "NeuronX", "Écart"],
        [_fr_euro(mp), _fr_euro(mn), _fr_signed_euro(ec)],
    ]
    montants = Table(montant_data, colWidths=[50 * mm, 50 * mm, 50 * mm])
    ecart_color = "#16A34A" if (ec is not None and abs(ec) < 100) else ("#DC2626" if (ec is not None and ec < 0) else "#D97706")
    montants.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3F4F6")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
        ("TEXTCOLOR", (2, 1), (2, 1), colors.HexColor(ecart_color)),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D1D5DB")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))

    # Commentaire — la valeur ajoutée argumentaire
    commentaire_html = (
        commentaire
        .replace("\n", "<br/>")
        .replace("&", "&amp;")
        .replace("⚠️", "<font color='#D97706'>⚠</font>")
    )
    com = Paragraph(f"<b>Argumentaire :</b> {commentaire_html}", style_comment)

    elements = [head, Spacer(1, 4), montants, Spacer(1, 4), com]

    # Drill-down ops NeuronX (uniquement pour a_challenger)
    if include_ops and year is not None and item_id:
        try:
            from backend.services import plaquette_service
            ops = plaquette_service.list_drill_ops(year, item_id, limit=10)
        except Exception as e:
            logger.warning("list_drill_ops failed for %s: %s", item_id, e)
            ops = []

        if ops:
            ops_table = _render_ops_table(
                ops, style_small, mm, colors, Table, TableStyle, Paragraph,
                accent_color=accent_color,
            )
            elements.append(Spacer(1, 6))
            elements.append(Paragraph(
                f"<b>Top {len(ops)} opérations NeuronX correspondantes</b> "
                f"<font size='7' color='#6B7280'>(triées par montant décroissant)</font>",
                style_comment,
            ))
            elements.append(Spacer(1, 2))
            elements.append(ops_table)
            # Légende
            elements.append(Paragraph(
                "<font size='7' color='#6B7280'><i>📎 = justificatif associé · 🔒 = opération verrouillée</i></font>",
                style_small,
            ))

    elements.append(Spacer(1, 10))
    return KeepTogether(elements)


def _render_ops_table(
    ops: list, style_small,
    mm, colors, Table, TableStyle, Paragraph,
    accent_color: str = "#D97706",
):
    """Mini-table : Date | Libellé | Montant | 📎🔒 pour les drill-down ops."""
    rows = [["Date", "Libellé", "Montant", ""]]
    for op in ops:
        date = (op.get("date") or "")[:10]  # YYYY-MM-DD
        # Reformat YYYY-MM-DD → DD/MM/YYYY pour lisibilité
        if len(date) == 10 and date[4] == "-":
            date = f"{date[8:10]}/{date[5:7]}/{date[0:4]}"
        lib = (op.get("libelle") or "")[:55]
        debit = float(op.get("debit") or 0)
        flags = []
        if op.get("justificatif"):
            flags.append("📎")
        if op.get("locked"):
            flags.append("🔒")
        rows.append([
            date,
            Paragraph(f"<font size='7'>{lib}</font>", style_small),
            _fr_euro(debit),
            " ".join(flags),
        ])
    t = Table(rows, colWidths=[22 * mm, 100 * mm, 28 * mm, 18 * mm])
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(accent_color)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 7.5),
        ("FONTSIZE", (0, 1), (-1, -1), 7.5),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("ALIGN", (3, 0), (3, -1), "CENTER"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E5E7EB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]
    t.setStyle(TableStyle(style))
    return t


def _footer(canvas, doc):
    """Footer paginé."""
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#9CA3AF"))
    canvas.drawString(15 * mm, 8 * mm, "NeuronXcompta — Vérification plaquette comptable")
    canvas.drawRightString(195 * mm, 8 * mm, f"Page {doc.page}")
    canvas.restoreState()


# ─── Helpers BNC (réutilisent les services existants) ───


def _resolve_recettes_neuronx(year: int) -> Optional[float]:
    try:
        from backend.services import bnc_service
        b = bnc_service.compute_bnc(year)
        return float(b.recettes_pro)
    except Exception:
        return None


def _resolve_charges_neuronx(year: int) -> Optional[float]:
    try:
        from backend.services import bnc_service
        b = bnc_service.compute_bnc(year)
        return float(b.charges_pro)
    except Exception:
        return None


def _resolve_bnc_neuronx(year: int) -> Optional[float]:
    try:
        from backend.services import bnc_service
        b = bnc_service.compute_bnc(year)
        return float(b.bnc)
    except Exception:
        return None


# ─── Registration en GED ───


def _delete_previous_reports(year: int) -> int:
    """Supprime les anciennes versions du rapport plaquette pour cette année.

    Scan le metadata GED pour `type=rapport` + `source_module=plaquette` + même `year`.
    Pour chaque match : supprime l'entrée GED + le fichier sur disque via
    `ged_service.delete_document` (idempotent).

    Returns: nombre d'anciennes versions supprimées.
    """
    from backend.services import ged_service

    metadata = ged_service.load_metadata()
    docs = metadata.get("documents", {})
    to_delete: list[str] = []
    for doc_id, doc in docs.items():
        if doc.get("type") != "rapport":
            continue
        rapport_meta = doc.get("rapport_meta") or {}
        if rapport_meta.get("source_module") != "plaquette":
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
            logger.warning("Suppression ancien rapport plaquette %s échouée: %s", doc_id, e)
    if deleted > 0:
        logger.info("Auto-replace plaquette %s : %d ancienne(s) version(s) supprimée(s)", year, deleted)
    return deleted


def generate_and_register(year: int) -> dict:
    """Génère le PDF + enregistre en GED + retourne les métadonnées.

    **Auto-replace** : supprime les anciennes versions du rapport plaquette pour cette
    année AVANT de générer la nouvelle. La GED ne contient donc qu'un seul rapport
    actif par exercice (le plus récent). Voir `_delete_previous_reports`.

    Returns:
        {filename, ged_doc_id, size_bytes, generated_at, year, replaced_count}
    """
    from backend.services import ged_service

    # 1. Supprimer les anciennes versions (auto-replace)
    replaced_count = _delete_previous_reports(year)

    # 2. Générer le nouveau PDF
    pdf_path = generate_report(year)
    filename = pdf_path.name
    size = pdf_path.stat().st_size

    # Register en GED comme rapport
    try:
        ged_service.register_rapport(
            filename=filename,
            path=str(pdf_path),
            title=f"Vérification plaquette comptable — {year}",
            description=f"Rapport de vérification de la plaquette comptable {year} (synthèse BNC + anomalies argumentées)",
            filters={"year": year, "module": "plaquette_check"},
            format_type="pdf",
            template_id="plaquette_check",
        )
        # Enrichir rapport_meta avec source_module
        from backend.services.ged_service import load_metadata, save_metadata
        metadata = load_metadata()
        # Reconstituer le doc_id comme dans register_rapport
        rel_path = pdf_path.relative_to(Path.cwd()) if pdf_path.is_absolute() else pdf_path
        doc_id = str(rel_path)
        if doc_id in metadata.get("documents", {}):
            metadata["documents"][doc_id]["rapport_meta"]["source_module"] = "plaquette"
            metadata["documents"][doc_id]["rapport_meta"]["report_type"] = "plaquette_check"
            save_metadata(metadata)
        ged_doc_id = doc_id
    except Exception as e:
        logger.warning("Failed to register rapport plaquette in GED: %s", e)
        ged_doc_id = None

    return {
        "filename": filename,
        "ged_doc_id": ged_doc_id,
        "size_bytes": size,
        "generated_at": datetime.now().isoformat(),
        "year": year,
        "replaced_count": replaced_count,
    }
