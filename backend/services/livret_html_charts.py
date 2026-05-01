"""
Renderer SVG pour HTML autonome — Phase 5.

Convertit un `ChartConfig` Pydantic en markup SVG **inline** (pas de lib externe).

Garanties :
  - Aucun fetch / aucun script externe.
  - Imprimable (SVG vectoriel).
  - Accessibilité : `<title>` + `<desc>` + tableau de fallback en `<details>`.
  - Tooltips hover via vanilla JS (cf. `_INLINE_JS` étendu de `livret_html_generator`).
"""
from __future__ import annotations

import html as _html
import logging
import math
from typing import Optional

from backend.models.livret import ChartConfig, ChartPoint

logger = logging.getLogger(__name__)


def _esc(s: object) -> str:
    return _html.escape(str(s) if s is not None else "", quote=False)


def _esc_attr(s: object) -> str:
    return _html.escape(str(s) if s is not None else "", quote=True)


def _format_eur(value: float) -> str:
    """Format FR : 1 234,56 € (pour tooltip / label)."""
    sign = "-" if value < 0 else ""
    v = abs(value)
    int_part = int(v)
    dec = round((v - int_part) * 100)
    if dec == 100:
        int_part += 1
        dec = 0
    int_str = f"{int_part:,}".replace(",", " ")
    return f"{sign}{int_str},{dec:02d} €"


# ─── Tableau de fallback (a11y) ───────────────────────────────────

def _render_fallback_table(config: ChartConfig) -> str:
    """Tableau brut des données pour lecteurs d'écran + impression accessible.

    Intégré dans un `<details>` masquable par défaut (pour ne pas alourdir
    visuellement). Le screen reader peut quand même y accéder.
    """
    rows: list[str] = []
    has_multi_series = len(config.series) > 1
    if has_multi_series:
        # Tableau pivot : x en lignes, séries en colonnes
        x_labels: list[str] = []
        for s in config.series:
            for p in s.data:
                if p.x not in x_labels:
                    x_labels.append(str(p.x))
        head = ["Catégorie"] + [s.name for s in config.series]
        rows.append("<tr>" + "".join(f"<th>{_esc(c)}</th>" for c in head) + "</tr>")
        for x in x_labels:
            cells = [f"<td>{_esc(x)}</td>"]
            for s in config.series:
                p_match = next((p for p in s.data if str(p.x) == str(x)), None)
                cells.append(f"<td>{_format_eur(p_match.y) if p_match else '—'}</td>")
            rows.append("<tr>" + "".join(cells) + "</tr>")
    else:
        rows.append(f"<tr><th>{_esc(config.x_label or 'Catégorie')}</th><th>{_esc(config.y_label or 'Montant')}</th></tr>")
        for p in config.series[0].data:
            rows.append(f"<tr><td>{_esc(p.x)}</td><td>{_format_eur(p.y)}</td></tr>")

    return (
        f'<details class="chart-data-fallback"><summary>Voir les données ({_esc(config.title)})</summary>'
        f'<table>{"".join(rows)}</table></details>'
    )


# ─── Donut ─────────────────────────────────────────────────────────

