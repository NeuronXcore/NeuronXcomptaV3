"""
LivretHtmlGenerator — produit un fichier HTML 100% autonome figeant un livret.

Caractéristiques :
  - Un seul fichier `.html`. CSS + JS inline. Aucun fetch, aucun import externe.
  - Consultable hors-ligne (file://, USB, email attachment, etc.).
  - Filtres locaux (chips), expand/collapse opérations, sommaire cliquable, compteur
    "X / Y affichées" — tout via vanilla JS qui lit `LIVRET_DATA` injecté dans le doc.
  - Police système (sans-serif fallback) — pas de fonts custom à embarquer.

Pas de Jinja2 (le projet utilise déjà du formatting Python natif pour les emails).
On compose le HTML via f-strings + json.dumps pour l'injection des données.

Cf. prompts.md/prompt-livret-comptable-phase3.md §4.3.
"""
from __future__ import annotations

import html as _html
import json
from datetime import datetime
from typing import Optional

from backend.models.livret import Livret, SnapshotType


def _esc(s: object) -> str:
    """HTML escape (texte affiché, pas attribut)."""
    return _html.escape(str(s) if s is not None else "", quote=False)


def _format_label(snapshot_type: SnapshotType) -> str:
    return {
        SnapshotType.AUTO_MONTHLY: "Auto mensuel",
        SnapshotType.CLOTURE: "Clôture",
        SnapshotType.MANUAL: "Manuel",
    }.get(snapshot_type, snapshot_type.value)


def _badge_color(snapshot_type: SnapshotType) -> tuple[str, str]:
    """Retourne (background, color) RGB hex pour le badge du type."""
    return {
        SnapshotType.AUTO_MONTHLY: ("#1e3a8a33", "#93c5fd"),  # bleu
        SnapshotType.CLOTURE: ("#15803d33", "#86efac"),       # vert
        SnapshotType.MANUAL: ("#b4530933", "#fcd34d"),        # ambre
    }.get(snapshot_type, ("#33333333", "#cccccc"))


