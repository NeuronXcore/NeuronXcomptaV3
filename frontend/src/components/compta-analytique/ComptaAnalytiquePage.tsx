import { useState, useMemo } from 'react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useDashboard, useAnalyticsTrends, useAnalyticsAnomalies, useOperationFiles } from '@/hooks/useApi'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import QueryDrawer from './QueryDrawer'
import CategoryDetailDrawer from './CategoryDetailDrawer'
import ComparatifSection from './ComparatifSection'
import BncBanner from './BncBanner'
import VentilationDepensesCard from './VentilationDepensesCard'
import NatureFilter, { type NatureFilter as NatureFilterValue } from './NatureFilter'
import { formatCurrency, cn, MOIS_FR } from '@/lib/utils'
import {
  TrendingDown, TrendingUp, Briefcase, Hash, Tags, Calculator, Wallet,
  AlertTriangle, CheckCircle, ArrowUpDown, Search,
  Filter, ChevronRight,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts'
import type { TrendRecord, CategorySummary, SourceBreakdown, BncMetrics, PersoMetrics } from '@/types'

const COLORS = [
  '#811971', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#14b8a6',
]

type Granularity = 'month' | 'quarter'
type EvolutionMode = 'aggregated' | 'category' | 'stacked'
type SortCol = 'Catégorie' | 'Débit' | 'Crédit' | 'Montant_Net' | 'Pourcentage_Dépenses' | 'Nombre_Opérations'
type SortDir = 'asc' | 'desc'

// Tooltip dark theme
const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: '12px',
  color: '#e2e8f0',
}

