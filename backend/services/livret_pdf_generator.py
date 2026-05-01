"""
LivretPdfGenerator — produit un PDF paginé du livret figé.

ReportLab A4 portrait, story building. Structure :
  1. Page de garde (logo + titre + type)
  2. Sommaire (table des chapitres)
  3. Chapitres 01 → 09 (Synthèse / Recettes / Charges pro / Forfaitaires / Sociales /
     Amortissements / Provisions / BNC / Annexes)
  4. Pied de page sur toutes les pages : `Livret {year} · Snapshot {date} · Page X/Y`

Cf. prompts.md/prompt-livret-comptable-phase3.md §4.4.
"""
from __future__ import annotations

import logging
from datetime import datetime
from io import BytesIO
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image as RLImage,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from backend.core.config import ASSETS_DIR
from backend.models.livret import Livret, SnapshotType

logger = logging.getLogger(__name__)


# ─── Couleurs / styles ────────────────────────────────────────────

PRIMARY = colors.HexColor("#811971")
PRIMARY_LIGHT = colors.HexColor("#a94199")
TEXT = colors.HexColor("#0f172a")
TEXT_MUTED = colors.HexColor("#64748b")
SURFACE_HOVER = colors.HexColor("#f1f5f9")
BORDER = colors.HexColor("#e2e8f0")
SUCCESS = colors.HexColor("#16a34a")
DANGER = colors.HexColor("#dc2626")
WARNING = colors.HexColor("#d97706")


def _make_styles() -> dict:
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "Title", parent=base["Heading1"],
            fontName="Helvetica-Bold", fontSize=22, leading=26,
            textColor=TEXT, spaceAfter=4,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle", parent=base["Normal"],
            fontName="Helvetica", fontSize=12, leading=16,
            textColor=TEXT_MUTED, spaceAfter=10,
        ),
        "h1": ParagraphStyle(
            "H1", parent=base["Heading2"],
            fontName="Helvetica-Bold", fontSize=15, leading=18,
            textColor=PRIMARY, spaceBefore=8, spaceAfter=4,
        ),
        "h1_num": ParagraphStyle(
            "H1Num", parent=base["Heading2"],
            fontName="Courier-Bold", fontSize=11, leading=13,
            textColor=TEXT_MUTED, spaceAfter=2,
        ),
        "h2": ParagraphStyle(
            "H2", parent=base["Heading3"],
            fontName="Helvetica-Bold", fontSize=11, leading=14,
            textColor=TEXT, spaceBefore=8, spaceAfter=2,
        ),
        "tag": ParagraphStyle(
            "Tag", parent=base["Normal"],
            fontName="Helvetica-Oblique", fontSize=9, leading=11,
            textColor=TEXT_MUTED, spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["Normal"],
            fontName="Helvetica", fontSize=9, leading=12,
            textColor=TEXT,
        ),
        "muted": ParagraphStyle(
            "Muted", parent=base["Normal"],
            fontName="Helvetica", fontSize=8, leading=10,
            textColor=TEXT_MUTED,
        ),
        "muted_italic": ParagraphStyle(
            "MutedItalic", parent=base["Normal"],
            fontName="Helvetica-Oblique", fontSize=8, leading=10,
            textColor=TEXT_MUTED,
        ),
        "right_amount": ParagraphStyle(
            "Amount", parent=base["Normal"],
            fontName="Helvetica", fontSize=9, leading=11,
            textColor=TEXT, alignment=2,  # right
        ),
        "code": ParagraphStyle(
            "Code", parent=base["Normal"],
            fontName="Courier", fontSize=8, leading=10,
            textColor=TEXT,
        ),
    }
    return styles


# ─── Helpers ──────────────────────────────────────────────────────

def _format_currency(value: float) -> str:
    try:
        v = float(value)
    except (TypeError, ValueError):
        v = 0.0
    sign = "-" if v < 0 else ""
    v = abs(v)
    int_part = int(v)
    dec_part = round((v - int_part) * 100)
    if dec_part == 100:
        int_part += 1
        dec_part = 0
    int_str = f"{int_part:,}".replace(",", " ")
    return f"{sign}{int_str},{dec_part:02d} €"