_INLINE_CSS = """
:root {
  --bg: #0f172a;
  --surface: #1e293b;
  --surface-hover: #334155;
  --border: #334155;
  --text: #f1f5f9;
  --text-muted: #94a3b8;
  --primary: #811971;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.container { max-width: 1280px; margin: 0 auto; padding: 24px 32px 64px; }
.cover {
  border-radius: 16px;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border: 1px solid var(--border);
  padding: 32px;
  margin-bottom: 28px;
}
.cover h1 { margin: 0; font-size: 30px; letter-spacing: -0.01em; }
.cover .meta { color: var(--text-muted); font-size: 14px; margin-top: 8px; }
.cover .badge {
  display: inline-block; padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  margin-left: 8px;
}
.cover .frozen-tag {
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(245, 158, 11, 0.15); color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 999px;
  padding: 4px 12px; font-size: 11px; margin-top: 14px;
}
.toolbar {
  display: flex; flex-wrap: wrap; gap: 12px;
  align-items: center; justify-content: space-between;
  padding: 12px 0; border-bottom: 1px solid var(--border); margin-bottom: 16px;
}
.toolbar .info { color: var(--text-muted); font-size: 13px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  padding: 5px 12px; border-radius: 999px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text-muted);
  font-size: 12px; font-weight: 500; cursor: pointer;
  transition: all 150ms;
}
.chip.active.all { background: var(--text); color: var(--bg); border-color: var(--text); }
.chip.active.a_revoir { background: rgba(245, 158, 11, 0.1); color: var(--warning); border-color: rgba(245, 158, 11, 0.4); }
.chip.active.justif_manquant { background: rgba(239, 68, 68, 0.1); color: var(--danger); border-color: rgba(239, 68, 68, 0.4); }
.chip.active.mixte { background: rgba(129, 25, 113, 0.1); color: var(--primary); border-color: rgba(129, 25, 113, 0.4); }
.chip.active.locked { background: rgba(148, 163, 184, 0.1); color: var(--text-muted); border-color: rgba(148, 163, 184, 0.4); }
.toc { margin: 24px 0; }
.toc h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); font-weight: 600; }
.toc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
.toc-item {
  display: block; text-decoration: none;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; color: var(--text); transition: all 150ms;
}
.toc-item:hover { border-color: var(--primary); }
.toc-item .num { font-size: 10px; color: var(--text-muted); font-family: monospace; letter-spacing: 0.06em; }
.toc-item .ti { font-size: 13px; font-weight: 500; margin-top: 2px; line-height: 1.25; }
.chapter {
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  margin-bottom: 24px; overflow: hidden; scroll-margin-top: 16px;
}
.chapter-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  padding: 18px 24px; border-bottom: 1px solid var(--border);
  background: linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%);
}
.chapter-head .num {
  display: inline-block; padding: 4px 8px; border-radius: 6px;
  background: var(--surface-hover); color: var(--text-muted);
  font-family: monospace; font-size: 11px; letter-spacing: 0.06em; font-weight: 600;
}
.chapter-head h2 { margin: 0; font-size: 20px; font-weight: 700; }
.chapter-head .tag { color: var(--text-muted); font-size: 12px; margin-top: 4px; }
.chapter-head .totals { text-align: right; }
.chapter-head .ytd-label { font-size: 10px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.06em; }
.chapter-head .ytd-val { font-size: 18px; font-weight: 600; }
.chapter-head .proj-label { font-size: 10px; color: rgba(129, 25, 113, 0.8); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
.chapter-head .proj-val { font-size: 14px; color: var(--primary); font-weight: 500; }
.chapter-body { padding: 24px; }
.metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
.metric {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  padding: 16px;
}
.metric.is-projection { border-style: dashed; border-color: rgba(129, 25, 113, 0.4); position: relative; }
.metric .badge-proj {
  position: absolute; top: 8px; right: 10px;
  font-size: 9px; padding: 2px 6px; border-radius: 4px;
  background: rgba(129, 25, 113, 0.15); color: var(--primary);
  text-transform: uppercase; letter-spacing: 0.06em;
}
.metric .label { color: var(--text-muted); font-size: 13px; }
.metric .val { font-size: 22px; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; }
.metric .val.up { color: var(--success); }
.metric .val.down { color: var(--danger); }
.subcat-section { margin-bottom: 20px; }
.subcat-head {
  display: flex; align-items: baseline; justify-content: space-between; padding: 0 4px 6px;
}
.subcat-head .name { font-size: 14px; font-weight: 600; }
.subcat-head .meta { color: var(--text-muted); font-size: 11px; }
.subcat-head .total { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ops-table {
  width: 100%; border-collapse: collapse; font-size: 13px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
}
.ops-table thead { background: var(--surface-hover); }
.ops-table th {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--text-muted); padding: 8px; text-align: left; font-weight: 600;
}
.ops-table th.right { text-align: right; }
.ops-table td { padding: 8px; border-top: 1px solid var(--border); }
.ops-table td.right { text-align: right; }
.ops-table tr.op-row.expandable { cursor: pointer; }
.ops-table tr.op-row.expandable:hover { background: rgba(255, 255, 255, 0.02); }
.ops-table tr.op-row.hidden, .subcat-section.hidden { display: none; }
.flag-pills { display: inline-flex; gap: 4px; }
.pill { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; font-size: 9px; font-weight: 700; }
.pill.lettre { background: rgba(34, 197, 94, 0.15); color: var(--success); }
.pill.a_revoir { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
.pill.justif_manquant { background: rgba(239, 68, 68, 0.15); color: var(--danger); }
.pill.locked { background: rgba(148, 163, 184, 0.15); color: var(--text-muted); }
.pill.mixte { background: rgba(129, 25, 113, 0.15); color: var(--primary); }
.expand-row { background: rgba(0, 0, 0, 0.25); }
.expand-row td { padding: 12px 16px; }
.expand-row .vl-line {
  display: grid; grid-template-columns: 90px 1fr 90px 110px; gap: 8px;
  padding: 4px 0; border-bottom: 1px solid var(--border); font-size: 12px;
}
.expand-row .vl-line:last-child { border-bottom: none; }
.expand-row .vl-meta { color: var(--text-muted); font-size: 11px; font-style: italic; }
.filter-counter { color: var(--text-muted); font-size: 11px; font-style: italic; padding: 4px 4px 8px; }
.empty { color: var(--text-muted); font-style: italic; text-align: center; padding: 32px 16px; }
.formula { background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 12px; padding: 18px; font-family: monospace; }
.formula-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 6px 0; }
.formula-row.equals { border-top: 1px solid rgba(129, 25, 113, 0.4); margin-top: 10px; padding-top: 10px; font-weight: 700; }
.formula-row .op { width: 16px; font-weight: 700; text-align: center; }
.formula-row .op.plus { color: var(--success); }
.formula-row .op.minus { color: var(--danger); }
.formula-row .op.equals { color: var(--primary); }
.formula-row .label { flex: 1; }
.formula-row .note { color: var(--text-muted); font-size: 10px; font-style: italic; }
.formula-row .amt { font-variant-numeric: tabular-nums; }
.formula-row.equals .amt { color: var(--primary); font-size: 16px; }
.proj-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 16px; }
.proj-card { background: var(--surface-hover); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
.proj-card .label { font-size: 11px; color: var(--text-muted); }
.proj-card .val { font-size: 18px; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; }
.proj-card .sub { font-size: 10px; color: var(--text-muted); margin-top: 4px; font-style: italic; }
.gauges-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }
.gauge { background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
.gauge .name { font-size: 13px; font-weight: 600; }
.gauge .cumul { font-size: 22px; font-weight: 700; margin: 6px 0; font-variant-numeric: tabular-nums; }
.gauge .cible { font-size: 11px; color: var(--text-muted); }
.gauge .bar { height: 6px; border-radius: 999px; background: var(--surface); margin-top: 10px; overflow: hidden; }
.gauge .bar-fill { height: 100%; transition: width 200ms; }
.gauge .pct { font-size: 11px; font-weight: 600; margin-top: 4px; }
.amort-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.amort-table th { text-align: left; padding: 8px; font-size: 10px; text-transform: uppercase; color: var(--text-muted); }
.amort-table td { padding: 8px; border-top: 1px solid var(--border); }
.amort-table tr:last-child td { border-top: 2px solid rgba(129, 25, 113, 0.4); background: rgba(129, 25, 113, 0.08); font-weight: 600; }
.cadence-svg { width: 100%; height: 220px; background: rgba(0, 0, 0, 0.2); border-radius: 8px; padding: 16px; }
.deco-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }
.deco-card { background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
.deco-card h4 { margin: 0 0 6px; font-size: 13px; }
.deco-card .meta { color: var(--text-muted); font-size: 11px; line-height: 1.5; }
.glossary { display: flex; flex-direction: column; gap: 12px; }
.glossary-item { border-left: 2px solid rgba(129, 25, 113, 0.4); padding-left: 12px; }
.glossary-item .term { font-size: 13px; font-weight: 600; }
.glossary-item .def { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.section-acc {
  background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border); border-radius: 12px;
  margin-bottom: 8px; overflow: hidden;
}
.section-acc summary {
  cursor: pointer; padding: 12px 16px; font-size: 13px; font-weight: 600;
  list-style: none;
}
.section-acc summary::-webkit-details-marker { display: none; }
.section-acc[open] summary { border-bottom: 1px solid var(--border); }
.section-acc .body { padding: 16px; }
/* Phase 5 — Charts SVG inline */
.livret-chart-figure {
  margin: 12px 0 18px; padding: 14px;
  background: rgba(0, 0, 0, 0.18); border: 1px solid var(--border);
  border-radius: 12px; overflow-x: auto;
}
.livret-chart-caption {
  margin: 0 0 8px; font-size: 13px; color: var(--text);
}
.livret-chart-caption strong { font-weight: 600; }
.livret-chart-subtitle {
  display: block; margin: 2px 0 0; color: var(--text-muted);
  font-size: 11px; font-weight: normal;
}
.livret-chart { display: block; max-width: 100%; height: auto; }
.livret-chart .chart-slice, .livret-chart .chart-bar {
  cursor: pointer; transition: opacity 120ms;
}
.livret-chart .chart-slice:hover, .livret-chart .chart-bar:hover { opacity: 0.85; }
.chart-data-fallback {
  margin-top: 10px; font-size: 11px; color: var(--text-muted);
}
.chart-data-fallback summary {
  cursor: pointer; padding: 4px 0; user-select: none;
}
.chart-data-fallback table {
  width: 100%; margin-top: 6px; border-collapse: collapse; font-size: 11px;
}
.chart-data-fallback th, .chart-data-fallback td {
  padding: 4px 8px; border-top: 1px solid var(--border); text-align: left;
}
.chart-data-fallback th {
  font-weight: 600; color: var(--text); background: rgba(255,255,255,0.03);
}
#livret-chart-tooltip {
  position: fixed; pointer-events: none;
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 10px; font-size: 11px; color: var(--text);
  box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 9999;
  max-width: 280px; opacity: 0; transition: opacity 120ms;
}
#livret-chart-tooltip.visible { opacity: 1; }

@media print {
  body { background: white; color: black; }
  .toolbar, .chips { display: none; }
  .chapter { break-inside: avoid; border-color: #ddd; }
  .livret-chart-figure { background: white; border-color: #ddd; }
  #livret-chart-tooltip { display: none; }
}
"""