export default function ComptaAnalytiquePage() {
  // Page mode
  const [pageMode, setPageMode] = useState<'analyse' | 'comparatif'>('analyse')

  // Global period filters
  const { selectedYear: globalYear, setYear: setGlobalYear } = useFiscalYearStore()
  const [globalQuarter, setGlobalQuarter] = useState<number | null>(null)
  const [globalMonth, setGlobalMonth] = useState<number | null>(null)

  // Available years from operation files
  const { data: opFiles } = useOperationFiles()
  const availableYears = useMemo(() => {
    if (!opFiles) return []
    return [...new Set(opFiles.map(f => f.year).filter(Boolean))].sort((a, b) => (b ?? 0) - (a ?? 0)) as number[]
  }, [opFiles])

  // All hooks use the global period filters
  const { data: dashboard, isLoading: dashLoading, error: dashError } = useDashboard(globalYear, globalQuarter, globalMonth)
  const { data: trends, isLoading: trendsLoading } = useAnalyticsTrends(0, globalYear, globalQuarter, globalMonth)
  const [anomalyThreshold, setAnomalyThreshold] = useState(2.0)
  const { data: anomalies, isLoading: anomaliesLoading } = useAnalyticsAnomalies(anomalyThreshold, globalYear, globalQuarter, globalMonth)

  // Ventilation state
  const [sortCol, setSortCol] = useState<SortCol>('Débit')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Evolution state
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [evolutionMode, setEvolutionMode] = useState<EvolutionMode>('aggregated')

  // Nature filter (Pro / Perso / Tout) — pilote tableau catégories + graphes
  const [natureFilter, setNatureFilter] = useState<NatureFilterValue>('pro')

  // Drawers
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drillCategory, setDrillCategory] = useState<string | null>(null)

  // Trends : sélection de la série selon natureFilter
  const trendsSelected: TrendRecord[] = useMemo(() => {
    if (!trends) return []
    if (natureFilter === 'pro') return trends.trends_pro
    if (natureFilter === 'perso') return trends.trends_perso
    return trends.trends_all
  }, [trends, natureFilter])

  // Catégories filtrées par nature (tableau + donut) — safe si dashboard absent
  const filteredCategorySummary = useMemo(() => {
    const list = dashboard?.category_summary ?? []
    if (natureFilter === 'all') return list
    return list.filter((c) => c.nature === natureFilter)
  }, [dashboard?.category_summary, natureFilter])

  const periodLabel = useMemo(() => {
    if (globalMonth) return `${MOIS_FR[globalMonth - 1]} ${globalYear}`
    if (globalQuarter) return `T${globalQuarter} ${globalYear}`
    return `${globalYear}`
  }, [globalYear, globalQuarter, globalMonth])

  // Loading — MUST be after all hooks (Rules of Hooks)
  if (dashLoading || trendsLoading) return <LoadingSpinner text="Chargement des données analytiques..." />
  if (dashError) return <p className="text-danger p-8">Erreur: {dashError.message}</p>
  if (!dashboard) return null

  const { nb_operations, category_summary, by_source, bnc, perso, tresorerie } = dashboard

  // KPIs BNC (avec fallback sur champs plats si bnc absent — non-régression)
  const recettesPro = bnc?.recettes_pro ?? dashboard.total_credit
  const depensesTotales = (bnc?.charges_pro ?? 0) + (perso?.total_debit ?? 0) + (dashboard.attente?.total_debit ?? 0) || dashboard.total_debit
  const soldeBnc = bnc?.solde_bnc ?? (dashboard.total_credit - dashboard.total_debit)

  // Bandeau liasse — affiché uniquement en année complète (disabled si filtre mois/trimestre)
  const bandeauDisabled = globalQuarter !== null || globalMonth !== null

  return (
    <div>
      <PageHeader
        title="Compta Analytique"
        description="Analyse détaillée de vos finances par catégorie, période et tendances"
        actions={
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
          >
            <Search size={16} />
            Requêtes
          </button>
        }
      />

      {/* Mode toggle */}
      <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border mb-6 w-fit">
        <button
          onClick={() => setPageMode('analyse')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors',
            pageMode === 'analyse' ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
          )}
        >
          <Tags size={14} />
          Analyse
        </button>
        <button
          onClick={() => setPageMode('comparatif')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors',
            pageMode === 'comparatif' ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
          )}
        >
          <ArrowUpDown size={14} />
          Comparatif
        </button>
      </div>

      {pageMode === 'comparatif' ? (
        <ComparatifSection onCategoryClick={(cat) => setDrillCategory(cat)} />
      ) : (
      <div className="space-y-6">
        {/* Global Period Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <Filter size={14} />
            Période :
          </div>
          <select
            value={globalYear}
            onChange={e => {
              const v = e.target.value ? Number(e.target.value) : null
              if (v) setGlobalYear(v)
              setGlobalQuarter(null); setGlobalMonth(null)
            }}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
          >
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={globalQuarter ?? ''}
            onChange={e => {
              const v = e.target.value ? Number(e.target.value) : null
              setGlobalQuarter(v)
              if (v) setGlobalMonth(null)
            }}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
          >
            <option value="">Tous trimestres</option>
            <option value="1">T1 (Jan-Mar)</option>
            <option value="2">T2 (Avr-Jun)</option>
            <option value="3">T3 (Jul-Sep)</option>
            <option value="4">T4 (Oct-Déc)</option>
          </select>
          <select
            value={globalMonth ?? ''}
            onChange={e => {
              const v = e.target.value ? Number(e.target.value) : null
              setGlobalMonth(v)
              if (v) setGlobalQuarter(null)
            }}
            disabled={globalQuarter !== null}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary disabled:opacity-40"
          >
            <option value="">Tous les mois</option>
            {MOIS_FR.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
          {(globalQuarter || globalMonth) && (
            <button
              onClick={() => { setGlobalQuarter(null); setGlobalMonth(null) }}
              className="text-[10px] text-text-muted hover:text-text transition-colors"
            >
              Réinitialiser
            </button>
          )}
        </div>

        {/* Bandeau BNC provisoire / définitif */}
        <BncBanner bnc={bnc} disabled={bandeauDisabled} />

        {/* KPIs BNC (Recettes pro / Dépenses totales / BNC estimé) */}
        <BncKPIRow
          bnc={bnc}
          perso={perso}
          recettesPro={recettesPro}
          depensesTotales={depensesTotales}
          soldeBnc={soldeBnc}
          nbOperations={nb_operations}
          nbCategories={category_summary.length}
          tresorerieSolde={tresorerie?.solde ?? 0}
        />

        {/* Ventilation des dépenses Pro/Perso */}
        <VentilationDepensesCard
          bnc={bnc}
          perso={perso}
          categorySummary={category_summary}
          periodLabel={periodLabel}
        />

        {/* Répartition par type d'opération (bancaire vs note de frais) */}
        {by_source && by_source.length > 0 && (
          <RepartitionParTypeCard sources={by_source} />
        )}

        {/* Nature filter — pilote tableau catégories ET graphe d'évolution */}
        <NatureFilter
          value={natureFilter}
          onChange={setNatureFilter}
          hint="le tableau et les graphes filtrent en conséquence"
        />

        {/* Ventilation */}
        <VentilationSection
          categorySummary={filteredCategorySummary}
          trends={trendsSelected}
          sortCol={sortCol}
          setSortCol={setSortCol}
          sortDir={sortDir}
          setSortDir={setSortDir}
          onCategoryClick={(cat) => setDrillCategory(cat)}
        />

        {/* Évolution temporelle */}
        <EvolutionSection
          trends={trendsSelected}
          granularity={granularity}
          setGranularity={setGranularity}
          mode={evolutionMode}
          setMode={setEvolutionMode}
        />

        {/* Anomalies */}
        <AnomaliesSection
          anomalies={anomalies || []}
          loading={anomaliesLoading}
          threshold={anomalyThreshold}
          setThreshold={setAnomalyThreshold}
        />
      </div>

      )}

      <QueryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <CategoryDetailDrawer
        isOpen={drillCategory !== null}
        onClose={() => setDrillCategory(null)}
        category={drillCategory}
        year={globalYear}
        quarter={globalQuarter}
        month={globalMonth}
      />
    </div>
  )
}