def _svg_donut(config: ChartConfig) -> str:
    """Donut chart avec légende à droite, leader lines, pourcentages au centre."""
    series = config.series[0]
    points = [p for p in series.data if p.y > 0]
    if not points:
        return ""

    total = sum(p.y for p in points)
    cx, cy = 200, 180
    r_outer = 130
    r_inner = 78

    width = 720
    height = 360

    svg_parts: list[str] = []

    # Tracé des arcs
    angle_acc = -math.pi / 2  # commence à 12h
    for p in points:
        portion = p.y / total
        sweep = portion * 2 * math.pi
        a0 = angle_acc
        a1 = angle_acc + sweep
        x0 = cx + r_outer * math.cos(a0)
        y0 = cy + r_outer * math.sin(a0)
        x1 = cx + r_outer * math.cos(a1)
        y1 = cy + r_outer * math.sin(a1)
        ix0 = cx + r_inner * math.cos(a0)
        iy0 = cy + r_inner * math.sin(a0)
        ix1 = cx + r_inner * math.cos(a1)
        iy1 = cy + r_inner * math.sin(a1)
        large_arc = "1" if sweep > math.pi else "0"

        path = (
            f"M{x0:.2f},{y0:.2f} "
            f"A{r_outer},{r_outer} 0 {large_arc} 1 {x1:.2f},{y1:.2f} "
            f"L{ix1:.2f},{iy1:.2f} "
            f"A{r_inner},{r_inner} 0 {large_arc} 0 {ix0:.2f},{iy0:.2f} Z"
        )
        color = p.color or series.color
        pct = round(portion * 100, 1)
        tooltip = f"{p.x} : {_format_eur(p.y)} ({pct} %)"
        svg_parts.append(
            f'<path d="{path}" fill="{_esc_attr(color)}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" '
            f'data-chart-tooltip="{_esc_attr(tooltip)}" class="chart-slice">'
            f'<title>{_esc(tooltip)}</title></path>'
        )
        angle_acc = a1

    # Centre — total
    svg_parts.append(
        f'<text x="{cx}" y="{cy - 8}" text-anchor="middle" '
        f'font-size="11" fill="#94a3b8" font-family="sans-serif">Total</text>'
    )
    svg_parts.append(
        f'<text x="{cx}" y="{cy + 14}" text-anchor="middle" '
        f'font-size="18" font-weight="bold" fill="#f1f5f9" font-family="sans-serif">'
        f'{_esc(_format_eur(total))}</text>'
    )

    # Légende à droite
    legend_x = 380
    legend_y = 50
    line_h = 22
    for i, p in enumerate(points):
        portion = p.y / total
        pct = round(portion * 100, 1)
        color = p.color or series.color
        y = legend_y + i * line_h
        svg_parts.append(
            f'<rect x="{legend_x}" y="{y - 8}" width="12" height="12" rx="2" '
            f'fill="{_esc_attr(color)}"/>'
        )
        label_truncated = str(p.x)[:36]
        svg_parts.append(
            f'<text x="{legend_x + 18}" y="{y + 2}" font-size="12" '
            f'fill="#f1f5f9" font-family="sans-serif">{_esc(label_truncated)}</text>'
        )
        svg_parts.append(
            f'<text x="{width - 24}" y="{y + 2}" text-anchor="end" font-size="11" '
            f'fill="#94a3b8" font-family="sans-serif" font-variant-numeric="tabular-nums">'
            f'{_esc(_format_eur(p.y))} · {pct} %</text>'
        )

    return (
        f'<svg viewBox="0 0 {width} {height}" '
        f'class="livret-chart livret-chart-donut" xmlns="http://www.w3.org/2000/svg" '
        f'role="img" aria-labelledby="{config.id}-title {config.id}-desc">'
        f'<title id="{config.id}-title">{_esc(config.title)}</title>'
        f'<desc id="{config.id}-desc">{_esc(config.subtitle or "Répartition en pourcentage")}</desc>'
        f'{"".join(svg_parts)}</svg>'
    )


# ─── Waterfall ────────────────────────────────────────────────────