def _format_date_fr(iso_date: str) -> str:
    if not iso_date:
        return ""
    try:
        d = datetime.strptime(iso_date[:10], "%Y-%m-%d")
        return d.strftime("%d/%m/%Y")
    except ValueError:
        return iso_date


def _truncate(text: str, max_len: int = 60) -> str:
    if not text:
        return ""
    s = str(text)
    return s if len(s) <= max_len else s[: max_len - 1] + "…"


def _type_label(snapshot_type: SnapshotType) -> str:
    return {
        SnapshotType.AUTO_MONTHLY: "Auto mensuel",
        SnapshotType.CLOTURE: "Clôture",
        SnapshotType.MANUAL: "Manuel",
    }.get(snapshot_type, snapshot_type.value)


# ─── Page template (header + footer auto) ─────────────────────────

def _make_doc(buf: BytesIO, year: int, snapshot_date: str) -> BaseDocTemplate:
    """Configure le BaseDocTemplate avec en-tête/pied auto (numéro de page)."""
    doc = BaseDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=14 * mm,
        title=f"Livret comptable {year} — {snapshot_date}",
        author="NeuronXcompta",
    )
    frame = Frame(
        doc.leftMargin, doc.bottomMargin,
        doc.width, doc.height,
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
    )

    def _draw_footer(canvas_, _doc_):
        canvas_.saveState()
        canvas_.setFont("Helvetica", 8)
        canvas_.setFillColor(TEXT_MUTED)
        page_num = canvas_.getPageNumber()
        text = f"Livret comptable {year}  ·  Instantané {_format_date_fr(snapshot_date)}  ·  Page {page_num}"
        canvas_.drawRightString(A4[0] - doc.rightMargin, 8 * mm, text)
        canvas_.restoreState()

    template = PageTemplate(id="default", frames=[frame], onPage=_draw_footer)
    doc.addPageTemplates([template])
    return doc


# ─── Rendu chapitre par chapitre ──────────────────────────────────

def _render_metric_card(label: str, value: float, is_proj: bool, styles: dict) -> Table:
    """Une mini-card metric (utilisée 4× dans chap 01)."""
    val_color = TEXT
    label_lower = label.lower()
    if is_proj:
        val_color = PRIMARY
    elif "charges" in label_lower:
        val_color = DANGER
    elif "recettes" in label_lower or "bnc" in label_lower:
        val_color = SUCCESS

    val_style = ParagraphStyle(
        "MetricVal", parent=styles["body"],
        fontName="Helvetica-Bold", fontSize=14, leading=16,
        textColor=val_color, alignment=0,
    )
    label_style = ParagraphStyle(
        "MetricLabel", parent=styles["muted"],
        fontSize=8, alignment=0,
    )
    suffix = " (projeté)" if is_proj else ""
    inner = [
        [Paragraph(f"{label}{suffix}", label_style)],
        [Paragraph(_format_currency(value), val_style)],
    ]
    t = Table(inner, colWidths=[42 * mm])
    border_color = PRIMARY_LIGHT if is_proj else BORDER
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, border_color),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _render_charts_block(ch: dict, styles: dict, max_width_mm: float = 170) -> list:
    """Phase 5 — rend les `ChartConfig` du chapitre en images PNG matplotlib.

    Retourne `[]` si aucun chart. Embed via `RLImage(BytesIO(png))`. Échec gracieux
    (un chart en erreur n'invalide pas le PDF).
    """
    charts = ch.get("charts") or []
    if not charts:
        return []
    from io import BytesIO as _BytesIO
    from backend.services import livret_pdf_charts

    # Adaptateur dict -> structure compatible (similaire au HTML)
    class _A:
        def __init__(self, d: dict):
            self.id = d.get("id", "")
            self.type = d.get("type", "bar")
            self.title = d.get("title", "")
            self.subtitle = d.get("subtitle")
            self.x_label = d.get("x_label")
            self.y_label = d.get("y_label")
            self.total = d.get("total")
            self.series = [_S(s) for s in (d.get("series") or [])]

    class _S:
        def __init__(self, s: dict):
            self.name = s.get("name", "")
            self.color = s.get("color", "#94a3b8")
            self.data = [_P(p) for p in (s.get("data") or [])]

    class _P:
        def __init__(self, p: dict):
            self.x = p.get("x")
            self.y = p.get("y", 0)
            self.color = p.get("color")
            self.meta = p.get("meta") or {}

    out: list = []
    for c_dict in charts:
        try:
            png = livret_pdf_charts.render_chart_png(_A(c_dict), width_mm=max_width_mm, height_mm=85)  # type: ignore[arg-type]
            if not png:
                continue
            img = RLImage(_BytesIO(png), width=max_width_mm * mm, height=85 * mm)
            out.append(img)
            out.append(Spacer(1, 4 * mm))
        except Exception:
            continue
    return out