// ──────────── KPI Row BNC ────────────

function BncKPIRow({
  bnc, perso, recettesPro, depensesTotales, soldeBnc, nbOperations, nbCategories, tresorerieSolde,
}: {
  bnc: BncMetrics | undefined
  perso: PersoMetrics | undefined
  recettesPro: number
  depensesTotales: number
  soldeBnc: number
  nbOperations: number
  nbCategories: number
  tresorerieSolde: number
}) {
  const baseLabel = bnc?.base_recettes === 'liasse'
    ? 'liasse SCP · définitif'
    : 'crédits bancaires · provisoire'
  const depensesSub = (perso?.total_debit ?? 0) > 0
    ? `pro + perso confondus`
    : 'pro déductible'

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {/* Recettes pro */}
      <MetricCard
        title="Recettes pro"
        value={formatCurrency(recettesPro)}
        icon={<TrendingUp size={20} />}
        trend="up"
      />
      {/* Dépenses totales */}
      <MetricCard
        title="Dépenses totales"
        value={formatCurrency(depensesTotales)}
        icon={<TrendingDown size={20} />}
        trend="down"
      />
      {/* BNC estimé */}
      <MetricCard
        title={bnc?.base_recettes === 'liasse' ? 'BNC' : 'BNC estimé'}
        value={formatCurrency(soldeBnc)}
        icon={<Calculator size={20} />}
        trend={soldeBnc >= 0 ? 'up' : 'down'}
      />
      {/* Secondaires : opérations + catégories */}
      <MetricCard title="Opérations" value={nbOperations.toString()} icon={<Hash size={20} />} />
      <MetricCard title="Catégories" value={nbCategories.toString()} icon={<Tags size={20} />} />

      {/* Sous-labels informatifs sous les 3 cartes principales (ligne séparée pour ne pas casser la grille des icônes MetricCard) */}
      <div className="col-span-2 md:col-span-3 lg:col-span-5 -mt-2 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-[10px] text-text-muted">
        <span className="truncate" title={baseLabel}>{baseLabel}</span>
        <span className="truncate">{depensesSub}</span>
        <span className="truncate">recettes pro − charges pro</span>
        <span />
        <span className="truncate hidden lg:inline" title={`Trésorerie brute : ${formatCurrency(tresorerieSolde)}`}>
          <Briefcase size={9} className="inline-block mr-1 opacity-60" />
          trésorerie : {formatCurrency(tresorerieSolde)}
        </span>
      </div>
    </div>
  )
}

