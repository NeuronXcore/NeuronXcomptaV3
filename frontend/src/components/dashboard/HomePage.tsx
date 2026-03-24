import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  TrendingDown,
  FileText,
  Clock,
  Brain,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  GitCompareArrows,
  Sparkles,
} from 'lucide-react'
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import CalendrierAnnuel from '@/components/dashboard/CalendrierAnnuel'
import ModaleMois from '@/components/dashboard/ModaleMois'
import ModaleGraph from '@/components/dashboard/ModaleGraph'
import { useHomeDashboard } from '@/hooks/useHomeDashboard'
import { cn, formatCurrency } from '@/lib/utils'
import type { MonthStatus, TrendRecord, CategorySummary } from '@/types'

const MOIS_COURTS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
const PIE_COLORS = ['#811971', '#a94199', '#3b82f6', '#22c55e', '#f59e0b']

/** Aggregate trend records (per-category) into monthly totals */
function aggregateTrends(trends: TrendRecord[]) {
  const byMonth = new Map<string, { month: string; debit: number; credit: number }>()
  for (const t of trends) {
    const existing = byMonth.get(t.Mois)
    if (existing) {
      existing.debit += t['Débit']
      existing.credit += t['Crédit']
    } else {
      byMonth.set(t.Mois, { month: t.Mois, debit: t['Débit'], credit: t['Crédit'] })
    }
  }
  return Array.from(byMonth.values())
}

/** Get top 5 categories by Débit */
function getTopCategories(summary: CategorySummary[]) {
  return [...summary]
    .sort((a, b) => b['Débit'] - a['Débit'])
    .slice(0, 5)
    .map((c) => ({ name: c['Catégorie'], value: c['Débit'] }))
}