def _render_cadence_table(cadence: list[dict], styles: dict) -> Table:
    """Cadence mensuelle sous forme de tableau 12 mois (PDF)."""
    if not cadence:
        return Paragraph("<i>Aucune donnée mensuelle</i>", styles["muted_italic"])

    header = ["Mois", "Recettes", "Charges", "Solde", "Statut"]
    rows: list[list] = [header]
    for p in cadence:
        rec = p.get("recettes") or 0
        chg = p.get("charges") or 0
        solde = rec - chg
        if p.get("is_current"):
            statut = "courant"
        elif p.get("is_past"):
            statut = "passé"
        else:
            statut = "projeté"
        rows.append([
            (p.get("label") or "").capitalize(),
            _format_currency(rec),
            _format_currency(chg),
            _format_currency(solde),
            statut,
        ])

    t = Table(rows, colWidths=[20 * mm, 32 * mm, 32 * mm, 32 * mm, 24 * mm], hAlign="LEFT")
    style = TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
        ("BACKGROUND", (0, 0), (-1, 0), SURFACE_HOVER),
        ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_MUTED),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
        ("ALIGN", (1, 1), (3, -1), "RIGHT"),
        ("ALIGN", (4, 1), (4, -1), "CENTER"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SURFACE_HOVER]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ])
    # Coloration projeté en italique discret
    for i, p in enumerate(cadence, start=1):
        if p.get("is_projection"):
            style.add("TEXTCOLOR", (0, i), (-1, i), TEXT_MUTED)
    t.setStyle(style)
    return t


def _render_ops_table(ops: list[dict], styles: dict, max_rows: int = 100) -> list:
    """Rend un tableau d'opérations (Date · Libellé · Montant)."""
    if not ops:
        return [Paragraph("<i>Aucune opération.</i>", styles["muted_italic"])]
    truncated = len(ops) > max_rows
    show = ops[:max_rows]
    rows: list[list] = [["Date", "Libellé", "Cat / Sous-cat", "Montant"]]
    for op in show:
        date_str = _format_date_fr(op.get("date") or "")
        lib = _truncate(op.get("libelle") or "", 50)
        meta = _truncate(op.get("libelle_meta") or "", 32)
        rows.append([
            date_str,
            Paragraph(lib, styles["body"]),
            Paragraph(meta, styles["muted"]) if meta else "",
            _format_currency(op.get("montant") or 0),
        ])

    t = Table(rows, colWidths=[22 * mm, 75 * mm, 50 * mm, 27 * mm], hAlign="LEFT", repeatRows=1)
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7),
        ("BACKGROUND", (0, 0), (-1, 0), SURFACE_HOVER),
        ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_MUTED),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
        ("ALIGN", (3, 0), (3, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, BORDER),
        ("LINEBELOW", (0, 1), (-1, -2), 0.25, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    out: list = [t]
    if truncated:
        out.append(Paragraph(
            f"<i>+ {len(ops) - max_rows} opérations non affichées (snapshot tronqué pour lisibilité)</i>",
            styles["muted_italic"],
        ))
    return out


def _render_subcat_section(sub: dict, styles: dict) -> list:
    """Section sous-cat = header + table d'ops."""
    head_row = [[
        Paragraph(f"<b>{sub.get('name') or ''}</b>", styles["h2"]),
        Paragraph(f"<b>{_format_currency(sub.get('total_ytd') or 0)}</b>", styles["right_amount"]),
    ]]
    nb = sub.get("nb_operations") or 0
    meta_parts = [f"{nb} opération{'s' if nb > 1 else ''}"]
    if sub.get("nb_mixte"): meta_parts.append(f"{sub['nb_mixte']} mixte{'s' if sub['nb_mixte'] > 1 else ''}")
    if sub.get("nb_a_revoir"): meta_parts.append(f"{sub['nb_a_revoir']} à revoir")
    if sub.get("nb_justif_manquant"): meta_parts.append(f"{sub['nb_justif_manquant']} sans justif.")
    meta = " · ".join(meta_parts)

    head_table = Table(head_row, colWidths=[124 * mm, 50 * mm])
    head_table.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, PRIMARY_LIGHT),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
    ]))

    out: list = [
        head_table,
        Paragraph(meta, styles["muted_italic"]),
        Spacer(1, 2 * mm),
    ]
    out.extend(_render_ops_table(sub.get("operations") or [], styles))
    out.append(Spacer(1, 4 * mm))
    return out