_INLINE_JS = r"""
(function() {
  const data = window.LIVRET_DATA;
  if (!data) return;

  const activeFilters = new Set();

  function applyFilters() {
    document.querySelectorAll('.chapter[data-supports-filters="true"]').forEach(chap => {
      let totalVisible = 0, totalRows = 0;
      chap.querySelectorAll('tr.op-row').forEach(row => {
        totalRows++;
        const flags = JSON.parse(row.getAttribute('data-flags') || '{}');
        let visible = true;
        if (activeFilters.size > 0) {
          for (const f of activeFilters) {
            if (!flags[f]) { visible = false; break; }
          }
        }
        row.classList.toggle('hidden', !visible);
        // Hide also expand row si présent
        const expand = row.nextElementSibling;
        if (expand && expand.classList.contains('expand-row')) {
          expand.classList.toggle('hidden', !visible || !row.classList.contains('expanded'));
        }
        if (visible) totalVisible++;
      });
      // Counter par chapitre
      let counter = chap.querySelector('.filter-counter-chapter');
      if (activeFilters.size > 0) {
        if (!counter) {
          counter = document.createElement('div');
          counter.className = 'filter-counter filter-counter-chapter';
          chap.querySelector('.chapter-body').prepend(counter);
        }
        counter.textContent = `${totalVisible} / ${totalRows} affichées · les totaux ne sont pas filtrés`;
      } else if (counter) {
        counter.remove();
      }
    });
  }

  // Filter chips
  document.querySelectorAll('.chip[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      const f = chip.getAttribute('data-filter');
      if (f === 'all') {
        activeFilters.clear();
      } else if (activeFilters.has(f)) {
        activeFilters.delete(f);
      } else {
        activeFilters.add(f);
      }
      // Mise à jour visuelle
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      if (activeFilters.size === 0) {
        document.querySelector('.chip[data-filter="all"]').classList.add('active', 'all');
      } else {
        for (const af of activeFilters) {
          document.querySelector(`.chip[data-filter="${af}"]`).classList.add('active', af);
        }
      }
      applyFilters();
    });
  });

  // Expand/collapse ops avec sub_lines
  document.querySelectorAll('tr.op-row.expandable').forEach(row => {
    row.addEventListener('click', () => {
      row.classList.toggle('expanded');
      const expand = row.nextElementSibling;
      if (expand && expand.classList.contains('expand-row')) {
        expand.classList.toggle('hidden');
      }
    });
  });

  // TOC scroll
  document.querySelectorAll('.toc-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(item.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Phase 5 — tooltip flottant pour les charts SVG
  // Lit l'attribut `data-chart-tooltip` des <rect> / <path> au survol.
  // Un seul élément tooltip réutilisé pour tous les charts (perf + DOM léger).
  let tip = document.getElementById('livret-chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'livret-chart-tooltip';
    document.body.appendChild(tip);
  }
  function showTooltip(text, x, y) {
    tip.textContent = text;
    tip.style.left = (x + 14) + 'px';
    tip.style.top = (y + 14) + 'px';
    tip.classList.add('visible');
  }
  function hideTooltip() { tip.classList.remove('visible'); }

  document.body.addEventListener('mousemove', (e) => {
    const target = e.target;
    if (!target || target.nodeType !== 1) return;
    const txt = target.getAttribute && target.getAttribute('data-chart-tooltip');
    if (txt) showTooltip(txt, e.clientX, e.clientY);
    else if (tip.classList.contains('visible')) hideTooltip();
  });
  document.body.addEventListener('mouseleave', hideTooltip);
})();
"""


# ─── Rendu chapitre par chapitre ──────────────────────────────────

def _format_currency(value: float) -> str:
    """Format FR : 1 234.56 € (espaces fines, 2 décimales virgule)."""
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


def _flag_pills_html(flags: dict) -> str:
    pills: list[str] = []
    if flags.get("lettre"):
        pills.append('<span class="pill lettre" title="Lettrée">✓</span>')
    if flags.get("a_revoir"):
        pills.append('<span class="pill a_revoir" title="À revoir">!</span>')
    if flags.get("justificatif_manquant"):
        pills.append('<span class="pill justif_manquant" title="Justificatif manquant">?</span>')
    if flags.get("locked"):
        pills.append('<span class="pill locked" title="Verrouillée">🔒</span>')
    if flags.get("is_mixte"):
        pills.append('<span class="pill mixte" title="Mixte">%</span>')
    if not pills:
        return ""
    return f'<span class="flag-pills">{"".join(pills)}</span>'