export default function HomePage() {
  const navigate = useNavigate()
  const {
    dashboard,
    trends,
    summary,
    anomalies,
    justifStats,
    mlModel,
    cloture,
    availableYears,
    selectedYear,
    setSelectedYear,
    isLoading,
    isClotureLoading,
  } = useHomeDashboard()

  const [selectedMonth, setSelectedMonth] = useState<MonthStatus | null>(null)
  const [showEvolutionModal, setShowEvolutionModal] = useState(false)
  const [showCategoriesModal, setShowCategoriesModal] = useState(false)
  const [showSoldeNet, setShowSoldeNet] = useState(false)

  if (isLoading && !dashboard) {
    return <LoadingSpinner text="Chargement du tableau de bord..." />
  }

  const solde = dashboard?.solde ?? 0
  const nbOps = dashboard?.nb_operations ?? 0
  const enAttente = justifStats?.en_attente ?? 0
  const accuracy = mlModel?.stats?.success_rate ?? 0

  const monthlyData = trends ? aggregateTrends(trends) : []
  const topCats = summary ? getTopCategories(summary) : []
  const allCats = summary
    ? [...summary].sort((a, b) => b['Débit'] - a['Débit']).map((c) => ({
        name: c['Catégorie'],
        debit: c['Débit'],
        credit: c['Crédit'],
      }))
    : []

  // Rapprochement: average taux_lettrage for months with relevé
  const moisAvecReleve = (cloture ?? []).filter((m) => m.has_releve)
  const tauxRapprochement =
    moisAvecReleve.length > 0
      ? Math.round(
          (moisAvecReleve.reduce((sum, m) => sum + m.taux_lettrage, 0) / moisAvecReleve.length) * 100
        )
      : 0

  // Build actions requises
  const actions: { icon: React.ReactNode; text: string; route: string; severity: 'danger' | 'warning' | 'info' }[] = []

  const moisSansLettrage = moisAvecReleve.filter((m) => m.taux_lettrage === 0).length
  if (moisSansLettrage > 0) {
    actions.push({
      icon: <GitCompareArrows size={14} />,
      text: `${moisSansLettrage} mois sans rapprochement`,
      route: '/rapprochement',
      severity: 'warning',
    })
  }

  const nbAnomalies = anomalies?.length ?? 0
  if (nbAnomalies > 0) {
    actions.push({
      icon: <AlertTriangle size={14} />,
      text: `${nbAnomalies} anomalie${nbAnomalies > 1 ? 's' : ''} détectée${nbAnomalies > 1 ? 's' : ''}`,
      route: '/visualization',
      severity: nbAnomalies > 10 ? 'danger' : 'warning',
    })
  }

  if (enAttente > 0) {
    actions.push({
      icon: <Clock size={14} />,
      text: `${enAttente} justificatif${enAttente > 1 ? 's' : ''} en attente`,
      route: '/justificatifs',
      severity: 'info',
    })
  }

  if (accuracy === 0) {
    actions.push({
      icon: <Sparkles size={14} />,
      text: 'Modèle IA non entraîné',
      route: '/agent-ai',
      severity: 'info',
    })
  }

  const severityStyles = {
    danger: 'bg-red-500/10 border-red-500/30 text-red-400',
    warning: 'bg-orange-500/10 border-orange-500/30 text-orange-400',
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
  }

  return (
    <div>
      <PageHeader title="Tableau de bord" description="Pilotage comptable" />

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="relative">
          <MetricCard
            title="Solde YTD"
            value={formatCurrency(solde)}
            icon={solde >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
            trend={solde >= 0 ? 'up' : 'down'}
            onClick={() => setShowEvolutionModal(true)}
          />
        </div>

        <MetricCard
          title="Opérations"
          value={String(nbOps)}
          icon={<FileText size={20} />}
          onClick={() => navigate('/editor')}
        />

        <div className="relative">
          <MetricCard
            title="Justificatifs en attente"
            value={String(enAttente)}
            icon={<Clock size={20} />}
            onClick={() => navigate('/justificatifs')}
          />
          {enAttente > 0 && (
            <span className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-danger" />
          )}
        </div>

        <div className="relative">
          <MetricCard
            title="Précision IA"
            value={`${Math.round(accuracy * 100)}%`}
            icon={<Brain size={20} />}
            onClick={() => navigate('/agent-ai')}
          />
          {accuracy < 0.7 && (
            <span className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-warning" />
          )}
        </div>
      </div>

      {/* Actions requises */}
      {actions.length > 0 && (
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={() => navigate(action.route)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all hover:scale-105',
                severityStyles[action.severity],
              )}
            >
              {action.icon}
              {action.text}
              <ArrowRight size={10} className="ml-0.5 opacity-60" />
            </button>
          ))}
        </div>
      )}

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left — Calendar */}
        <div className="lg:col-span-7">
          <CalendrierAnnuel
            cloture={cloture ?? []}
            selectedYear={selectedYear}
            availableYears={availableYears}
            onYearChange={setSelectedYear}
            onSelectMonth={setSelectedMonth}
            isLoading={isClotureLoading}
          />
        </div>

        {/* Right — Charts */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card A — Évolution mensuelle */}
          <div className="bg-surface rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text">Évolution mensuelle</h3>
              <button
                onClick={() => setShowEvolutionModal(true)}
                className="text-text-muted hover:text-primary transition-colors"
              >
                <ExternalLink size={16} />
              </button>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={monthlyData}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  tickFormatter={(v: string) => {
                    const parts = v.split('-')
                    const m = parseInt(parts[1], 10)
                    return MOIS_COURTS[m - 1] ?? v
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                  }}
                  formatter={(val: number) => formatCurrency(val)}
                />
                <Line type="monotone" dataKey="debit" stroke="#ef4444" strokeWidth={2} dot={false} name="Débits" />
                <Line type="monotone" dataKey="credit" stroke="#22c55e" strokeWidth={2} dot={false} name="Crédits" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Card B — Répartition catégories */}
          <div className="bg-surface rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text">Répartition catégories</h3>
              <button
                onClick={() => setShowCategoriesModal(true)}
                className="text-text-muted hover:text-primary transition-colors"
              >
                <ExternalLink size={16} />
              </button>
            </div>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie
                    data={topCats}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {topCats.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: number) => formatCurrency(val)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {topCats.map((cat, i) => (
                  <div key={cat.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <span className="text-text-muted truncate flex-1">{cat.name}</span>
                    <span className="text-text font-medium">{formatCurrency(cat.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Card C — Rapprochement & Anomalies */}
          <div className="bg-surface rounded-xl border border-border p-5">
            {/* Rapprochement */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-text mb-3">Rapprochement</h3>
              <div className="mb-2">
                <div className="h-2.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400 rounded-full transition-all"
                    style={{ width: `${tauxRapprochement}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{tauxRapprochement}% des opérations lettrées</span>
                <button
                  onClick={() => navigate('/rapprochement')}
                  className="text-xs text-primary hover:text-primary-light transition-colors"
                >
                  → Rapprochement
                </button>
              </div>
            </div>

            <div className="border-t border-border my-4" />

            {/* Anomalies */}
            <div>
              <h3 className="text-sm font-semibold text-text mb-3">Anomalies</h3>
              {!anomalies || anomalies.length === 0 ? (
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-500/20 text-green-400">
                  <CheckCircle size={12} />
                  Aucune anomalie
                </span>
              ) : (
                <div>
                  <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 mb-3">
                    <AlertTriangle size={12} />
                    ⚠ {anomalies.length} anomalie{anomalies.length > 1 ? 's' : ''}
                  </span>
                  <div className="space-y-1.5 mt-2">
                    {anomalies.slice(0, 3).map((a, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-text-muted truncate max-w-[200px]">
                          {a['Libellé'].slice(0, 30)}
                        </span>
                        <span className="text-danger font-medium">{formatCurrency(a['Débit'])}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => navigate('/visualization')}
                    className="text-xs text-primary hover:text-primary-light transition-colors mt-2"
                  >
                    → Voir toutes
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modale Mois */}
      {selectedMonth && (
        <ModaleMois mois={selectedMonth} year={selectedYear} onClose={() => setSelectedMonth(null)} />
      )}

      {/* Modale Évolution */}
      {showEvolutionModal && (
        <ModaleGraph
          title="Évolution mensuelle"
          linkLabel="Voir l'analytique complète"
          linkTo="/visualization"
          onClose={() => setShowEvolutionModal(false)}
        >
          <div className="mb-3">
            <label className="inline-flex items-center gap-2 text-sm text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={showSoldeNet}
                onChange={(e) => setShowSoldeNet(e.target.checked)}
                className="rounded border-border"
              />
              Afficher le solde net
            </label>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthlyData.map((d) => ({ ...d, solde: d.credit - d.debit }))}>
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                tickFormatter={(v: string) => {
                  const parts = v.split('-')
                  const m = parseInt(parts[1], 10)
                  return MOIS_COURTS[m - 1] ?? v
                }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                }}
                formatter={(val: number) => formatCurrency(val)}
              />
              <Legend />
              <Line type="monotone" dataKey="debit" stroke="#ef4444" strokeWidth={2} dot={false} name="Débits" />
              <Line type="monotone" dataKey="credit" stroke="#22c55e" strokeWidth={2} dot={false} name="Crédits" />
              {showSoldeNet && (
                <Line type="monotone" dataKey="solde" stroke="#a78bfa" strokeWidth={2} dot={false} name="Solde net" />
              )}
            </LineChart>
          </ResponsiveContainer>
        </ModaleGraph>
      )}

      {/* Modale Catégories */}
      {showCategoriesModal && (
        <ModaleGraph
          title="Répartition par catégorie"
          linkLabel="Générer un rapport"
          linkTo="/reports"
          onClose={() => setShowCategoriesModal(false)}
        >
          <ResponsiveContainer width="100%" height={Math.max(320, allCats.length * 32)}>
            <BarChart data={allCats} layout="vertical" margin={{ left: 120 }}>
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => formatCurrency(v)}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                axisLine={false}
                tickLine={false}
                width={110}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                }}
                formatter={(val: number) => formatCurrency(val)}
              />
              <Bar dataKey="debit" fill="#ef4444" name="Débits" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ModaleGraph>
      )}
    </div>
  )
}