def _render_chapter_head(ch: dict, styles: dict) -> list:
    """Bandeau chapitre : numéro + titre + tag + totaux."""
    title_html = f'<font color="#64748b">{ch.get("number") or ""}</font>  <b>{ch.get("title") or ""}</b>'
    out: list = [Paragraph(title_html, styles["h1"])]
    if ch.get("tag"):
        out.append(Paragraph(ch["tag"], styles["tag"]))
    if ch.get("total_ytd") is not None:
        line = f'<b>YTD :</b> {_format_currency(ch.get("total_ytd") or 0)}'
        if ch.get("total_projected_annual") is not None:
            line += f'   ·   <font color="#811971"><b>Projeté annuel :</b> {_format_currency(ch.get("total_projected_annual") or 0)}</font>'
        out.append(Paragraph(line, styles["muted"]))
    out.append(Spacer(1, 4 * mm))
    return out


def _render_chapter_01(ch: dict, styles: dict) -> list:
    syn = ch.get("synthese") or {}
    metrics = syn.get("metrics") or []
    cadence = syn.get("cadence_mensuelle") or []

    out = _render_chapter_head(ch, styles)

    if metrics:
        # 4 cards en ligne
        cards = [_render_metric_card(m.get("label"), m.get("value") or 0, m.get("is_projection") or False, styles) for m in metrics]
        # Wrap dans un tableau pour les coller côte à côte
        if len(cards) <= 4:
            grid = Table([cards], hAlign="LEFT", colWidths=[44 * mm] * len(cards))
            grid.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 2)]))
            out.append(grid)
            out.append(Spacer(1, 6 * mm))

    out.append(Paragraph("<b>Cadence mensuelle</b>", styles["h2"]))
    # Phase 5 — chart PNG matplotlib si présent (en plus du tableau pour lecture précise).
    out.extend(_render_charts_block(ch, styles))
    out.append(_render_cadence_table(cadence, styles))
    return out


def _render_chapter_subcats(ch: dict, styles: dict, empty_msg: str) -> list:
    out = _render_chapter_head(ch, styles)
    # Phase 5 — chart en tête (donut chap 03, etc.)
    out.extend(_render_charts_block(ch, styles))
    subs = ch.get("subcategories") or []
    if not subs:
        out.append(Paragraph(f"<i>{empty_msg}</i>", styles["muted_italic"]))
        return out
    for sub in subs:
        out.extend(_render_subcat_section(sub, styles))
    return out