def _svg_waterfall(config: ChartConfig) -> str:
    """Waterfall : barres cumulatives avec connecteurs pointillés.

    Convention : chaque point a `meta.operator ∈ {plus, minus, equals}` qui
    détermine le sens visuel.
    """
    points = config.series[0].data if config.series else []
    if not points:
        return ""

    width = 920
    height = 320
    margin_l = 70
    margin_r = 30
    margin_t = 30
    margin_b = 60
    chart_w = width - margin_l - margin_r
    chart_h = height - margin_t - margin_b

    # Calcul du domaine (cumulé)
    cumulative: list[tuple[float, float]] = []  # [(start, end)]
    acc = 0.0
    for p in points:
        op = (p.meta or {}).get("operator", "plus")
        if op == "plus":
            cumulative.append((acc, acc + p.y))
            acc += p.y
        elif op == "minus":
            cumulative.append((acc - p.y, acc))
            acc -= p.y
        elif op == "equals":
            # La barre du résultat va de 0 au total
            cumulative.append((0.0, p.y))
        else:
            cumulative.append((acc, acc + p.y))
            acc += p.y

    y_min = min(0, min(s for s, _ in cumulative))
    y_max = max(s for _, s in cumulative)
    y_range = (y_max - y_min) or 1.0

    def _y_to_px(v: float) -> float:
        return margin_t + chart_h - ((v - y_min) / y_range) * chart_h

    n = len(points)
    bar_slot = chart_w / n
    bar_w = bar_slot * 0.55

    svg_parts: list[str] = []

    # Axe Y léger (baseline 0)
    zero_y = _y_to_px(0)
    svg_parts.append(
        f'<line x1="{margin_l}" y1="{zero_y:.1f}" x2="{width - margin_r}" y2="{zero_y:.1f}" '
        f'stroke="#334155" stroke-width="1"/>'
    )

    # Connecteurs pointillés entre barres
    for i in range(n - 1):
        end_y = _y_to_px(cumulative[i][1])
        x_end = margin_l + (i + 0.5) * bar_slot + bar_w / 2
        x_next_start = margin_l + (i + 1.5) * bar_slot - bar_w / 2
        svg_parts.append(
            f'<line x1="{x_end:.1f}" y1="{end_y:.1f}" x2="{x_next_start:.1f}" y2="{end_y:.1f}" '
            f'stroke="#475569" stroke-dasharray="3 3" stroke-width="1"/>'
        )

    # Barres + labels
    for i, p in enumerate(points):
        start, end = cumulative[i]
        y_top = _y_to_px(max(start, end))
        y_bot = _y_to_px(min(start, end))
        x_left = margin_l + (i + 0.5) * bar_slot - bar_w / 2
        bar_h = max(2, y_bot - y_top)
        color = p.color or config.series[0].color
        op = (p.meta or {}).get("operator", "plus")

        tooltip_value = (p.meta or {}).get("raw_amount", p.y)
        op_sym = "+" if op == "plus" else "−" if op == "minus" else "="
        tooltip = f"{p.x} : {op_sym} {_format_eur(abs(float(tooltip_value)))}"

        svg_parts.append(
            f'<rect x="{x_left:.1f}" y="{y_top:.1f}" width="{bar_w:.1f}" height="{bar_h:.1f}" '
            f'fill="{_esc_attr(color)}" rx="2" data-chart-tooltip="{_esc_attr(tooltip)}" class="chart-bar">'
            f'<title>{_esc(tooltip)}</title></rect>'
        )

        # Valeur au-dessus de la barre
        svg_parts.append(
            f'<text x="{x_left + bar_w / 2:.1f}" y="{y_top - 5:.1f}" '
            f'text-anchor="middle" font-size="10" fill="#f1f5f9" font-family="sans-serif" '
            f'font-variant-numeric="tabular-nums">{_esc(_format_eur(abs(float(tooltip_value))))}</text>'
        )
        # Label x sous l'axe (multi-ligne si trop long)
        label = str(p.x)
        if len(label) > 18:
            label = label[:16] + "…"
        svg_parts.append(
            f'<text x="{x_left + bar_w / 2:.1f}" y="{height - margin_b + 18:.1f}" '
            f'text-anchor="middle" font-size="10" fill="#94a3b8" font-family="sans-serif">'
            f'<tspan>{_esc(label)}</tspan></text>'
        )

    # Total final (annotation visuelle)
    if config.total is not None:
        svg_parts.append(
            f'<text x="{width - margin_r}" y="{margin_t - 8:.1f}" text-anchor="end" '
            f'font-size="11" fill="#811971" font-weight="bold" font-family="sans-serif">'
            f'BNC = {_esc(_format_eur(config.total))}</text>'
        )

    return (
        f'<svg viewBox="0 0 {width} {height}" '
        f'class="livret-chart livret-chart-waterfall" xmlns="http://www.w3.org/2000/svg" '
        f'role="img" aria-labelledby="{config.id}-title {config.id}-desc">'
        f'<title id="{config.id}-title">{_esc(config.title)}</title>'
        f'<desc id="{config.id}-desc">{_esc(config.subtitle or "Décomposition de la formule")}</desc>'
        f'{"".join(svg_parts)}</svg>'
    )


