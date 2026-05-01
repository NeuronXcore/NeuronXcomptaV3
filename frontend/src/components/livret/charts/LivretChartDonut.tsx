/**
 * Phase 5 — Donut Recharts avec drill-down vers `CategoryDetailDrawer`.
 *
 * Pattern miroir de [HomePage.tsx:298-312](frontend/src/components/dashboard/HomePage.tsx) :
 * `PieChart` avec `innerRadius=60 outerRadius=100`. Clic sur slice → ouvre le
 * drawer de détail catégorie en passant le `category_name` du `meta` du point.
 */
import { useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import CategoryDetailDrawer from '@/components/compta-analytique/CategoryDetailDrawer'
import type { ChartConfig } from '@/types/livret'
import { formatCurrency } from '@/lib/utils'

interface Props {
  config: ChartConfig
  year?: number
  /** Réservé pour usage futur (filtrage par chapitre / breadcrumb). */
  chapterNumber?: string
}

export default function LivretChartDonut({ config, year }: Props) {
  const [drillCategory, setDrillCategory] = useState<string | null>(null)

  const series = config.series[0]
  if (!series || !series.data.length) return null

  const total = series.data.reduce((sum, p) => sum + p.y, 0)
  const data = series.data.map((p) => ({
    name: String(p.x),
    value: p.y,
    color: p.color || series.color,
    pct: total > 0 ? (p.y / total) * 100 : 0,
    meta: p.meta || {},
  }))

  const handleSliceClick = (slice: typeof data[0]) => {
    if (!config.drill_target) return
    const meta = slice.meta as Record<string, unknown>
    if (meta.is_autres_aggregate) return // pas de drill sur "Autres"
    const categoryName = (meta.category_name as string) || slice.name
    if (categoryName) setDrillCategory(categoryName)
  }

  return (
    <>
      <div className="flex items-center gap-4">
        <div className="w-[260px] h-[240px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={1}
                onClick={(_, idx) => handleSliceClick(data[idx])}
                style={{ cursor: config.drill_target ? 'pointer' : 'default' }}
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={d.color} stroke="var(--color-background)" strokeWidth={1.5} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  color: 'var(--color-text)',
                  fontSize: 12,
                }}
                formatter={(value: number, _name, item) => {
                  const pct = (item?.payload?.pct ?? 0).toFixed(1)
                  return [`${formatCurrency(value)} · ${pct} %`, item?.payload?.name]
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Légende custom à droite — interactive (pas Recharts <Legend>) */}
        <div className="flex-1 min-w-0 space-y-1">
          {data.map((d, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSliceClick(d)}
              disabled={!config.drill_target || (d.meta as Record<string, unknown>).is_autres_aggregate === true}
              className={
                'w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md text-xs transition-colors ' +
                (config.drill_target && !(d.meta as Record<string, unknown>).is_autres_aggregate
                  ? 'hover:bg-surface-hover cursor-pointer'
                  : 'cursor-default')
              }
              title={
                config.drill_target && !(d.meta as Record<string, unknown>).is_autres_aggregate
                  ? `Détail catégorie ${d.name}`
                  : undefined
              }
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ background: d.color }}
                />
                <span className="truncate text-text">{d.name}</span>
              </span>
              <span className="text-text-muted tabular-nums shrink-0">
                {formatCurrency(d.value)}
                <span className="text-text-muted/60 ml-1.5">{d.pct.toFixed(1)} %</span>
              </span>
            </button>
          ))}
          {config.total !== null && config.total !== undefined && (
            <div className="pt-2 mt-2 border-t border-border flex items-center justify-between text-xs px-2">
              <span className="text-text-muted uppercase tracking-wider">Total</span>
              <span className="text-text font-bold tabular-nums">{formatCurrency(config.total)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Drill-down drawer (réutilisé depuis Compta Analytique) */}
      <CategoryDetailDrawer
        isOpen={drillCategory !== null}
        onClose={() => setDrillCategory(null)}
        category={drillCategory}
        year={year ?? null}
        quarter={null}
        month={null}
      />
    </>
  )
}