def _render_op_row(op: dict) -> str:
    """Rend une row + éventuellement une expand-row pour ses sub_lines."""
    flags = op.get("flags") or {}
    flags_json = json.dumps(flags)
    has_sub = bool(op.get("sub_lines"))
    has_meta = bool(op.get("locked")) or bool(flags.get("locked")) or has_sub
    row_class = "op-row expandable" if has_meta else "op-row"

    main = (
        f'<tr class="{row_class}" data-flags=\'{_html.escape(flags_json, quote=True)}\'>'
        f'<td>{_format_date_fr(op.get("date") or "")}</td>'
        f'<td>{_esc(op.get("libelle") or "")}'
    )
    if op.get("libelle_meta"):
        main += f'<div class="vl-meta">{_esc(op["libelle_meta"])}</div>'
    main += '</td>'
    main += f'<td>{_flag_pills_html(flags)}</td>'
    main += f'<td class="right">{_format_currency(op.get("montant") or 0)}</td>'
    main += '</tr>'

    if has_meta:
        expand_inner = ""
        if has_sub:
            expand_inner += '<div style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:600; margin-bottom:8px;">'
            expand_inner += f"Ventilation ({len(op['sub_lines'])} sous-ligne{'s' if len(op['sub_lines']) > 1 else ''})"
            expand_inner += '</div>'
            for sl in op["sub_lines"]:
                expand_inner += '<div class="vl-line">'
                expand_inner += f'<span>{_format_date_fr(sl.get("date") or "")}</span>'
                expand_inner += f'<span>{_esc(sl.get("libelle") or "")}'
                if sl.get("libelle_meta"):
                    expand_inner += f'<div class="vl-meta">{_esc(sl["libelle_meta"])}</div>'
                expand_inner += '</span>'
                expand_inner += f'<span>{_flag_pills_html(sl.get("flags") or {})}</span>'
                expand_inner += f'<span style="text-align:right;">{_format_currency(sl.get("montant") or 0)}</span>'
                expand_inner += '</div>'
        if op.get("locked") or flags.get("locked"):
            expand_inner += '<div style="margin-top:8px; font-size:11px; color:var(--text-muted);">🔒 Verrouillée — éditable depuis l\'Éditeur</div>'

        main += f'<tr class="expand-row hidden"><td colspan="4">{expand_inner}</td></tr>'

    return main


def _render_subcat_section(sub: dict) -> str:
    name = _esc(sub.get("name") or "")
    total_ytd = _format_currency(sub.get("total_ytd") or 0)
    nb_ops = sub.get("nb_operations") or 0
    meta_parts = [f'{nb_ops} opération{"s" if nb_ops > 1 else ""}']
    if sub.get("nb_mixte"): meta_parts.append(f'{sub["nb_mixte"]} mixte{"s" if sub["nb_mixte"] > 1 else ""}')
    if sub.get("nb_a_revoir"): meta_parts.append(f'{sub["nb_a_revoir"]} à revoir')
    if sub.get("nb_justif_manquant"): meta_parts.append(f'{sub["nb_justif_manquant"]} sans justif.')
    meta = " · ".join(meta_parts)

    rows = "".join(_render_op_row(op) for op in (sub.get("operations") or []))

    return f'''
<div class="subcat-section">
  <div class="subcat-head">
    <div>
      <div class="name">{name}</div>
      <div class="meta">{meta}</div>
    </div>
    <div class="total">{total_ytd}</div>
  </div>
  <table class="ops-table">
    <thead>
      <tr><th style="width:90px;">Date</th><th>Libellé</th><th style="width:120px;">Flags</th><th class="right" style="width:110px;">Montant</th></tr>
    </thead>
    <tbody>{rows or '<tr><td colspan="4" class="empty">Aucune opération</td></tr>'}</tbody>
  </table>
</div>
'''


def _render_chapter_head(ch: dict, with_proj: bool = True) -> str:
    out = '<div class="chapter-head">'
    out += '<div style="display:flex; gap:14px; align-items:flex-start;">'
    out += f'<div class="num">{_esc(ch.get("number") or "")}</div>'
    out += '<div>'
    out += f'<h2>{_esc(ch.get("title") or "")}</h2>'
    if ch.get("tag"):
        out += f'<div class="tag">{_esc(ch["tag"])}</div>'
    out += '</div></div>'

    out += '<div class="totals">'
    if ch.get("total_ytd") is not None:
        out += '<div class="ytd-label">YTD</div>'
        out += f'<div class="ytd-val">{_format_currency(ch.get("total_ytd") or 0)}</div>'
    if with_proj and ch.get("total_projected_annual") is not None:
        out += '<div class="proj-label">Projeté annuel</div>'
        out += f'<div class="proj-val">{_format_currency(ch.get("total_projected_annual") or 0)}</div>'
    out += '</div>'
    out += '</div>'
    return out