// ──────────── Répartition par type d'opération (bancaire / note de frais) ────────────

function RepartitionParTypeCard({ sources }: { sources: SourceBreakdown[] }) {
  const bancaire = sources.find(s => s.source === 'bancaire')
  const ndf = sources.find(s => s.source === 'note_de_frais')
  const totalDebit = (bancaire?.debit ?? 0) + (ndf?.debit ?? 0)
  const ndfShare = totalDebit > 0 ? ((ndf?.debit ?? 0) / totalDebit) * 100 : 0

  return (
    <div className="bg-surface rounded-xl border border-border p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">Répartition par type d'opération</h3>
        {ndf && ndf.count > 0 && (
          <span className="text-xs text-text-muted">{ndfShare.toFixed(1)}% des dépenses en notes de frais</span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-background rounded-lg p-3 flex items-center justify-between">
          <div>
            <div className="text-xs text-text-muted mb-0.5">Opérations bancaires</div>
            <div className="text-lg font-semibold text-text tabular-nums">{formatCurrency(bancaire?.debit ?? 0)}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{bancaire?.count ?? 0} ops · {formatCurrency(bancaire?.credit ?? 0)} crédités</div>
          </div>
          <Wallet size={28} className="text-text-muted/40" />
        </div>
        <div className="bg-background rounded-lg p-3 flex items-center justify-between border border-amber-500/20">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '10px',
                  fontWeight: 500,
                  padding: '1px 6px',
                  borderRadius: '4px',
                  background: '#FAEEDA',
                  color: '#854F0B',
                  lineHeight: '16px',
                }}
              >
                Note de frais
              </span>
              <span className="text-xs text-text-muted">CB perso</span>
            </div>
            <div className="text-lg font-semibold text-text tabular-nums">{formatCurrency(ndf?.debit ?? 0)}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{ndf?.count ?? 0} op{(ndf?.count ?? 0) > 1 ? 's' : ''}</div>
          </div>
          <Wallet size={28} className="text-amber-500/40" />
        </div>
      </div>
    </div>
  )
}

// ──────────── Ventilation Section ────────────