def _render_chapter_04(ch: dict, styles: dict) -> list:
    out = _render_chapter_head(ch, styles)
    decos = ch.get("decompositions") or []
    if decos:
        out.append(Paragraph("<b>Décompositions par forfait</b>", styles["h2"]))
        rows: list[list] = [["Type", "Montant", "Détail"]]
        for d in decos:
            type_label = {
                "blanchissage": "Blanchissage",
                "repas": "Repas pro",
                "vehicule": "Véhicule (quote-part)",
            }.get(d.get("type_forfait"), d.get("type_forfait") or "")
            details = []
            if d.get("date_ecriture"):
                details.append(f'OD {_format_date_fr(d["date_ecriture"])}')
            if d.get("jours") is not None:
                details.append(f'{d["jours"]} j travaillés')
            if d.get("forfait_jour") is not None:
                details.append(f'Forfait/jour : {d["forfait_jour"]:.2f} €')
            if d.get("ratio_pro_pct") is not None:
                details.append(f'Quote-part : {d["ratio_pro_pct"]} %')
            if d.get("reference_legale"):
                details.append(d["reference_legale"])
            montant = _format_currency(d.get("montant") or 0) if (d.get("montant") or 0) > 0 else "—"
            rows.append([type_label, montant, Paragraph(" · ".join(details), styles["muted"])])
        t = Table(rows, colWidths=[36 * mm, 28 * mm, 110 * mm], hAlign="LEFT")
        t.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7),
            ("BACKGROUND", (0, 0), (-1, 0), SURFACE_HOVER),
            ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_MUTED),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
            ("ALIGN", (1, 1), (1, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        out.append(t)
        out.append(Spacer(1, 4 * mm))
    subs = ch.get("subcategories") or []
    for sub in subs:
        out.extend(_render_subcat_section(sub, styles))
    if not subs and not decos:
        out.append(Paragraph("<i>Aucune charge forfaitaire générée pour cet exercice.</i>", styles["muted_italic"]))
    return out


def _render_chapter_06(ch: dict, styles: dict) -> list:
    out = _render_chapter_head(ch, styles)
    immos = ch.get("immobilisations") or []
    total = ch.get("total_dotations_annuelles") or 0
    if not immos:
        out.append(Paragraph("<i>Aucune immobilisation enregistrée.</i>", styles["muted_italic"]))
        return out
    rows: list[list] = [["Immobilisation", "Poste", "Acquis", "Durée", "Val. orig.", "Dotation YTD", "Cumul", "VNC"]]
    for i in immos:
        nom = _truncate(i.get("nom") or "", 32)
        if i.get("is_backfill"):
            nom += " (R)"
        rows.append([
            Paragraph(nom, styles["body"]),
            i.get("poste") or "",
            _format_date_fr(i.get("date_acquisition") or ""),
            f"{i.get('duree_amortissement') or 0} ans",
            _format_currency(i.get("valeur_origine") or 0),
            _format_currency(i.get("dotation_annuelle") or 0) if (i.get("dotation_annuelle") or 0) > 0 else "—",
            _format_currency(i.get("cumul_amortissement") or 0),
            _format_currency(i.get("vnc") or 0),
        ])
    rows.append(["", "", "", "", "", Paragraph(f"<b>Total : {_format_currency(total)}</b>", styles["right_amount"]), "", ""])

    t = Table(
        rows,
        colWidths=[42 * mm, 22 * mm, 18 * mm, 15 * mm, 22 * mm, 22 * mm, 17 * mm, 16 * mm],
        hAlign="LEFT", repeatRows=1,
    )
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7),
        ("BACKGROUND", (0, 0), (-1, 0), SURFACE_HOVER),
        ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_MUTED),
        ("FONT", (0, 1), (-1, -2), "Helvetica", 7),
        ("ALIGN", (3, 1), (-1, -2), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, BORDER),
        ("LINEBELOW", (0, 1), (-1, -3), 0.25, BORDER),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#eeedfe")),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]))
    out.append(t)
    return out


def _render_chapter_07(ch: dict, styles: dict) -> list:
    out = _render_chapter_head(ch, styles)
    gauges = ch.get("gauges") or []
    rows: list[list] = [["Provision", "Cumul YTD", "Cible estimée", "%"]]
    for g in gauges:
        ratio = max(0.0, min(1.5, g.get("ratio") or 0))
        rows.append([
            g.get("name") or "",
            _format_currency(g.get("cumul_ytd") or 0),
            _format_currency(g.get("cible_estimee") or 0),
            f"{int(ratio * 100)} %",
        ])
    if rows:
        t = Table(rows, colWidths=[60 * mm, 35 * mm, 35 * mm, 18 * mm], hAlign="LEFT")
        t.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
            ("BACKGROUND", (0, 0), (-1, 0), SURFACE_HOVER),
            ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_MUTED),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        out.append(t)
        out.append(Spacer(1, 4 * mm))

    subs = ch.get("subcategories") or []
    is_empty = all((s.get("nb_operations") or 0) == 0 for s in subs)
    if is_empty:
        out.append(Paragraph(
            "<i>Aucun transfert taggé en provision pour cet exercice. "
            "Pour alimenter ce chapitre, taggez vos transferts vers le compte épargne fiscal en sous-catégorie "
            "<b>Provision IR</b> / <b>Provision Charges sociales</b> / <b>Coussin</b> depuis l'Éditeur.</i>",
            styles["muted_italic"],
        ))
    else:
        for sub in subs:
            out.extend(_render_subcat_section(sub, styles))
    return out


