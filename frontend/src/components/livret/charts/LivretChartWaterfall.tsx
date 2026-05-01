/**
 * Phase 5 — Waterfall Recharts.
 *
 * Technique standard waterfall avec Recharts :
 *   - On reconstruit côté client le tableau (start, height) cumulatif.
 *   - Une `Bar dataKey="invisible"` transparente cale chaque barre à sa cumulée.
 *   - Une `Bar dataKey="visible"` colorée par opérateur dessine la valeur.
 *   - Connecteurs pointillés via `<ReferenceLine>` ou un overlay (skip pour MVP).
 */
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { ChartConfig } from '@/types/livret'
import { formatCurrency } from '@/lib/utils'

interface Props {
  config: ChartConfig
}

export default function LivretChartWaterfall({ config }: Props) {
  const series = config.series[0]
  if (!series || !series.data.length) return null

  // Reconstruction cumulative (logique miroir backend `_pdf_waterfall`)
  let acc = 0
  const data = series.data.map((p) => {
    const op = ((p.meta || {}) as Record<string, unknown>).operator as string | undefined
    const value = Math.abs(p.y)
    let start = 0
    let end = 0
    if (op === 'plus') {
      start = acc
      end = acc + value
      acc += value
    } else if (op === 'minus') {
      start = acc - value
      end = acc
      acc -= value
    } else if (op === 'equals') {
      start = 0
      end = p.y
    } else {
      start = acc
      end = acc + value
      acc += value
    }
    return {
      name: String(p.x),
      label: String(p.x),
      operator: op || 'plus',
      // Bar transparente cale à `start`
      base: Math.min(start, end),
      // Bar visible affiche la hauteur
      height: Math.abs(end - start),
      // Pour le tooltip, on stocke aussi la valeur signée originale
      raw: p.y,
      color: p.color || series.color,
    }
  })

  const finalTotal = config.total ?? data[data.length - 1]?.height ?? 0

  const truncate = (s: string) => (s.length > 18 ? s.slice(0, 16) + '…' : s)

  return (
    <div className="w-full h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 24, right: 16, left: 8, bottom: 16 }}
          stackOffset="sign"
        >
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
            stroke="var(--color-border)"
            tickFormatter={truncate}
            interval={0}
          />
          <YAxis
            tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
            stroke="var(--color-border)"
            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} k` : String(v))}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              color: 'var(--color-text)',
              fontSize: 12,
            }}
            formatter={(_value: number, _name, item) => {
              const item_data = item?.payload as { raw?: number; operator?: string }
              const raw = item_data?.raw ?? 0
              const op_sym = item_data?.operator === 'plus'
                ? '+'
                : item_data?.operator === 'minus'
                  ? '−'
                  : '='
              return [`${op_sym} ${formatCurrency(Math.abs(raw))}`, item_data?.operator]
            }}
            labelFormatter={(label) => label as string}
          />
          {/* ReferenceLine au total final */}
          {config.total !== null && config.total !== undefined && (
            <ReferenceLine
              y={config.total}
              stroke="var(--color-primary)"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: `BNC = ${formatCurrency(config.total)}`,
                position: 'right',
                fill: 'var(--color-primary)',
                fontSize: 10,
              }}
            />
          )}

          {/* Bar invisible (calage cumulé) */}
          <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
          {/* Bar visible (couleur par opérateur) */}
          <Bar dataKey="height" stackId="wf" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {finalTotal !== null && finalTotal !== undefined && (
        <p className="text-[11px] text-text-muted text-right mt-1">
          Total cumulé : <span className="text-primary font-bold tabular-nums">{formatCurrency(finalTotal)}</span>
        </p>
      )}
    </div>
  )
}