def _render_cadence_svg(cadence: list[dict]) -> str:
    """Mini bar chart 12 mois en SVG inline (recettes vert / charges rouge)."""
    if not cadence:
        return ""
    max_val = max(
        max(p.get("recettes") or 0, p.get("charges") or 0) for p in cadence
    ) or 1
    width = 920
    height = 180
    margin_l = 40
    margin_b = 24
    chart_w = width - margin_l - 20
    chart_h = height - margin_b - 10
    bar_w = chart_w / 12 / 2 - 2

    bars = []
    labels = []
    for i, p in enumerate(cadence):
        x_center = margin_l + (i + 0.5) * (chart_w / 12)
        rec = p.get("recettes") or 0
        chg = p.get("charges") or 0
        is_proj = p.get("is_projection")
        is_curr = p.get("is_current")
        rec_h = (rec / max_val) * chart_h if max_val else 0
        chg_h = (chg / max_val) * chart_h if max_val else 0
        opacity = "0.45" if is_proj else "1"
        dash = ' stroke-dasharray="3 2"' if is_proj else ""
        bars.append(
            f'<rect x="{x_center - bar_w - 1:.1f}" y="{height - margin_b - rec_h:.1f}" '
            f'width="{bar_w:.1f}" height="{rec_h:.1f}" fill="#22c55e" opacity="{opacity}"'
            f' stroke="#22c55e"{dash}/>'
        )
        bars.append(
            f'<rect x="{x_center + 1:.1f}" y="{height - margin_b - chg_h:.1f}" '
            f'width="{bar_w:.1f}" height="{chg_h:.1f}" fill="#ef4444" opacity="{opacity}"'
            f' stroke="#ef4444"{dash}/>'
        )
        labels.append(
            f'<text x="{x_center:.1f}" y="{height - 6}" text-anchor="middle" '
            f'font-size="10" fill="#94a3b8">{_esc(p.get("label") or "")}</text>'
        )
        if is_curr:
            bars.append(
                f'<line x1="{x_center:.1f}" y1="10" x2="{x_center:.1f}" y2="{height - margin_b}" '
                f'stroke="#811971" stroke-dasharray="4 4" stroke-width="1"/>'
            )

    return f'''
<svg viewBox="0 0 {width} {height}" class="cadence-svg" xmlns="http://www.w3.org/2000/svg">
  {''.join(bars)}
  {''.join(labels)}
</svg>
<div style="display:flex; gap:16px; margin-top:8px; font-size:11px; color:var(--text-muted);">
  <span><span style="display:inline-block; width:10px; height:10px; background:#22c55e; vertical-align:middle;"></span> Recettes</span>
  <span><span style="display:inline-block; width:10px; height:10px; background:#ef4444; vertical-align:middle;"></span> Charges</span>
  <span style="font-style:italic;"><span style="display:inline-block; width:10px; height:10px; background:#22c55e; opacity:0.45; border:1px dashed #22c55e; vertical-align:middle;"></span> Projeté</span>
</div>
'''


def _render_charts_block(ch: dict) -> str:
    """Phase 5 — rend les `ChartConfig` attachés au chapitre via le SVG inline.

    Retourne `""` si aucun chart. Délègue à `livret_html_charts.render_chart_svg`.
    """
    charts = ch.get("charts") or []
    if not charts:
        return ""
    from backend.services import livret_html_charts as _charts
    parts: list[str] = []
    for cfg in charts:
        try:
            svg = _charts.render_chart_svg(_ChartConfigDictAdapter(cfg))
            if svg:
                parts.append(svg)
        except Exception:
            continue
    return "".join(parts)


class _ChartConfigDictAdapter:
    """Adapter ultra-minimal : convertit un dict (model_dump) en object compatible
    avec l'interface `ChartConfig` attendue par `livret_html_charts`. Utilisé car
    `_render_chapter_*` reçoit des dicts (model_dump JSON) et non des Pydantic.
    """
    def __init__(self, d: dict):
        self.id = d.get("id", "")
        self.type = d.get("type", "bar")
        self.title = d.get("title", "")
        self.subtitle = d.get("subtitle")
        self.x_label = d.get("x_label")
        self.y_label = d.get("y_label")
        self.total = d.get("total")
        self.annotations = d.get("annotations")
        self.drill_target = d.get("drill_target")
        self.series = [_SeriesAdapter(s) for s in (d.get("series") or [])]


class _SeriesAdapter:
    def __init__(self, s: dict):
        self.name = s.get("name", "")
        self.color = s.get("color", "#94a3b8")
        self.stack_id = s.get("stack_id")
        self.data = [_PointAdapter(p) for p in (s.get("data") or [])]


class _PointAdapter:
    def __init__(self, p: dict):
        self.x = p.get("x")
        self.y = p.get("y", 0)
        self.color = p.get("color")
        self.meta = p.get("meta") or {}


def _render_chapter_01(ch: dict) -> str:
    syn = ch.get("synthese") or {}
    metrics = syn.get("metrics") or []
    cadence = syn.get("cadence_mensuelle") or []

    metrics_html = ""
    for m in metrics:
        is_proj = m.get("is_projection")
        val_class = "down" if (m.get("value") or 0) < 0 else (
            "down" if "charges" in (m.get("label") or "").lower() else "up"
        )
        klass = "metric is-projection" if is_proj else "metric"
        proj_badge = '<span class="badge-proj">Projeté</span>' if is_proj else ""
        metrics_html += f'<div class="{klass}">{proj_badge}<div class="label">{_esc(m.get("label"))}</div><div class="val {val_class}">{_format_currency(m.get("value") or 0)}</div></div>'

    body = f'<div class="metrics-grid">{metrics_html}</div>' if metrics else '<div class="empty">Aucune métrique disponible.</div>'

    # Phase 5 — utilise le chart si présent, sinon fallback sur l'ancien SVG ad-hoc.
    charts_html = _render_charts_block(ch)
    if charts_html:
        body += charts_html
    else:
        body += _render_cadence_svg(cadence)

    return f'<section id="livret-chapter-01" class="chapter">{_render_chapter_head(ch, with_proj=False)}<div class="chapter-body">{body}</div></section>'


def _render_chapter_subcats(ch: dict, supports_filters: bool, empty_msg: str) -> str:
    subs = ch.get("subcategories") or []
    # Phase 5 — chart en tête de chapitre (donut chap 03, etc.)
    charts_html = _render_charts_block(ch)

    body = ""
    if charts_html:
        body += charts_html
    if not subs:
        body += f'<div class="empty">{empty_msg}</div>'
    else:
        body += "".join(_render_subcat_section(s) for s in subs)
    flag_attr = ' data-supports-filters="true"' if supports_filters else ""
    return (
        f'<section id="livret-chapter-{ch.get("number")}" class="chapter"{flag_attr}>'
        f'{_render_chapter_head(ch)}<div class="chapter-body">{body}</div></section>'
    )


