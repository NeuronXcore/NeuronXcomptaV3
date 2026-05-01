"""
Renderer matplotlib pour PDF — Phase 5.

Convertit un `ChartConfig` Pydantic en PNG bytes prêt à être embarqué dans
ReportLab via `RLImage(BytesIO(png))`.

Caractéristiques :
  - Backend `Agg` (headless, pas de GUI requise).
  - Lazy import : matplotlib charge ~80 MB RAM au premier import → import dans
    les helpers, pas en module-level.
  - Theming dark cohérent avec HTML/React via `rcParams`.
  - 3 helpers : `_pdf_donut`, `_pdf_waterfall`, `_pdf_cadence`.
"""
from __future__ import annotations

import logging
from io import BytesIO
from typing import Optional

from backend.models.livret import ChartConfig

logger = logging.getLogger(__name__)


# ─── Theming dark ─────────────────────────────────────────────────

def _apply_dark_theme(plt) -> None:
    """Applique un thème sombre cohérent avec HTML/React (CSS vars équivalentes)."""
    plt.rcParams.update({
        "figure.facecolor": "#0f172a",
        "axes.facecolor": "#1e293b",
        "axes.edgecolor": "#334155",
        "axes.labelcolor": "#f1f5f9",
        "axes.titlecolor": "#f1f5f9",
        "axes.grid": False,
        "xtick.color": "#94a3b8",
        "ytick.color": "#94a3b8",
        "text.color": "#f1f5f9",
        "font.size": 10,
        "font.family": "sans-serif",
        "legend.frameon": False,
        "legend.fontsize": 9,
        "savefig.facecolor": "#0f172a",
        "savefig.edgecolor": "none",
    })


def _format_eur(value: float) -> str:
    sign = "-" if value < 0 else ""
    v = abs(value)
    int_part = int(v)
    dec = round((v - int_part) * 100)
    if dec == 100:
        int_part += 1
        dec = 0
    int_str = f"{int_part:,}".replace(",", " ")
    return f"{sign}{int_str},{dec:02d} €"


# ─── Donut ─────────────────────────────────────────────────────────

def _pdf_donut(config: ChartConfig, width_in: float, height_in: float, dpi: int) -> bytes:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    _apply_dark_theme(plt)

    series = config.series[0] if config.series else None
    if not series or not series.data:
        return b""

    points = [p for p in series.data if p.y > 0]
    labels = [str(p.x) for p in points]
    values = [p.y for p in points]
    colors = [p.color or series.color for p in points]
    total = sum(values)

    fig, ax = plt.subplots(figsize=(width_in, height_in), dpi=dpi)
    wedges, _texts = ax.pie(
        values,
        labels=None,
        colors=colors,
        startangle=90,
        counterclock=False,
        wedgeprops=dict(width=0.42, edgecolor="#0f172a", linewidth=1.5),
    )
    # Texte centre — total
    ax.text(0, 0.08, "Total", ha="center", va="center", color="#94a3b8", fontsize=10)
    ax.text(0, -0.10, _format_eur(total), ha="center", va="center",
            color="#f1f5f9", fontsize=14, fontweight="bold")

    # Légende à droite — top 8 + autres
    legend_labels = [
        f"{lab[:28]}  {_format_eur(v)} · {round(v / total * 100, 1)} %"
        for lab, v in zip(labels, values)
    ]
    ax.legend(
        wedges, legend_labels,
        loc="center left", bbox_to_anchor=(1.05, 0.5),
        frameon=False, fontsize=8, labelcolor="#f1f5f9",
    )

    ax.set_title(config.title, color="#f1f5f9", fontsize=11, pad=10, loc="left")
    if config.subtitle:
        fig.text(0.02, 0.93, config.subtitle, color="#94a3b8", fontsize=8)
    ax.set_aspect("equal")

    buf = BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=dpi)
    plt.close(fig)
    return buf.getvalue()


# ─── Waterfall ────────────────────────────────────────────────────

