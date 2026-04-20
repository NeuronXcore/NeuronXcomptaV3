import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { MoisOverview } from '@/types'

interface RevenueChartProps {
  mois: MoisOverview[]
  /** CA liasse annuel — si fourni, affiche une ligne horizontale pointillée à ca_liasse/12 (moyenne mensuelle cible) */
  caLiasse?: number | null
}

export default function RevenueChart({ mois, caLiasse }: RevenueChartProps) {
  const data = mois
    .filter(m => m.total_credit > 0 || m.total_debit > 0)
    .map(m => ({
      name: m.label.substring(0, 3),
      recettes: Math.round(m.total_credit),
      depenses: Math.round(m.total_debit),
    }))

  if (data.length === 0) return null

  const formatYAxis = (v: number) => {
    if (v >= 1000) return `${Math.round(v / 1000)}k`
    return String(v)
  }

  const caMonthly = caLiasse ? Math.round(caLiasse / 12) : null

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-text mb-3">Recettes vs Dépenses</h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} barGap={2}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatYAxis}
            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              fontSize: '11px',
              color: 'var(--color-text)',
            }}
            formatter={(value: number) => [`${value.toLocaleString('fr-FR')} €`, '']}
          />
          <Bar dataKey="recettes" fill="#1D9E75" radius={[3, 3, 0, 0]} name="Recettes" />
          <Bar dataKey="depenses" fill="#E24B4A" radius={[3, 3, 0, 0]} name="Dépenses" />
          {caMonthly !== null && (
            <ReferenceLine
              y={caMonthly}
              stroke="#7F77DD"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{
                value: `CA liasse ÷ 12 : ${caMonthly.toLocaleString('fr-FR')} €`,
                position: 'insideTopRight',
                fill: '#7F77DD',
                fontSize: 9,
              }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
      {/* Custom legend */}
      <div className="flex items-center justify-center gap-4 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-[#1D9E75]" />
          <span className="text-[10px] text-text-muted">Recettes</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-[#E24B4A]" />
          <span className="text-[10px] text-text-muted">Dépenses</span>
        </div>
        {caMonthly !== null && (
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0 border-t-2 border-dashed border-[#7F77DD]" />
            <span className="text-[10px] text-text-muted">CA liasse ÷ 12 · moyenne mensuelle</span>
          </div>
        )}
      </div>
    </div>
  )
}
