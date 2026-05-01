/**
 * Phase 5 — dispatcher chart Livret.
 *
 * Choisit le sous-composant Recharts selon `config.type`. Wraps le titre/sous-titre
 * et le ResponsiveContainer commun.
 */
import type { ChartConfig } from '@/types/livret'

import LivretChartDonut from './LivretChartDonut'
import LivretChartWaterfall from './LivretChartWaterfall'

interface Props {
  config: ChartConfig
  year?: number
  /** Optionnel — utilisé pour le drill-down (ex: "03"). */
  chapterNumber?: string
}

export default function LivretChart({ config, year, chapterNumber }: Props) {
  return (
    <figure className="rounded-xl border border-border bg-surface-hover/30 p-4 my-3">
      <figcaption className="mb-3">
        <h3 className="text-sm font-semibold text-text">{config.title}</h3>
        {config.subtitle && (
          <p className="text-xs text-text-muted mt-0.5">{config.subtitle}</p>
        )}
      </figcaption>
      <div className="w-full">
        {config.type === 'donut' ? (
          <LivretChartDonut config={config} year={year} chapterNumber={chapterNumber} />
        ) : config.type === 'waterfall' ? (
          <LivretChartWaterfall config={config} />
        ) : (
          <div className="text-text-muted italic text-xs px-4 py-6 text-center">
            Type de graphique non supporté ({config.type}) côté UI.
          </div>
        )}
      </div>
    </figure>
  )
}
