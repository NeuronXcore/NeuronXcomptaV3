/**
 * Cadence mensuelle 12 mois — barres recettes (vertes) + charges (rouges).
 * Mois passés en plein, mois courant marqué d'un point pulsant, futurs en pointillés (style projeté).
 *
 * Recharts BarChart avec deux barres par mois. Les barres futures sont indiquées via
 * un pattern visuel (opacité réduite + bordure pointillée) côté Cell.
 */
import {
  Bar,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useLivretStore } from '@/stores/useLivretStore'
import type { LivretMonthPoint } from '@/types/livret'
import { formatCurrency } from '@/lib/utils'

interface Props {
  cadence: LivretMonthPoint[]
}

export default function LivretCadenceMensuelle({ cadence }: Props) {
  const showN1 = useLivretStore((s) => s.showN1OnCadence)
  const compareMode = useLivretStore((s) => s.compareMode)

  if (!cadence.length) {
    return (
      <div className="text-sm text-text-muted italic px-4 py-8 text-center">
        Cadence indisponible.
      </div>
    )
  }

  // Affiche la ligne N-1 ssi : showN1 ON + compareMode actif + au moins un point a recettes_n1
  const hasN1Data = cadence.some(
    (m) => m.recettes_n1 !== null && m.recettes_n1 !== undefined,
  )
  const overlayN1 = showN1 && compareMode !== 'none' && hasN1Data

  const data = cadence.map((m) => {
    const recettes_n1 = m.recettes_n1 ?? null
    const charges_n1 = m.charges_n1 ?? null
    const solde_n1 =
      recettes_n1 !== null && charges_n1 !== null ? recettes_n1 - charges_n1 : null
    return {
      month: m.label,
      recettes: m.recettes,
      charges: m.charges,
      is_past: m.is_past,
      is_current: m.is_current,
      is_projection: m.is_projection,
      recettes_n1,
      charges_n1,
      solde_n1,
    }
  })

  // Index du mois courant pour ReferenceLine
  const currentIdx = cadence.findIndex((m) => m.is_current)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Cadence mensuelle</h3>
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-success" /> Recettes
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-danger" /> Charges
          </span>
          <span className="inline-flex items-center gap-1.5 italic">
            <span className="w-2.5 h-2.5 rounded-sm bg-success opacity-40 border border-dashed border-success" />
            Projeté
          </span>
          {overlayN1 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-text-muted border-t border-dashed border-text-muted" />
              Solde N-1
            </span>
          )}
        </div>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="month"
              tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
              stroke="var(--color-border)"
            />
            <YAxis
              tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
              stroke="var(--color-border)"
              tickFormatter={(v) =>
                Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} k` : String(v)
              }
            />
            <Tooltip
              cursor={{ fill: 'var(--color-surface-hover)', opacity: 0.5 }}
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                color: 'var(--color-text)',
              }}
              formatter={(v: number, name: string) => {
                const labels: Record<string, string> = {
                  recettes: 'Recettes',
                  charges: 'Charges',
                  solde_n1: 'Solde N-1',
                }
                return [formatCurrency(Number(v)), labels[name] ?? name]
              }}
              labelFormatter={(label, payload) => {
                const item = payload?.[0]?.payload as
                  | { is_projection?: boolean; is_current?: boolean; recettes?: number; charges?: number; recettes_n1?: number | null; charges_n1?: number | null }
                  | undefined
                let suffix = ''
                if (item?.is_current) suffix = ' (mois courant)'
                else if (item?.is_projection) suffix = ' (projeté)'

                // Tooltip enrichi avec valeurs N-1 + diff
                if (overlayN1 && item) {
                  const solde_n = (item.recettes ?? 0) - (item.charges ?? 0)
                  const r1 = item.recettes_n1
                  const c1 = item.charges_n1
                  if (r1 !== null && r1 !== undefined && c1 !== null && c1 !== undefined) {
                    const solde_n1 = r1 - c1
                    const diff = solde_n - solde_n1
                    const sign = diff > 0 ? '+' : ''
                    const pct = solde_n1 !== 0
                      ? `${sign}${((diff / Math.abs(solde_n1)) * 100).toFixed(1)} %`
                      : '—'
                    return `${label}${suffix} · vs N-1 ${pct}`
                  }
                }
                return `${label}${suffix}`
              }}
            />
            <Legend wrapperStyle={{ display: 'none' }} />

            {currentIdx >= 0 && (
              <ReferenceLine
                x={data[currentIdx].month}
                stroke="var(--color-primary)"
                strokeDasharray="4 4"
                label={{
                  value: 'aujourd’hui',
                  position: 'top',
                  fill: 'var(--color-primary)',
                  fontSize: 10,
                }}
              />
            )}

            <Bar dataKey="recettes" name="Recettes" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={`r-${i}`}
                  fill="var(--color-success)"
                  fillOpacity={d.is_projection ? 0.45 : 1}
                  stroke={d.is_projection ? 'var(--color-success)' : undefined}
                  strokeDasharray={d.is_projection ? '3 2' : undefined}
                />
              ))}
            </Bar>
            <Bar dataKey="charges" name="Charges" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={`c-${i}`}
                  fill="var(--color-danger)"
                  fillOpacity={d.is_projection ? 0.45 : 1}
                  stroke={d.is_projection ? 'var(--color-danger)' : undefined}
                  strokeDasharray={d.is_projection ? '3 2' : undefined}
                />
              ))}
            </Bar>

            {/* Phase 4 — overlay solde N-1 si toggle activé */}
            {overlayN1 && (
              <Line
                type="monotone"
                dataKey="solde_n1"
                name="Solde N-1"
                stroke="var(--color-text-muted)"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                dot={{ r: 2, fill: 'var(--color-text-muted)' }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}

            {/* Phase 5 — Brush pour zoomer sur une plage de mois (drag = sélection) */}
            <Brush
              dataKey="month"
              height={20}
              stroke="var(--color-primary)"
              fill="var(--color-surface-hover)"
              travellerWidth={8}
              tickFormatter={(v) => String(v)}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