def _render_chapter_04(ch: dict) -> str:
    decos = ch.get("decompositions") or []
    deco_html = ""
    for d in decos:
        title = {
            "blanchissage": "Blanchissage",
            "repas": "Repas pro",
            "vehicule": "Véhicule (quote-part)",
        }.get(d.get("type_forfait"), d.get("type_forfait"))
        meta_lines = []
        if d.get("date_ecriture"):
            meta_lines.append(f'OD au {_format_date_fr(d["date_ecriture"])}')
        if d.get("jours") is not None:
            meta_lines.append(f'{d["jours"]} jours travaillés')
        if d.get("forfait_jour") is not None:
            meta_lines.append(f'Forfait/jour : {d["forfait_jour"]:.2f} €')
        if d.get("ratio_pro_pct") is not None:
            meta_lines.append(f'Quote-part pro : {d["ratio_pro_pct"]} %')
        if d.get("reference_legale"):
            meta_lines.append(f'<i>{_esc(d["reference_legale"])}</i>')
        meta = "<br>".join(meta_lines)
        montant = _format_currency(d.get("montant") or 0) if (d.get("montant") or 0) > 0 else ""
        deco_html += f'<div class="deco-card"><h4>{_esc(title)} <span style="float:right; font-weight:500;">{montant}</span></h4><div class="meta">{meta}</div></div>'

    decompositions_block = f'<div class="deco-grid">{deco_html}</div>' if deco_html else ""
    subs = ch.get("subcategories") or []
    if not subs and not decompositions_block:
        body = '<div class="empty">Aucune charge forfaitaire générée pour cet exercice.</div>'
    else:
        subs_html = "".join(_render_subcat_section(s) for s in subs)
        body = decompositions_block + subs_html

    return f'<section id="livret-chapter-04" class="chapter" data-supports-filters="true">{_render_chapter_head(ch)}<div class="chapter-body">{body}</div></section>'


def _render_chapter_06(ch: dict) -> str:
    immos = ch.get("immobilisations") or []
    total = ch.get("total_dotations_annuelles") or 0

    if not immos:
        body = '<div class="empty">Aucune immobilisation enregistrée.</div>'
    else:
        rows = ""
        for i in immos:
            rows += "<tr>"
            badge = ' <span class="pill mixte" style="font-size:9px;">Reprise</span>' if i.get("is_backfill") else ""
            rows += f'<td>{_esc(i.get("nom") or "")}{badge}</td>'
            rows += f'<td>{_esc(i.get("poste") or "")}</td>'
            rows += f'<td>{_format_date_fr(i.get("date_acquisition") or "")}</td>'
            rows += f'<td style="text-align:right;">{i.get("duree_amortissement") or 0} ans</td>'
            rows += f'<td style="text-align:right;">{_format_currency(i.get("valeur_origine") or 0)}</td>'
            da = i.get("dotation_annuelle") or 0
            rows += f'<td style="text-align:right;">{_format_currency(da) if da > 0 else "—"}</td>'
            rows += f'<td style="text-align:right;">{_format_currency(i.get("cumul_amortissement") or 0)}</td>'
            rows += f'<td style="text-align:right; font-weight:600;">{_format_currency(i.get("vnc") or 0)}</td>'
            rows += "</tr>"
        rows += f'<tr><td colspan="5" style="text-align:right;">Total dotations YTD</td><td colspan="3" style="text-align:right;">{_format_currency(total)}</td></tr>'
        body = f'''
<table class="amort-table">
  <thead><tr><th>Immobilisation</th><th>Poste</th><th>Acquis le</th><th style="text-align:right;">Durée</th><th style="text-align:right;">Val. origine</th><th style="text-align:right;">Dotation YTD</th><th style="text-align:right;">Cumul</th><th style="text-align:right;">VNC</th></tr></thead>
  <tbody>{rows}</tbody>
</table>
'''
    return f'<section id="livret-chapter-06" class="chapter">{_render_chapter_head(ch)}<div class="chapter-body">{body}</div></section>'


def _render_chapter_07(ch: dict) -> str:
    gauges = ch.get("gauges") or []
    gauges_html = ""
    for g in gauges:
        ratio = max(0.0, min(1.5, g.get("ratio") or 0))
        ratio_pct = int(ratio * 100)
        cible = g.get("cible_estimee") or 0
        cumul = g.get("cumul_ytd") or 0
        bar_color = "#22c55e" if ratio >= 1 else ("#811971" if ratio >= 0.7 else "#f59e0b")
        gauges_html += f'''
<div class="gauge">
  <div class="name">{_esc(g.get("name") or "")}</div>
  <div class="cumul">{_format_currency(cumul)}</div>
  <div class="cible">sur cible {_format_currency(cible)}</div>
  <div class="bar"><div class="bar-fill" style="width:{min(100, ratio_pct)}%; background:{bar_color};"></div></div>
  <div class="pct" style="color:{bar_color};">{ratio_pct}% provisionné</div>
</div>'''

    body = f'<div class="gauges-grid">{gauges_html}</div>' if gauges_html else ""
    subs = ch.get("subcategories") or []
    is_empty = all((s.get("nb_operations") or 0) == 0 for s in subs)
    if is_empty:
        body += '<div class="empty">Aucun transfert taggé en provision pour cet exercice.</div>'
    else:
        body += "".join(_render_subcat_section(s) for s in subs)

    return f'<section id="livret-chapter-07" class="chapter" data-supports-filters="true">{_render_chapter_head(ch)}<div class="chapter-body">{body}</div></section>'