def _pdf_waterfall(config: ChartConfig, width_in: float, height_in: float, dpi: int) -> bytes:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    _apply_dark_theme(plt)

    points = config.series[0].data if config.series else []
    if not points:
        return b""

    # Calcul cumulatif
    cumulative: list[tuple[float, float]] = []
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
            cumulative.append((0.0, p.y))
        else:
            cumulative.append((acc, acc + p.y))
            acc += p.y

    fig, ax = plt.subplots(figsize=(width_in, height_in), dpi=dpi)

    n = len(points)
    x_positions = list(range(n))
    bar_w = 0.6
    y_top_max = max(max(s, e) for s, e in cumulative) or 1.0
    label_offset = y_top_max * 0.02
    for i, (p, (s, e)) in enumerate(zip(points, cumulative)):
        bottom = min(s, e)
        height = abs(e - s)
        color = p.color or "#64748b"
        ax.bar(i, height, bottom=bottom, width=bar_w, color=color,
               edgecolor="#0f172a", linewidth=0.5)
        # Valeur au-dessus
        raw_amt = (p.meta or {}).get("raw_amount", p.y)
        ax.text(i, max(s, e) + label_offset,
                _format_eur(abs(float(raw_amt))),
                ha="center", va="bottom", color="#f1f5f9", fontsize=8)

    # Connecteurs pointillés
    for i in range(n - 1):
        end_y = cumulative[i][1]
        ax.plot([i + bar_w / 2, i + 1 - bar_w / 2], [end_y, end_y],
                color="#475569", linestyle="--", linewidth=0.8)

    # Baseline 0
    ax.axhline(0, color="#334155", linewidth=0.8)

    # Labels x
    ax.set_xticks(x_positions)
    ax.set_xticklabels(
        [str(p.x)[:24] + ("…" if len(str(p.x)) > 24 else "") for p in points],
        rotation=15, ha="right", fontsize=8,
    )

    # Total annotation
    if config.total is not None:
        ax.text(0.99, 0.98,
                f"BNC = {_format_eur(config.total)}",
                transform=ax.transAxes, ha="right", va="top",
                color="#811971", fontweight="bold", fontsize=10)

    ax.set_title(config.title, color="#f1f5f9", fontsize=11, pad=10, loc="left")
    if config.subtitle:
        fig.text(0.02, 0.93, config.subtitle, color="#94a3b8", fontsize=8)

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    buf = BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=dpi)
    plt.close(fig)
    return buf.getvalue()


# ─── Cadence (bar chart 12 mois) ──────────────────────────────────

def _pdf_cadence(config: ChartConfig, width_in: float, height_in: float, dpi: int) -> bytes:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    _apply_dark_theme(plt)

    series_by_name = {s.name.lower(): s for s in config.series}
    rec_series = series_by_name.get("recettes")
    chg_series = series_by_name.get("charges")
    n1_series = series_by_name.get("solde n-1")

    if not rec_series or not chg_series:
        return b""

    n = len(rec_series.data)
    if n == 0:
        return b""

    fig, ax = plt.subplots(figsize=(width_in, height_in), dpi=dpi)

    x_positions = list(range(n))
    bar_w = 0.4

    rec_values = [p.y for p in rec_series.data]
    chg_values = [p.y for p in chg_series.data]
    rec_alpha = [0.45 if (p.meta or {}).get("is_projection") else 1.0 for p in rec_series.data]
    chg_alpha = [0.45 if (p.meta or {}).get("is_projection") else 1.0 for p in chg_series.data]

    # Barres recettes (à gauche)
    for i, (val, alpha) in enumerate(zip(rec_values, rec_alpha)):
        ax.bar(i - bar_w / 2, val, width=bar_w, color=rec_series.color, alpha=alpha,
               edgecolor=rec_series.color, linewidth=0.5)
    # Barres charges (à droite)
    for i, (val, alpha) in enumerate(zip(chg_values, chg_alpha)):
        ax.bar(i + bar_w / 2, val, width=bar_w, color=chg_series.color, alpha=alpha,
               edgecolor=chg_series.color, linewidth=0.5)

    # Mois courant — vertical guide
    for i, p in enumerate(rec_series.data):
        if (p.meta or {}).get("is_current"):
            ax.axvline(i, color="#811971", linestyle="--", linewidth=1, alpha=0.7)

    # Solde N-1 (Phase 4)
    if n1_series and n1_series.data:
        n1_values = [p.y for p in n1_series.data]
        ax.plot(x_positions, n1_values, color=n1_series.color, linestyle="--",
                linewidth=1.2, marker="o", markersize=3, label="Solde N-1")
        ax.legend(loc="upper right", fontsize=8)

    ax.set_xticks(x_positions)
    ax.set_xticklabels([str(p.x) for p in rec_series.data], fontsize=8)
    ax.set_title(config.title, color="#f1f5f9", fontsize=11, pad=10, loc="left")
    if config.subtitle:
        fig.text(0.02, 0.93, config.subtitle, color="#94a3b8", fontsize=8)

    # Format axis Y en k€
    def _fmt(x, _pos):
        return f"{int(x / 1000)} k" if abs(x) >= 1000 else f"{int(x)}"
    from matplotlib.ticker import FuncFormatter
    ax.yaxis.set_major_formatter(FuncFormatter(_fmt))

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    buf = BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=dpi)
    plt.close(fig)
    return buf.getvalue()


# ─── API publique ─────────────────────────────────────────────────

def render_chart_png(
    config: ChartConfig,
    width_mm: float = 170,
    height_mm: float = 90,
    dpi: int = 200,
) -> Optional[bytes]:
    """Dispatcher : retourne les bytes PNG du chart selon `config.type`.

    Retourne `None` en cas d'erreur (le PDF generator skip simplement le chart).
    """
    width_in = width_mm / 25.4
    height_in = height_mm / 25.4
    try:
        if config.type == "donut":
            return _pdf_donut(config, width_in, height_in, dpi)
        if config.type == "waterfall":
            return _pdf_waterfall(config, width_in, height_in, dpi)
        if config.type in ("cadence", "bar"):
            return _pdf_cadence(config, width_in, height_in, dpi)
        logger.warning("ChartType non géré (PDF) : %s", config.type)
        return None
    except Exception as e:
        logger.warning("PDF chart rendering failed for %s: %s", config.id, e)
        return None