def _render_chapter_08(ch: dict, styles: dict) -> list:
    out = _render_chapter_head(ch, styles)

    # Phase 5 — waterfall en tête (avant la formule détaillée)
    out.extend(_render_charts_block(ch, styles))

    formula = ch.get("formula") or []
    rows: list[list] = []
    op_hex = {"plus": "#16a34a", "minus": "#dc2626", "equals": "#811971"}
    for line in formula:
        op = line.get("operator") or "plus"
        op_sym = {"plus": "+", "minus": "−", "equals": "="}.get(op, "?")
        is_result = op == "equals"
        label = line.get("label") or ""
        note = line.get("note") or ""
        amt = _format_currency(line.get("amount") or 0)

        op_para = Paragraph(f'<font color="{op_hex.get(op, "#64748b")}"><b>{op_sym}</b></font>', styles["body"])
        if note:
            label_para = Paragraph(
                f'{("<b>" + label + "</b>") if is_result else label}<br/><font size="7" color="#64748b"><i>{note}</i></font>',
                styles["body"],
            )
        else:
            label_para = Paragraph(
                f"<b>{label}</b>" if is_result else label,
                styles["body"],
            )
        amt_para = Paragraph(
            f'<font color="#811971"><b>{amt}</b></font>' if is_result else amt,
            styles["right_amount"],
        )
        rows.append([op_para, label_para, amt_para])

    formula_table = Table(rows, colWidths=[8 * mm, 122 * mm, 38 * mm], hAlign="LEFT")
    style = TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ])
    # Ligne du résultat : trait au-dessus
    if formula:
        last_idx = len(formula) - 1
        if (formula[-1].get("operator") or "") == "equals":
            style.add("LINEABOVE", (0, last_idx), (-1, last_idx), 0.5, PRIMARY_LIGHT)
    formula_table.setStyle(style)
    out.append(formula_table)
    out.append(Spacer(1, 4 * mm))

    if ch.get("formula_comment"):
        out.append(Paragraph(f"<i>{ch['formula_comment']}</i>", styles["muted_italic"]))
        out.append(Spacer(1, 4 * mm))

    proj = ch.get("projection") or {}
    out.append(Paragraph("<b>Projection fiscale annuelle</b>", styles["h2"]))
    proj_rows = [
        ["BNC projeté", _format_currency(proj.get("bnc_projete_annuel") or 0)],
        ["Impôt sur le revenu", _format_currency(proj.get("ir_estime") or 0)],
        ["URSSAF", _format_currency(proj.get("urssaf_estime") or 0)],
        ["CARMF", _format_currency(proj.get("carmf_estime") or 0)],
        ["OdM", _format_currency(proj.get("odm_estime") or 0)],
        ["Total charges sociales", _format_currency(proj.get("total_charges_sociales_estime") or 0)],
        ["Revenu net après charges", _format_currency(proj.get("revenu_net_apres_charges") or 0)],
    ]
    pt = Table(proj_rows, colWidths=[80 * mm, 40 * mm], hAlign="LEFT")
    pt.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 9),
        ("TEXTCOLOR", (0, -1), (-1, -1), SUCCESS),
    ]))
    out.append(pt)
    return out