def _render_chapter_08(ch: dict) -> str:
    formula = ch.get("formula") or []
    proj = ch.get("projection") or {}
    sources = ch.get("sources") or {}
    is_liasse = sources.get("recettes") == "liasse"

    body = ""
    if not is_liasse:
        body += '<div style="background:rgba(245,158,11,0.05); border:1px solid rgba(245,158,11,0.4); border-radius:8px; padding:12px; margin-bottom:16px; color:var(--warning); font-size:13px;">⚠ Recettes calculées en base bancaire — saisir la liasse fiscale SCP pour finaliser le BNC.</div>'

    # Phase 5 — waterfall en tête (avant la formule détaillée)
    body += _render_charts_block(ch)

    body += '<div class="formula"><div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); margin-bottom:10px;">Formule BNC (YTD)</div>'
    for line in formula:
        op = line.get("operator") or "plus"
        op_sym = {"plus": "+", "minus": "−", "equals": "="}.get(op, "?")
        klass = "formula-row equals" if op == "equals" else "formula-row"
        note_html = f'<div class="note">{_esc(line.get("note"))}</div>' if line.get("note") else ""
        body += f'<div class="{klass}"><span class="op {op}">{op_sym}</span><div class="label">{_esc(line.get("label") or "")}{note_html}</div><span class="amt">{_format_currency(line.get("amount") or 0)}</span></div>'
    if ch.get("formula_comment"):
        body += f'<div style="font-size:11px; color:var(--text-muted); font-style:italic; margin-top:10px;">{_esc(ch["formula_comment"])}</div>'
    body += '</div>'

    body += '<div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); margin:18px 0 8px;">Projection fiscale annuelle</div>'
    body += '<div class="proj-grid">'
    body += f'<div class="proj-card"><div class="label">BNC projeté</div><div class="val" style="color:var(--primary);">{_format_currency(proj.get("bnc_projete_annuel") or 0)}</div></div>'
    body += f'<div class="proj-card"><div class="label">Impôt sur le revenu</div><div class="val" style="color:var(--warning);">{_format_currency(proj.get("ir_estime") or 0)}</div></div>'
    body += f'<div class="proj-card"><div class="label">Charges sociales</div><div class="val" style="color:var(--warning);">{_format_currency(proj.get("total_charges_sociales_estime") or 0)}</div><div class="sub">URSSAF {_format_currency(proj.get("urssaf_estime") or 0)} · CARMF {_format_currency(proj.get("carmf_estime") or 0)} · OdM {_format_currency(proj.get("odm_estime") or 0)}</div></div>'
    body += f'<div class="proj-card"><div class="label">Revenu net après charges</div><div class="val" style="color:var(--success);">{_format_currency(proj.get("revenu_net_apres_charges") or 0)}</div></div>'
    body += '</div>'

    if sources:
        body += '<div style="margin-top:18px; padding-top:12px; border-top:1px solid var(--border); font-size:11px; color:var(--text-muted);">'
        body += '<span style="text-transform:uppercase; font-weight:600;">Sources</span> · '
        body += " · ".join(f'{k}: <span style="color:var(--text);">{_esc(v)}</span>' for k, v in sources.items())
        body += '</div>'

    return f'<section id="livret-chapter-08" class="chapter">{_render_chapter_head(ch, with_proj=True)}<div class="chapter-body">{body}</div></section>'


def _render_chapter_09(ch: dict) -> str:
    justifs = ch.get("justificatifs_index") or []
    baremes = ch.get("baremes_appliques") or []
    glossaire = ch.get("glossaire") or []
    methodologie = ch.get("methodologie") or ""

    # Index justifs (max 200 affichés ; au-delà message tronqué)
    max_show = 200
    truncated = len(justifs) > max_show
    justifs_show = justifs[:max_show]
    rows = ""
    for j in justifs_show:
        rows += '<tr>'
        rows += f'<td>{_format_date_fr(j.get("date") or "")}</td>'
        fac = ' <span class="pill mixte" style="font-size:9px;">fac</span>' if j.get("is_facsimile") else ""
        rows += f'<td><code style="font-size:11px;">{_esc(j.get("filename") or "")}</code>{fac}</td>'
        rows += f'<td>{_esc(j.get("libelle_op") or "—")}</td>'
        m = j.get("montant")
        rows += f'<td style="text-align:right;">{_format_currency(m) if m else "—"}</td>'
        rows += '</tr>'
    justif_table = (
        '<table class="ops-table"><thead><tr><th>Date</th><th>Fichier</th><th>Libellé op</th><th class="right">Montant</th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
        if rows else '<div class="empty">Aucun justificatif référencé.</div>'
    )
    if truncated:
        justif_table += f'<div style="font-size:11px; color:var(--text-muted); margin-top:8px; font-style:italic;">+ {len(justifs) - max_show} entrées non affichées (snapshot HTML — voir l\'app pour la liste paginée complète)</div>'

    bar_html = ""
    for b in baremes:
        items = "".join(
            f'<div style="display:flex; gap:8px; font-size:11px;"><span style="color:var(--text-muted);">{_esc(k)}:</span><span>{_esc(v)}</span></div>'
            for k, v in (b.get("summary") or {}).items()
        )
        bar_html += f'<div style="background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:12px;"><div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="font-weight:600;">{_esc(b.get("nom") or "")}</span><span style="font-family:monospace; font-size:10px; color:var(--text-muted);">{_esc(b.get("file") or "")}</span></div>{items}</div>'
    bar_block = f'<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px;">{bar_html}</div>' if bar_html else '<div class="empty">Aucun barème pour cet exercice.</div>'

    glo_html = "".join(
        f'<div class="glossary-item"><div class="term">{_esc(g.get("term") or "")}</div><div class="def">{_esc(g.get("definition") or "")}</div></div>'
        for g in glossaire
    )

    # Méthodologie : conversion légère markdown → HTML
    method_html = ""
    for line in methodologie.split("\n"):
        if line.startswith("## "):
            method_html += f'<h3 style="font-size:14px; margin:14px 0 6px;">{_esc(line[3:])}</h3>'
        elif line.startswith("- "):
            method_html += f'<li style="margin-left:18px; color:var(--text-muted); font-size:12px;">{_esc(line[2:])}</li>'
        elif line.strip():
            method_html += f'<p style="color:var(--text-muted); font-size:12px;">{_esc(line)}</p>'

    body = f'''
<details class="section-acc"><summary>📎 Index des justificatifs ({len(justifs)})</summary><div class="body">{justif_table}</div></details>
<details class="section-acc"><summary>⚖ Barèmes appliqués ({len(baremes)})</summary><div class="body">{bar_block}</div></details>
<details class="section-acc"><summary>📖 Glossaire ({len(glossaire)})</summary><div class="body"><div class="glossary">{glo_html}</div></div></details>
<details class="section-acc"><summary>📄 Méthodologie</summary><div class="body">{method_html}</div></details>
'''
    return f'<section id="livret-chapter-09" class="chapter">{_render_chapter_head(ch, with_proj=False)}<div class="chapter-body">{body}</div></section>'


