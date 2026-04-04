import { useMemo } from 'react'
import { TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react'
import {
  ComposedChart, Line, Area, Bar, BarChart,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { useHistoriqueBNC, usePrevisionsBNC } from '@/hooks/useSimulation'
import { formatCurrency, MOIS_FR } from '@/lib/utils'

const MOIS_COURT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

interface Props {
  year: number
}

export default function SimulationPrevisionsSection({ year }: Props) {
  const { data: historique, isLoading: histLoading } = useHistoriqueBNC()
  const { data: previsions, isLoading: prevLoading } = usePrevisionsBNC(12, 'saisonnier')

  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1

  // BNC estimé année en cours
  const bncCurrentYear = useMemo(() => {
    if (!historique) return 0
    const yearData = historique.annual.find((a) => a.year === currentYear)
    return yearData?.bnc ?? 0
  }, [historique, currentYear])

  // Chart data: combine historique + prévisions
  const chartData = useMemo(() => {
    if (!historique) return []

    const data: Array<{
      label: string; bnc_reel?: number; bnc_prevu?: number; isFuture: boolean
    }> = []

    // 24 derniers mois de données réelles
    const recent = historique.monthly.slice(-24)
    for (const m of recent) {
      data.push({
        label: `${MOIS_COURT[m.month - 1]} ${String(m.year).slice(2)}`,
        bnc_reel: m.bnc,
        isFuture: false,
      })
    }

    // Prévisions
    if (previsions) {
      for (const p of previsions.previsions) {
        data.push({
          label: `${MOIS_COURT[p.month - 1]} ${String(p.year).slice(2)}`,
          bnc_prevu: p.bnc_prevu,
          isFuture: true,
        })
      }
    }

    return data
  }, [historique, previsions])

  // Index de séparation passé/futur
  const separationIndex = useMemo(() => {
    if (!historique) return 0
    return historique.monthly.slice(-24).length
  }, [historique])

  if (histLoading || prevLoading) return <LoadingSpinner text="Chargement des données historiques..." />

  if (!historique) return <p className="text-text-muted">Aucune donnée historique disponible.</p>

  const confianceColor = previsions?.previsions[0]?.confiance === 'haute'
    ? 'text-green-500'
    : previsions?.previsions[0]?.confiance === 'moyenne'
      ? 'text-amber-500'
      : 'text-red-500'

  const confianceBg = previsions?.previsions[0]?.confiance === 'haute'
    ? 'bg-green-500/10'
    : previsions?.previsions[0]?.confiance === 'moyenne'
      ? 'bg-amber-500/10'
      : 'bg-red-500/10'

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          title={`BNC estimé ${currentYear}`}
          value={formatCurrency(bncCurrentYear)}
        />
        <MetricCard
          title={`BNC projeté ${currentYear + 1}`}
          value={formatCurrency(previsions?.bnc_annuel_prevu ?? 0)}
        />
        <MetricCard
          title="Tendance annuelle"
          value={`${previsions?.tendance_annuelle_pct ?? 0}%`}
          icon={(previsions?.tendance_annuelle_pct ?? 0) >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
          trend={(previsions?.tendance_annuelle_pct ?? 0) >= 0 ? 'up' : 'down'}
        />
        <MetricCard
          title="Confiance"
          value={previsions?.previsions[0]?.confiance ?? 'N/A'}
          className={confianceBg}
        />
      </div>

      {/* Warning données insuffisantes */}
      {previsions?.avertissement && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <span className="text-sm text-amber-700">{previsions.avertissement}</span>
        </div>
      )}

      {/* Graphique principal */}
      {chartData.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-6">
          <h3 className="font-semibold mb-4">Évolution et projections BNC</h3>
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={chartData}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Legend />
              {separationIndex > 0 && (
                <ReferenceLine
                  x={chartData[separationIndex - 1]?.label}
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  label={{ value: 'Aujourd\'hui', position: 'top', fontSize: 11 }}
                />
              )}
              <Line
                type="monotone" dataKey="bnc_reel" name="BNC réel"
                stroke="var(--color-primary)" strokeWidth={2} dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone" dataKey="bnc_prevu" name="BNC projeté"
                stroke="var(--color-primary)" strokeWidth={2} strokeDasharray="5 5"
                dot={false} opacity={0.5}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Profil saisonnier */}
      {historique.profil_saisonnier.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-6">
          <h3 className="font-semibold mb-4">Profil saisonnier</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={historique.profil_saisonnier.map((p) => ({
              ...p,
              label: MOIS_COURT[p.month - 1],
              fill: p.coeff < 0.8 ? '#ef4444' : p.coeff > 1.1 ? '#22c55e' : '#6b7280',
            }))}>
              <XAxis dataKey="label" />
              <YAxis domain={[0, 'auto']} />
              <Tooltip formatter={(v: number) => `Coeff: ${v.toFixed(2)}`} />
              <Bar dataKey="coeff" name="Coefficient saisonnier" radius={[4, 4, 0, 0]}>
                {historique.profil_saisonnier.map((p, i) => (
                  <rect
                    key={i}
                    fill={p.coeff < 0.8 ? '#ef4444' : p.coeff > 1.1 ? '#22c55e' : '#6b7280'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tableau historique annuel */}
      {historique.annual.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-6">
          <h3 className="font-semibold mb-4">Historique annuel</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="text-left py-2 font-medium">Année</th>
                  <th className="text-right py-2 font-medium">Recettes</th>
                  <th className="text-right py-2 font-medium">Dépenses</th>
                  <th className="text-right py-2 font-medium">BNC</th>
                  <th className="text-right py-2 font-medium">Mois</th>
                  <th className="text-right py-2 font-medium">Évolution</th>
                </tr>
              </thead>
              <tbody>
                {historique.annual.map((a, i) => {
                  const prev = i > 0 ? historique.annual[i - 1] : null
                  const evolution = prev && prev.bnc !== 0
                    ? ((a.bnc - prev.bnc) / Math.abs(prev.bnc)) * 100
                    : null
                  return (
                    <tr key={a.year} className="border-b border-border/50">
                      <td className="py-2 font-medium">{a.year}</td>
                      <td className="py-2 text-right font-mono">{formatCurrency(a.recettes)}</td>
                      <td className="py-2 text-right font-mono">{formatCurrency(a.depenses)}</td>
                      <td className="py-2 text-right font-mono font-medium">{formatCurrency(a.bnc)}</td>
                      <td className="py-2 text-right">{a.nb_mois}</td>
                      <td className="py-2 text-right">
                        {evolution !== null && (
                          <span className={`text-xs px-2 py-0.5 rounded ${evolution >= 0 ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                            {evolution >= 0 ? '+' : ''}{evolution.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
