import { useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'
import type { TimelineMois } from '@/types'

interface Props {
  mois: TimelineMois[]
  showCumul: boolean
  selectedMonth: number | null
  onSelectMonth: (m: number | null) => void
}

export default function TimelineChart({ mois, showCumul, selectedMonth, onSelectMonth }: Props) {
  const data = useMemo(() =>
    mois.map((m) => ({
      label: m.label.slice(0, 3),
      mois: m.mois,
      recettes_total: m.recettes_total,
      charges_neg: -m.charges_total,
      solde: m.solde,
      solde_cumule: m.solde_cumule,
      statut_mois: m.statut_mois,
    })),
    [mois],
  )

  const handleClick = (entry: { mois?: number }) => {
    if (entry?.mois) {
      onSelectMonth(selectedMonth === entry.mois ? null : entry.mois)
    }
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
        <XAxis dataKey="label" tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} />
        <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
        <Tooltip
          contentStyle={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value: number, name: string) => [
            formatCurrency(Math.abs(value)),
            name === 'charges_neg' ? 'Charges' : name === 'recettes_total' ? 'Recettes' : name === 'solde_cumule' ? 'Trésorerie cumulée' : 'Solde',
          ]}
        />
        <ReferenceLine y={0} stroke="var(--color-border)" strokeWidth={1} />

        {/* Recettes (positive) */}
        <Bar dataKey="recettes_total" stackId="a" radius={[4, 4, 0, 0]} onClick={handleClick} cursor="pointer">
          {data.map((d, i) => (
            <Cell
              key={i}
              fill="var(--color-success)"
              fillOpacity={d.statut_mois === 'futur' ? 0.35 : 0.85}
              stroke={d.mois === selectedMonth ? '#fff' : 'transparent'}
              strokeWidth={d.mois === selectedMonth ? 2 : 0}
            />
          ))}
        </Bar>

        {/* Charges (negative) */}
        <Bar dataKey="charges_neg" stackId="a" radius={[0, 0, 4, 4]} onClick={handleClick} cursor="pointer">
          {data.map((d, i) => (
            <Cell
              key={i}
              fill="var(--color-danger)"
              fillOpacity={d.statut_mois === 'futur' ? 0.35 : 0.85}
              stroke={d.mois === selectedMonth ? '#fff' : 'transparent'}
              strokeWidth={d.mois === selectedMonth ? 2 : 0}
            />
          ))}
        </Bar>

        {/* Courbe trésorerie cumulée */}
        {showCumul && (
          <Line
            type="monotone"
            dataKey="solde_cumule"
            stroke="var(--color-primary)"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