# ─── Cadence (bar chart 12 mois) ──────────────────────────────────

def _svg_bar_cadence(config: ChartConfig) -> str:
    """Généralisation du `_render_cadence_svg` historique. Lit les 2 séries
    (recettes / charges) et optionnellement la 3ᵉ (Solde N-1) en ligne pointillée.
    """
    series_by_name = {s.name.lower(): s for s in config.series}
    rec_series = series_by_name.get("recettes")
    chg_series = series_by_name.get("charges")
    n1_series = series_by_name.get("solde n-1")

    if not rec_series or not chg_series:
        return ""

    n = len(rec_series.data)
    if n == 0:
        return ""

    width = 920
    height = 220
    margin_l = 50
    margin_r = 20
    margin_t = 20
    margin_b = 30
    chart_w = width - margin_l - margin_r
    chart_h = height - margin_t - margin_b

    # max parmi recettes / charges (et |solde N-1|)
    max_val = 1.0
    for p in rec_series.data:
        max_val = max(max_val, p.y)
    for p in chg_series.data:
        max_val = max(max_val, p.y)
    if n1_series:
        for p in n1_series.data:
            max_val = max(max_val, abs(p.y))

    bar_slot = chart_w / n
    bar_w = bar_slot / 2 - 3

    svg_parts: list[str] = []

    # Grille horizontale (4 lignes)
    for i in range(5):
        y = margin_t + chart_h * (i / 4)
        svg_parts.append(
            f'<line x1="{margin_l}" y1="{y:.1f}" x2="{width - margin_r}" y2="{y:.1f}" '
            f'stroke="#1e293b" stroke-width="0.5"/>'
        )
        # Label Y
        val = max_val * (1 - i / 4)
        label = f"{int(val / 1000)} k" if abs(val) >= 1000 else f"{int(val)}"
        svg_parts.append(
            f'<text x="{margin_l - 6}" y="{y + 3:.1f}" text-anchor="end" '
            f'font-size="9" fill="#64748b" font-family="sans-serif">{label}</text>'
        )

    # Barres
    for i, (rec_p, chg_p) in enumerate(zip(rec_series.data, chg_series.data)):
        x_center = margin_l + (i + 0.5) * bar_slot
        meta = rec_p.meta or {}
        is_proj = meta.get("is_projection", False)
        is_curr = meta.get("is_current", False)
        opacity = "0.45" if is_proj else "1"
        dash = ' stroke-dasharray="3 2"' if is_proj else ""

        # Recettes (vert)
        rec_h = (rec_p.y / max_val) * chart_h if max_val else 0
        rec_y = margin_t + chart_h - rec_h
        rec_tooltip = f"{rec_p.x} · Recettes : {_format_eur(rec_p.y)}"
        svg_parts.append(
            f'<rect x="{x_center - bar_w - 1:.1f}" y="{rec_y:.1f}" width="{bar_w:.1f}" '
            f'height="{rec_h:.1f}" fill="{_esc_attr(rec_series.color)}" opacity="{opacity}" '
            f'stroke="{_esc_attr(rec_series.color)}"{dash} '
            f'data-chart-tooltip="{_esc_attr(rec_tooltip)}" class="chart-bar">'
            f'<title>{_esc(rec_tooltip)}</title></rect>'
        )

        # Charges (rouge)
        chg_h = (chg_p.y / max_val) * chart_h if max_val else 0
        chg_y = margin_t + chart_h - chg_h
        chg_tooltip = f"{chg_p.x} · Charges : {_format_eur(chg_p.y)}"
        svg_parts.append(
            f'<rect x="{x_center + 1:.1f}" y="{chg_y:.1f}" width="{bar_w:.1f}" '
            f'height="{chg_h:.1f}" fill="{_esc_attr(chg_series.color)}" opacity="{opacity}" '
            f'stroke="{_esc_attr(chg_series.color)}"{dash} '
            f'data-chart-tooltip="{_esc_attr(chg_tooltip)}" class="chart-bar">'
            f'<title>{_esc(chg_tooltip)}</title></rect>'
        )

        # Mois courant — vertical guide
        if is_curr:
            svg_parts.append(
                f'<line x1="{x_center:.1f}" y1="{margin_t:.1f}" x2="{x_center:.1f}" '
                f'y2="{margin_t + chart_h:.1f}" stroke="#811971" stroke-dasharray="4 4" stroke-width="1"/>'
            )

        # Label x
        svg_parts.append(
            f'<text x="{x_center:.1f}" y="{height - margin_b + 14:.1f}" '
            f'text-anchor="middle" font-size="10" fill="#94a3b8" font-family="sans-serif">'
            f'{_esc(rec_p.x)}</text>'
        )

    # Ligne Solde N-1 (Phase 4)
    if n1_series and n1_series.data:
        polyline_pts: list[str] = []
        for i, p in enumerate(n1_series.data):
            x_center = margin_l + (i + 0.5) * bar_slot
            y = margin_t + chart_h - (p.y / max_val) * chart_h
            polyline_pts.append(f"{x_center:.1f},{y:.1f}")
        if polyline_pts:
            svg_parts.append(
                f'<polyline points="{" ".join(polyline_pts)}" fill="none" '
                f'stroke="{_esc_attr(n1_series.color)}" stroke-width="1.5" '
                f'stroke-dasharray="4 3"/>'
            )

    return (
        f'<svg viewBox="0 0 {width} {height}" '
        f'class="livret-chart livret-chart-cadence" xmlns="http://www.w3.org/2000/svg" '
        f'role="img" aria-labelledby="{config.id}-title {config.id}-desc">'
        f'<title id="{config.id}-title">{_esc(config.title)}</title>'
        f'<desc id="{config.id}-desc">{_esc(config.subtitle or "Bar chart 12 mois")}</desc>'
        f'{"".join(svg_parts)}</svg>'
    )


# ─── API publique ─────────────────────────────────────────────────

def render_chart_svg(config: ChartConfig) -> str:
    """Dispatcher : retourne le markup SVG complet selon `config.type`."""
    try:
        if config.type == "donut":
            inner = _svg_donut(config)
        elif config.type == "waterfall":
            inner = _svg_waterfall(config)
        elif config.type in ("cadence", "bar"):
            inner = _svg_bar_cadence(config)
        else:
            logger.warning("ChartType non géré (HTML SVG) : %s", config.type)
            return ""
    except Exception as e:
        logger.warning("SVG rendering failed for %s: %s", config.id, e)
        return ""

    if not inner:
        return ""

    fallback = _render_fallback_table(config)

    legend_subtitle = (
        f'<p class="livret-chart-subtitle">{_esc(config.subtitle)}</p>'
        if config.subtitle else ""
    )

    return (
        f'<figure class="livret-chart-figure" data-chart-id="{_esc_attr(config.id)}">'
        f'<figcaption class="livret-chart-caption"><strong>{_esc(config.title)}</strong>'
        f'{legend_subtitle}</figcaption>'
        f'{inner}'
        f'{fallback}'
        f'</figure>'
    )