def _render_chapter(ch: dict) -> str:
    """Dispatch sur le n° de chapitre."""
    num = ch.get("number") or ""
    if num == "01":
        return _render_chapter_01(ch)
    if num == "02":
        return _render_chapter_subcats(ch, supports_filters=True, empty_msg="Aucune recette enregistrée pour cet exercice.")
    if num == "03":
        return _render_chapter_subcats(ch, supports_filters=True, empty_msg="Aucune charge professionnelle pour cet exercice.")
    if num == "04":
        return _render_chapter_04(ch)
    if num == "05":
        return _render_chapter_subcats(ch, supports_filters=True, empty_msg="Aucune cotisation sociale détectée.")
    if num == "06":
        return _render_chapter_06(ch)
    if num == "07":
        return _render_chapter_07(ch)
    if num == "08":
        return _render_chapter_08(ch)
    if num == "09":
        return _render_chapter_09(ch)
    return _render_chapter_subcats(ch, supports_filters=False, empty_msg="—")


# ─── API publique ─────────────────────────────────────────────────

def render(
    livret: Livret,
    snapshot_id: str,
    snapshot_type: SnapshotType,
    snapshot_date: str,
    comment: Optional[str] = None,
) -> bytes:
    """Génère le HTML autonome du livret. Retourne les bytes UTF-8 prêts à écrire."""
    livret_dict = livret.model_dump(mode="json")
    metadata = livret_dict["metadata"]
    chapters = livret_dict["chapters"]
    toc = livret_dict.get("toc") or []

    # Cover + meta
    type_label = _format_label(snapshot_type)
    bg, color = _badge_color(snapshot_type)
    badge_html = f'<span class="badge" style="background:{bg}; color:{color};">{_esc(type_label)}</span>'
    comment_html = (
        f'<div style="margin-top:12px; padding:10px 14px; background:rgba(255,255,255,0.04); '
        f'border-left:3px solid var(--primary); font-size:13px;">{_esc(comment)}</div>'
        if comment else ""
    )

    # Toolbar
    toolbar = '''
<div class="toolbar">
  <div class="info">Filtres locaux (modifient l'affichage des opérations, pas les totaux)</div>
  <div class="chips">
    <button type="button" class="chip active all" data-filter="all">Tout</button>
    <button type="button" class="chip" data-filter="a_revoir">À revoir</button>
    <button type="button" class="chip" data-filter="justif_manquant">Justif manquant</button>
    <button type="button" class="chip" data-filter="mixte">Mixte</button>
    <button type="button" class="chip" data-filter="locked">Verrouillé</button>
  </div>
</div>
'''

    # TOC
    active_chapters = set(chapters.keys())
    toc_items = ""
    for entry in toc:
        num = entry.get("number") or ""
        title = entry.get("title") or ""
        if num in active_chapters:
            toc_items += (
                f'<a class="toc-item" href="#livret-chapter-{_esc(num)}">'
                f'<div class="num">{_esc(num)}</div>'
                f'<div class="ti">{_esc(title)}</div>'
                f'</a>'
            )
        else:
            toc_items += (
                f'<div class="toc-item" style="opacity:0.45; cursor:not-allowed;">'
                f'<div class="num">{_esc(num)}</div>'
                f'<div class="ti">{_esc(title)}</div>'
                f'</div>'
            )
    toc_block = f'<nav class="toc"><h2>Sommaire</h2><div class="toc-grid">{toc_items}</div></nav>'

    # Chapitres dans l'ordre du TOC
    chapters_html = ""
    for entry in toc:
        num = entry.get("number") or ""
        ch = chapters.get(num)
        if ch:
            chapters_html += _render_chapter(ch)

    # Cover
    cover = f'''
<div class="cover">
  <h1>Livret comptable {metadata.get("year")}</h1>
  <div class="meta">Instantané du {_format_date_fr(snapshot_date)} {badge_html} · YTD au {_format_date_fr(metadata.get("as_of_date") or "")}</div>
  <div class="frozen-tag">🔒 Document figé — non éditable</div>
  {comment_html}
</div>
'''

    livret_json = json.dumps(livret_dict, ensure_ascii=False, default=str)
    livret_json_safe = livret_json.replace("</", "<\\/")  # évite la fermeture script

    generated_at = datetime.now().isoformat(timespec="seconds")

    html = f'''<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Livret comptable {metadata.get("year")} — Instantané {snapshot_date}</title>
<meta name="generator" content="NeuronXcompta · Livret Phase 3">
<meta name="snapshot-id" content="{_esc(snapshot_id)}">
<meta name="snapshot-type" content="{_esc(snapshot_type.value)}">
<meta name="generated-at" content="{generated_at}">
<style>{_INLINE_CSS}</style>
</head>
<body>
<div class="container">
{cover}
{toolbar}
{toc_block}
{chapters_html}
<footer style="margin-top:48px; padding-top:24px; border-top:1px solid var(--border); color:var(--text-muted); font-size:11px; text-align:center;">
  Livret comptable · Snapshot {_esc(snapshot_id)} · Généré le {_format_date_fr(generated_at[:10])} à {generated_at[11:16]}<br>
  © NeuronXcompta — document statique et autonome
</footer>
</div>
<script>window.LIVRET_DATA = {livret_json_safe};</script>
<script>{_INLINE_JS}</script>
</body>
</html>
'''

    return html.encode("utf-8")