def _render_chapter_09(ch: dict, styles: dict) -> list:
    out = _render_chapter_head(ch, styles)

    justifs = ch.get("justificatifs_index") or []
    out.append(Paragraph(f"<b>Index des justificatifs ({len(justifs)})</b>", styles["h2"]))
    if justifs:
        max_show = 200
        truncated = len(justifs) > max_show
        rows: list[list] = [["Date", "Fichier", "Op", "Montant"]]
        for j in justifs[:max_show]:
            rows.append([
                _format_date_fr(j.get("date") or ""),
                Paragraph(_truncate(j.get("filename") or "", 36), styles["code"]),
                Paragraph(_truncate(j.get("libelle_op") or "", 36), styles["body"]),
                _format_currency(j.get("montant") or 0) if j.get("montant") else "—",
            ])
        t = Table(rows, colWidths=[20 * mm, 70 * mm, 60 * mm, 24 * mm], hAlign="LEFT", repeatRows=1)
        t.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7),
            ("BACKGROUND", (0, 0), (-1, 0), SURFACE_HOVER),
            ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_MUTED),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 7),
            ("ALIGN", (3, 1), (3, -1), "RIGHT"),
            ("LINEBELOW", (0, 1), (-1, -1), 0.25, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ]))
        out.append(t)
        if truncated:
            out.append(Paragraph(f"<i>+ {len(justifs) - max_show} entrées non affichées (snapshot tronqué)</i>", styles["muted_italic"]))
    else:
        out.append(Paragraph("<i>Aucun justificatif référencé.</i>", styles["muted_italic"]))
    out.append(Spacer(1, 4 * mm))

    baremes = ch.get("baremes_appliques") or []
    out.append(Paragraph(f"<b>Barèmes appliqués ({len(baremes)})</b>", styles["h2"]))
    if baremes:
        rows = [["Barème", "Fichier", "Résumé"]]
        for b in baremes:
            summary_str = " · ".join(f"{k}={v}" for k, v in (b.get("summary") or {}).items())
            rows.append([
                b.get("nom") or "",
                Paragraph(b.get("file") or "", styles["code"]),
                Paragraph(_truncate(summary_str, 80), styles["muted"]),
            ])
        bt = Table(rows, colWidths=[36 * mm, 40 * mm, 98 * mm], hAlign="LEFT")
        bt.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7),
            ("BACKGROUND", (0, 0), (-1, 0), SURFACE_HOVER),
            ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_MUTED),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        out.append(bt)
    out.append(Spacer(1, 4 * mm))

    glossaire = ch.get("glossaire") or []
    out.append(Paragraph(f"<b>Glossaire ({len(glossaire)})</b>", styles["h2"]))
    for g in glossaire:
        out.append(Paragraph(f'<b>{g.get("term") or ""}</b> — <font color="#64748b">{g.get("definition") or ""}</font>', styles["body"]))
    out.append(Spacer(1, 4 * mm))

    methodologie = ch.get("methodologie") or ""
    if methodologie:
        out.append(Paragraph("<b>Méthodologie</b>", styles["h2"]))
        for line in methodologie.split("\n"):
            if line.startswith("## "):
                out.append(Paragraph(f"<b>{line[3:]}</b>", styles["body"]))
            elif line.startswith("- "):
                out.append(Paragraph(f"• {line[2:]}", styles["muted"]))
            elif line.strip():
                out.append(Paragraph(line, styles["muted"]))
    return out


def _render_chapter(ch: dict, styles: dict) -> list:
    """Dispatch."""
    num = ch.get("number") or ""
    if num == "01":
        return _render_chapter_01(ch, styles)
    if num == "02":
        return _render_chapter_subcats(ch, styles, "Aucune recette enregistrée pour cet exercice.")
    if num == "03":
        return _render_chapter_subcats(ch, styles, "Aucune charge professionnelle pour cet exercice.")
    if num == "04":
        return _render_chapter_04(ch, styles)
    if num == "05":
        return _render_chapter_subcats(ch, styles, "Aucune cotisation sociale détectée.")
    if num == "06":
        return _render_chapter_06(ch, styles)
    if num == "07":
        return _render_chapter_07(ch, styles)
    if num == "08":
        return _render_chapter_08(ch, styles)
    if num == "09":
        return _render_chapter_09(ch, styles)
    return _render_chapter_subcats(ch, styles, "—")


# ─── Page de garde + sommaire ─────────────────────────────────────