function VentilationSection({ categorySummary, trends, sortCol, setSortCol, sortDir, setSortDir, onCategoryClick }: {
  categorySummary: CategorySummary[]
  trends: TrendRecord[]
  sortCol: SortCol
  setSortCol: (v: SortCol) => void
  sortDir: SortDir
  setSortDir: (v: SortDir) => void
  onCategoryClick: (cat: string) => void
}) {
  // Sort (data already filtered by global period via the API)
  const sortedData = useMemo(() => {
    return [...categorySummary].sort((a, b) => {
      const aVal = a[sortCol]
      const bVal = b[sortCol]
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
    })
  }, [categorySummary, sortCol, sortDir])

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const donutData = sortedData.filter(c => c['Débit'] > 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Table */}
      <div className="lg:col-span-2 bg-surface rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Ventilation par catégorie</h2>
          <span className="text-[10px] text-text-muted">Cliquez une catégorie pour le détail</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted text-xs">
                {([
                  ['Catégorie', 'Catégorie'],
                  ['Débit', 'Débit'],
                  ['Crédit', 'Crédit'],
                  ['Montant_Net', 'Net'],
                  ['Pourcentage_Dépenses', '% Dép.'],
                  ['Nombre_Opérations', 'Ops'],
                ] as [SortCol, string][]).map(([col, label]) => (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className={cn(
                      'py-2.5 px-2 cursor-pointer hover:text-text transition-colors',
                      col === 'Catégorie' ? 'text-left' : 'text-right'
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortCol === col && (
                        <ArrowUpDown size={10} className="text-primary" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => onCategoryClick(row['Catégorie'])}
                  className="border-b border-border/30 hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <td className="py-2 px-2">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      {row['Catégorie']}
                      <ChevronRight size={10} className="text-text-muted" />
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right text-danger font-mono text-xs">
                    {row['Débit'] > 0 ? formatCurrency(row['Débit']) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right text-success font-mono text-xs">
                    {row['Crédit'] > 0 ? formatCurrency(row['Crédit']) : '—'}
                  </td>
                  <td className={cn(
                    'py-2 px-2 text-right font-mono text-xs',
                    row.Montant_Net >= 0 ? 'text-success' : 'text-danger'
                  )}>
                    {formatCurrency(row.Montant_Net)}
                  </td>
                  <td className="py-2 px-2 text-right text-text-muted text-xs">
                    {row.Pourcentage_Dépenses.toFixed(1)}%
                  </td>
                  <td className="py-2 px-2 text-right text-text-muted text-xs">
                    {row.Nombre_Opérations}
                  </td>
                </tr>
              ))}
              {sortedData.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-text-muted">Aucune donnée pour cette période</td>
                </tr>
              )}
            </tbody>
            {sortedData.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold text-xs">
                  <td className="py-2 px-2">Total</td>
                  <td className="py-2 px-2 text-right text-danger font-mono">
                    {formatCurrency(sortedData.reduce((s, r) => s + r['Débit'], 0))}
                  </td>
                  <td className="py-2 px-2 text-right text-success font-mono">
                    {formatCurrency(sortedData.reduce((s, r) => s + r['Crédit'], 0))}
                  </td>
                  <td className="py-2 px-2 text-right font-mono">
                    {formatCurrency(sortedData.reduce((s, r) => s + r.Montant_Net, 0))}
                  </td>
                  <td className="py-2 px-2 text-right">100%</td>
                  <td className="py-2 px-2 text-right">
                    {sortedData.reduce((s, r) => s + r.Nombre_Opérations, 0)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Donut */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h2 className="text-lg font-semibold mb-4">Répartition</h2>
        {donutData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={donutData}
                dataKey="Débit"
                nameKey="Catégorie"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={100}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                label={((props: any) => {
                  const pct = ((props.percent as number) * 100).toFixed(0)
                  return Number(pct) > 5 ? `${pct}%` : ''
                }) as any}
                labelLine={false}
              >
                {donutData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => formatCurrency(Number(value))}
              />
              <Legend
                wrapperStyle={{ fontSize: '11px' }}
                iconSize={8}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-text-muted text-center py-12">Aucune donnée</p>
        )}
      </div>
    </div>
  )
}

// ──────────── Evolution Section ────────────

function EvolutionSection({ trends, granularity, setGranularity, mode, setMode }: {
  trends: TrendRecord[]
  granularity: Granularity
  setGranularity: (v: Granularity) => void
  mode: EvolutionMode
  setMode: (v: EvolutionMode) => void
}) {
  const { chartData, categories } = useMemo(() => {
    if (!trends.length) return { chartData: [], categories: [] as string[] }

    // Group by period
    const periodKey = (mois: string) => {
      if (granularity === 'quarter') {
        const m = parseInt(mois.split('-')[1])
        const q = Math.ceil(m / 3)
        return `${mois.split('-')[0]}-T${q}`
      }
      return mois
    }

    if (mode === 'aggregated' || mode === 'stacked') {
      // For stacked mode, we also need per-category data
      if (mode === 'stacked') {
        const allCats = [...new Set(trends.map(t => t['Catégorie']))]
        const catTotals = new Map<string, number>()
        trends.forEach(t => {
          catTotals.set(t['Catégorie'], (catTotals.get(t['Catégorie']) || 0) + t['Débit'])
        })
        const topCats = [...catTotals.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([c]) => c)

        const pivotMap = new Map<string, Record<string, number>>()
        trends.forEach(t => {
          if (!topCats.includes(t['Catégorie'])) return
          const key = periodKey(t.Mois)
          if (!pivotMap.has(key)) pivotMap.set(key, {})
          const row = pivotMap.get(key)!
          row[t['Catégorie']] = (row[t['Catégorie']] || 0) + t['Débit']
        })
        const data = Array.from(pivotMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([period, cats]) => ({ period, ...cats }))
        return { chartData: data, categories: topCats }
      }
    }

    if (mode === 'aggregated') {
      const agg = new Map<string, { debit: number; credit: number }>()
      trends.forEach(t => {
        const key = periodKey(t.Mois)
        const existing = agg.get(key) || { debit: 0, credit: 0 }
        existing.debit += t['Débit']
        existing.credit += t['Crédit']
        agg.set(key, existing)
      })
      const data = Array.from(agg.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([period, v]) => ({
          period,
          'Dépenses': Number(v.debit.toFixed(2)),
          'Revenus': Number(v.credit.toFixed(2)),
        }))
      return { chartData: data, categories: [] as string[] }
    }

    // Per-category mode
    const allCats = [...new Set(trends.map(t => t['Catégorie']))]
    // Top 10 by total debit
    const catTotals = new Map<string, number>()
    trends.forEach(t => {
      catTotals.set(t['Catégorie'], (catTotals.get(t['Catégorie']) || 0) + t['Débit'])
    })
    const topCats = [...catTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([c]) => c)

    // Pivot
    const pivotMap = new Map<string, Record<string, number>>()
    trends.forEach(t => {
      if (!topCats.includes(t['Catégorie'])) return
      const key = periodKey(t.Mois)
      if (!pivotMap.has(key)) pivotMap.set(key, {})
      const row = pivotMap.get(key)!
      row[t['Catégorie']] = (row[t['Catégorie']] || 0) + t['Débit']
    })

    const data = Array.from(pivotMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, cats]) => ({ period, ...cats }))

    return { chartData: data, categories: topCats }
  }, [trends, granularity, mode])

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-semibold">Évolution temporelle</h2>
        <div className="flex gap-2">
          {/* Granularity */}
          <div className="flex bg-background rounded-lg border border-border overflow-hidden">
            {(['month', 'quarter'] as Granularity[]).map(g => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={cn(
                  'px-3 py-1.5 text-xs transition-colors',
                  granularity === g
                    ? 'bg-primary text-white'
                    : 'text-text-muted hover:text-text'
                )}
              >
                {g === 'month' ? 'Mois' : 'Trimestre'}
              </button>
            ))}
          </div>
          {/* Mode */}
          <div className="flex bg-background rounded-lg border border-border overflow-hidden">
            {([
              ['aggregated', 'Agrégé'],
              ['category', 'Par catégorie'],
              ['stacked', 'Empilé'],
            ] as [EvolutionMode, string][]).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 py-1.5 text-xs transition-colors',
                  mode === m
                    ? 'bg-primary text-white'
                    : 'text-text-muted hover:text-text'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {chartData.length > 0 ? (
        mode === 'stacked' ? (
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
            <XAxis
              dataKey="period"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
              tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => formatCurrency(Number(value))}
            />
            <Legend wrapperStyle={{ fontSize: '11px' }} iconSize={8} />
            {categories.map((cat, i) => (
              <Bar
                key={cat}
                dataKey={cat}
                stackId="stack"
                fill={COLORS[i % COLORS.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        ) : (
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
            <XAxis
              dataKey="period"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
              tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => formatCurrency(Number(value))}
            />
            <Legend wrapperStyle={{ fontSize: '11px' }} iconSize={8} />

            {mode === 'aggregated' ? (
              <>
                <Line type="monotone" dataKey="Dépenses" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Revenus" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
              </>
            ) : (
              categories.map((cat, i) => (
                <Line
                  key={cat}
                  type="monotone"
                  dataKey={cat}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={1.5}
                  dot={{ r: 2 }}
                />
              ))
            )}
          </LineChart>
        </ResponsiveContainer>
        )
      ) : (
        <p className="text-text-muted text-center py-12">Aucune donnée de tendances</p>
      )}
    </div>
  )
}

// ──────────── Anomalies Section ────────────

function AnomaliesSection({ anomalies, loading, threshold, setThreshold }: {
  anomalies: { Date: string; 'Libellé': string; 'Débit': number; 'Catégorie': string; Moyenne: number; 'Écart_Type': number; Pourcentage_Sup_Moyenne: number }[]
  loading: boolean
  threshold: number
  setThreshold: (v: number) => void
}) {
  const sorted = useMemo(() =>
    [...anomalies].sort((a, b) => b.Pourcentage_Sup_Moyenne - a.Pourcentage_Sup_Moyenne),
    [anomalies]
  )

  const getSeverity = (pct: number) => {
    if (pct >= 200) return { color: 'bg-red-500', label: 'Critique' }
    if (pct >= 100) return { color: 'bg-amber-500', label: 'Élevé' }
    return { color: 'bg-yellow-400', label: 'Modéré' }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-400" />
          Détection d'anomalies
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Seuil :</span>
          <select
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className="bg-background border border-border rounded-lg px-2 py-1 text-sm text-text focus:outline-none focus:border-primary"
          >
            {[1.0, 1.5, 2.0, 2.5, 3.0].map(t => (
              <option key={t} value={t}>{t}x écart-type</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner text="Analyse des anomalies..." />
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-text-muted">
          <CheckCircle size={32} className="text-emerald-400" />
          <p className="text-sm">Aucune anomalie détectée avec ce seuil</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted text-xs">
                <th className="text-left py-2.5 px-2">Sévérité</th>
                <th className="text-left py-2.5 px-2">Date</th>
                <th className="text-left py-2.5 px-2">Libellé</th>
                <th className="text-left py-2.5 px-2">Catégorie</th>
                <th className="text-right py-2.5 px-2">Débit</th>
                <th className="text-right py-2.5 px-2">Moyenne cat.</th>
                <th className="text-right py-2.5 px-2">% au-dessus</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a, i) => {
                const severity = getSeverity(a.Pourcentage_Sup_Moyenne)
                return (
                  <tr key={i} className="border-b border-border/30 hover:bg-surface-hover transition-colors">
                    <td className="py-2 px-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn('w-2 h-2 rounded-full', severity.color)} />
                        <span className="text-[10px] text-text-muted">{severity.label}</span>
                      </span>
                    </td>
                    <td className="py-2 px-2 text-text-muted text-xs">
                      {typeof a.Date === 'string' ? a.Date.slice(0, 10) : ''}
                    </td>
                    <td className="py-2 px-2 max-w-[250px] truncate text-xs">{a['Libellé']}</td>
                    <td className="py-2 px-2">
                      <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] rounded-full">
                        {a['Catégorie']}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right text-danger font-mono text-xs">
                      {formatCurrency(a['Débit'])}
                    </td>
                    <td className="py-2 px-2 text-right text-text-muted font-mono text-xs">
                      {formatCurrency(a.Moyenne)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-xs">
                      <span className={cn(
                        a.Pourcentage_Sup_Moyenne >= 200 ? 'text-red-400' :
                        a.Pourcentage_Sup_Moyenne >= 100 ? 'text-amber-400' : 'text-yellow-400'
                      )}>
                        +{a.Pourcentage_Sup_Moyenne.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-text-muted/50 mt-2 text-right">
            {sorted.length} anomalie(s) détectée(s)
          </p>
        </div>
      )}
    </div>
  )
}
