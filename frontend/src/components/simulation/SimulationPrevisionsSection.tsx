import { useMemo } from 'react'
import { TrendingUp, TrendingDown, AlertTriangle, Calculator } from 'lucide-react'
import {
  ComposedChart, Line, Area, Bar, BarChart,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { useHistoriqueBNC, usePrevisionsBNC, useUrssafProjection } from '@/hooks/useSimulation'
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

  // Projection cotisations URSSAF sur 5 années (N-2 à N+2 par défaut)
  const projectionStartYear = currentYear - 2
  const { data: urssafProjection } = useUrssafProjection(projectionStartYear, 5)

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
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
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
              <Tooltip formatter={(v) => `Coeff: ${Number(v).toFixed(2)}`} />
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

      {/* Projection cotisations URSSAF — anticipe acompte / régul / remboursement */}
      {urssafProjection && urssafProjection.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-6">
          <div className="flex items-center gap-2 mb-1">
            <Calculator size={16} className="text-sky-400" />
            <h3 className="font-semibold">Projection cotisations URSSAF</h3>
          </div>
          <p className="text-xs text-text-muted mb-4">
            Acompte = URSSAF dû sur BNC N-2 (base des prélèvements provisionnels). Régul = URSSAF dû sur BNC N − acompte versé. À payer en N+1.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="text-left py-2 font-medium">Année</th>
                  <th className="text-right py-2 font-medium">BNC</th>
                  <th className="text-right py-2 font-medium">URSSAF dû</th>
                  <th className="text-right py-2 font-medium">Acompte (sur N-2)</th>
                  <th className="text-right py-2 font-medium">Régul estimée</th>
                  <th className="text-center py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {urssafProjection.map((row) => {
                  const regulClass = row.signe === 'regul'
                    ? 'text-rose-400'
                    : row.signe === 'remboursement'
                      ? 'text-emerald-400'
                      : 'text-text-muted'
                  const statutBadge = row.statut === 'passe'
                    ? 'bg-text-muted/10 text-text-muted'
                    : row.statut === 'courant'
                      ? 'bg-primary/15 text-primary'
                      : 'bg-amber-500/15 text-amber-400'
                  const originBadge = row.bnc_origine === 'forecast'
                    ? <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 ml-1">forecast</span>
                    : null
                  return (
                    <tr key={row.year} className="border-b border-border/50">
                      <td className="py-2 font-medium">{row.year}</td>
                      <td className="py-2 text-right font-mono">
                        {row.bnc != null ? formatCurrency(row.bnc) : '—'}
                        {originBadge}
                      </td>
                      <td className="py-2 text-right font-mono">{formatCurrency(row.urssaf_du)}</td>
                      <td className="py-2 text-right font-mono text-text-muted">
                        {row.acompte_theorique > 0 ? formatCurrency(row.acompte_theorique) : '—'}
                      </td>
                      <td className={`py-2 text-right font-mono font-semibold ${regulClass}`}>
                        {/* Convention flux côté user : remboursement = +, régul = − */}
                        {row.signe === 'remboursement' && '+'}
                        {row.signe === 'regul' && '−'}
                        {formatCurrency(Math.abs(row.regul_estimee))}
                      </td>
                      <td className="py-2 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-medium ${statutBadge}`}>
                          {row.statut === 'passe' ? 'passé' : row.statut === 'courant' ? 'courant' : 'futur'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-text-muted/70 italic mt-3">
            Les années « forecast » utilisent la régression linéaire saisonnière de `forecast_bnc` — fiabilité limitée si l'historique est court.
          </p>
        </div>
      )}
    </div>
  )
}