def _render_cover(
    livret_dict: dict,
    snapshot_id: str,
    snapshot_type: SnapshotType,
    snapshot_date: str,
    comment: Optional[str],
    styles: dict,
) -> list:
    metadata = livret_dict["metadata"]
    year = metadata.get("year")

    out: list = []

    # Logo
    try:
        logo_path = ASSETS_DIR / "logo_lockup_light_400.png"
        if logo_path.exists():
            out.append(RLImage(str(logo_path), width=60 * mm, height=18 * mm))
            out.append(Spacer(1, 12 * mm))
    except Exception as e:
        logger.warning("Logo cover failed: %s", e)

    out.append(Spacer(1, 24 * mm))
    out.append(Paragraph(f"Livret comptable", styles["title"]))
    out.append(Paragraph(f"<font size='28'><b>Exercice {year}</b></font>", styles["title"]))
    out.append(Spacer(1, 6 * mm))

    out.append(Paragraph(f"Instantané du <b>{_format_date_fr(snapshot_date)}</b>", styles["subtitle"]))
    type_label = _type_label(snapshot_type)
    out.append(Paragraph(f"Type : <b>{type_label}</b>", styles["subtitle"]))
    out.append(Paragraph(f"YTD au : <b>{_format_date_fr(metadata.get('as_of_date') or '')}</b>", styles["subtitle"]))

    months_elapsed = metadata.get("months_elapsed") or 0
    months_remaining = metadata.get("months_remaining") or 0
    if months_remaining == 0:
        period_str = f"Exercice clôturé · 12 mois clos"
    elif months_elapsed == 0:
        period_str = "Exercice à venir"
    else:
        period_str = f"{months_elapsed} mois écoulés · {months_remaining} à projeter"
    out.append(Paragraph(period_str, styles["muted"]))

    if comment:
        out.append(Spacer(1, 8 * mm))
        out.append(Paragraph(f"<b>Commentaire :</b> {comment}", styles["body"]))

    out.append(Spacer(1, 18 * mm))
    out.append(Paragraph(
        "<i>Document statique et autonome — non éditable</i>",
        styles["muted_italic"],
    ))
    out.append(Spacer(1, 4 * mm))
    out.append(Paragraph(
        f"<font size='7' color='#64748b'>Snapshot ID : {snapshot_id}</font>",
        styles["muted"],
    ))

    out.append(PageBreak())
    return out


def _render_toc(livret_dict: dict, styles: dict) -> list:
    out: list = [Paragraph("<b>Sommaire</b>", styles["h1"]), Spacer(1, 4 * mm)]
    chapters = livret_dict.get("chapters") or {}
    toc = livret_dict.get("toc") or []
    rows = []
    for entry in toc:
        num = entry.get("number") or ""
        title = entry.get("title") or ""
        ch = chapters.get(num)
        if ch and ch.get("total_ytd") is not None:
            ytd = _format_currency(ch.get("total_ytd") or 0)
        else:
            ytd = "—"
        rows.append([num, title, ytd])
    t = Table(rows, colWidths=[15 * mm, 120 * mm, 35 * mm], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT", (0, 0), (0, -1), "Courier-Bold", 9),
        ("TEXTCOLOR", (0, 0), (0, -1), TEXT_MUTED),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    out.append(t)
    out.append(PageBreak())
    return out


# ─── API publique ─────────────────────────────────────────────────

def render(
    livret: Livret,
    snapshot_id: str,
    snapshot_type: SnapshotType,
    snapshot_date: str,
    comment: Optional[str] = None,
) -> bytes:
    """Génère le PDF paginé du livret. Retourne les bytes prêts à écrire."""
    styles = _make_styles()
    livret_dict = livret.model_dump(mode="json")

    buf = BytesIO()
    doc = _make_doc(buf, livret_dict["metadata"]["year"], snapshot_date)

    story: list = []
    story.extend(_render_cover(livret_dict, snapshot_id, snapshot_type, snapshot_date, comment, styles))
    story.extend(_render_toc(livret_dict, styles))

    chapters = livret_dict.get("chapters") or {}
    toc = livret_dict.get("toc") or []
    for i, entry in enumerate(toc):
        num = entry.get("number") or ""
        ch = chapters.get(num)
        if not ch:
            continue
        story.extend(_render_chapter(ch, styles))
        # Saut de page entre chapitres principaux (sauf dernier)
        if i < len(toc) - 1:
            story.append(PageBreak())

    doc.build(story)
    return buf.getvalue()
