import { useState, useMemo } from 'react'
import {
  CalendarClock,
  List,
  TrendingDown,
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  ArrowUpDown,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { cn, formatCurrency, formatDate, MOIS_FR } from '@/lib/utils'
import {
  useRecurrences,
  useEcheancier,
  useEcheancierStats,
  useSoldePrevisionnel,
  useAnnulerEcheance,
} from '@/hooks/useEcheancier'
import type { Echeance } from '@/types'

const PERIODICITE_COLORS: Record<string, string> = {
  hebdomadaire: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  bi_mensuel: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  mensuel: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  trimestriel: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  semestriel: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  annuel: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
}

const PERIODICITE_LABELS: Record<string, string> = {
  hebdomadaire: 'Hebdo',
  bi_mensuel: 'Bi-mensuel',
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  semestriel: 'Semestriel',
  annuel: 'Annuel',
}

const TABS = [
  { id: 'calendar', label: 'Calendrier', icon: CalendarClock },
  { id: 'list', label: 'Liste', icon: List },
  { id: 'solde', label: 'Solde prévisionnel', icon: TrendingDown },
] as const

type TabId = (typeof TABS)[number]['id']

export default function EcheancierPage() {
  const [activeTab, setActiveTab] = useState<TabId>('calendar')
  const [horizon, setHorizon] = useState(6)
  const [soldeActuel, setSoldeActuel] = useState(0)
  const [soldeInput, setSoldeInput] = useState('0')

  const { data: recurrences, isLoading: recLoading, refetch: refetchRec } = useRecurrences()
  const { data: echeances, isLoading: echLoading, refetch: refetchEch } = useEcheancier(horizon)
  const { data: stats } = useEcheancierStats(horizon)
  const { data: soldePrev } = useSoldePrevisionnel(soldeActuel, horizon)
  const annulerMutation = useAnnulerEcheance()

  const handleRefresh = () => {
    refetchRec()
    refetchEch()
  }

  const handleSoldeChange = () => {
    const val = parseFloat(soldeInput.replace(',', '.'))
    if (!isNaN(val)) setSoldeActuel(val)
  }

  if (recLoading || echLoading) {
    return <LoadingSpinner text="Analyse des paiements récurrents..." />
  }

  return (
    <div>
      <PageHeader
        title="Échéancier"
        description="Paiements récurrents et projections"
        actions={
          <>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="px-3 py-2 text-sm bg-surface border border-border rounded-lg text-text"
            >
              <option value={3}>3 mois</option>
              <option value={6}>6 mois</option>
              <option value={12}>12 mois</option>
            </select>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover text-text transition-colors"
            >
              <RefreshCw size={14} />
              Actualiser
            </button>
          </>
        }
      />

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Récurrences détectées"
          value={String(recurrences?.length ?? 0)}
          icon={<CalendarClock size={20} />}
        />
        <MetricCard
          title="Échéances à venir"
          value={String(stats?.total ?? 0)}
          icon={<List size={20} />}
        />
        <MetricCard
          title="Charge mensuelle moy."
          value={formatCurrency(stats?.montant_mensuel_moyen ?? 0)}
          icon={<TrendingDown size={20} />}
        />
        <div className="relative">
          <MetricCard
            title="Alertes découvert"
            value={String(stats?.nb_alertes_decouvert ?? 0)}
            icon={<AlertTriangle size={20} />}
          />
          {(stats?.nb_alertes_decouvert ?? 0) > 0 && (
            <span className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-danger" />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface border border-border rounded-lg p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center',
                activeTab === tab.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-muted hover:text-text hover:bg-surface-hover'
              )}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'calendar' && (
        <CalendarTab echeances={echeances ?? []} onAnnuler={(id) => annulerMutation.mutate(id)} />
      )}
      {activeTab === 'list' && (
        <ListTab echeances={echeances ?? []} onAnnuler={(id) => annulerMutation.mutate(id)} />
      )}
      {activeTab === 'solde' && (
        <SoldeTab
          soldePrev={soldePrev ?? []}
          soldeInput={soldeInput}
          onSoldeInputChange={setSoldeInput}
          onSoldeSubmit={handleSoldeChange}
          stats={stats}
        />
      )}
    </div>
  )
}

/* ─── Calendar Tab ─── */
function CalendarTab({
  echeances,
  onAnnuler,
}: {
  echeances: Echeance[]
  onAnnuler: (id: string) => void
}) {
  const [selectedEch, setSelectedEch] = useState<Echeance | null>(null)

  // Group echeances by month
  const months = useMemo(() => {
    const map = new Map<string, Echeance[]>()
    for (const ech of echeances) {
      const d = new Date(ech.date_prevue)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(ech)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [echeances])

  return (
    <div>
      {months.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-12 text-center">
          <CalendarClock size={40} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-muted">Aucune échéance détectée</p>
          <p className="text-text-muted text-sm mt-1">Importez des relevés bancaires pour détecter les paiements récurrents</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {months.map(([key, echs]) => {
            const [year, month] = key.split('-')
            const label = `${MOIS_FR[parseInt(month) - 1]} ${year}`
            const totalMois = echs.reduce((s, e) => s + e.montant_prevu, 0)
            return (
              <div key={key} className="bg-surface rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-text">{label}</h3>
                  <span className={cn('text-sm font-mono', totalMois < 0 ? 'text-red-400' : 'text-emerald-400')}>
                    {formatCurrency(totalMois)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {echs.map((ech) => (
                    <button
                      key={ech.id}
                      onClick={() => setSelectedEch(ech)}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-all hover:scale-[1.02]',
                        ech.statut === 'annule'
                          ? 'opacity-40 line-through bg-surface-hover border-border'
                          : ech.statut === 'realise'
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : PERIODICITE_COLORS[ech.periodicite] || 'bg-surface-hover border-border text-text'
                      )}
                    >
                      <span className="truncate mr-2">{ech.libelle}</span>
                      <span className="font-mono whitespace-nowrap">{formatCurrency(ech.montant_prevu)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Drawer */}
      {selectedEch && (
        <EcheanceDrawer
          echeance={selectedEch}
          onClose={() => setSelectedEch(null)}
          onAnnuler={onAnnuler}
        />
      )}
    </div>
  )
}

/* ─── Echeance Drawer ─── */
function EcheanceDrawer({
  echeance,
  onClose,
  onAnnuler,
}: {
  echeance: Echeance
  onClose: () => void
  onAnnuler: (id: string) => void
}) {
  const fiabColor = echeance.fiabilite >= 0.8 ? 'text-emerald-400' : echeance.fiabilite >= 0.5 ? 'text-amber-400' : 'text-red-400'

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[400px] bg-background border-l border-border z-50 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-text">Détail échéance</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-text-muted">Libellé</label>
            <p className="text-text font-medium">{echeance.libelle}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted">Date prévue</label>
              <p className="text-text">{formatDate(echeance.date_prevue)}</p>
            </div>
            <div>
              <label className="text-xs text-text-muted">Fenêtre</label>
              <p className="text-text text-sm">{formatDate(echeance.date_min)} — {formatDate(echeance.date_max)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted">Montant prévu</label>
              <p className={cn('font-mono font-bold', echeance.montant_prevu < 0 ? 'text-red-400' : 'text-emerald-400')}>
                {formatCurrency(echeance.montant_prevu)}
              </p>
            </div>
            <div>
              <label className="text-xs text-text-muted">Incertitude</label>
              <p className="text-text-muted font-mono">± {formatCurrency(echeance.incertitude)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted">Périodicité</label>
              <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs border', PERIODICITE_COLORS[echeance.periodicite])}>
                {PERIODICITE_LABELS[echeance.periodicite] || echeance.periodicite}
              </span>
            </div>
            <div>
              <label className="text-xs text-text-muted">Fiabilité</label>
              <p className={cn('font-mono font-bold', fiabColor)}>
                {Math.round(echeance.fiabilite * 100)}%
              </p>
            </div>
          </div>
          <div>
            <label className="text-xs text-text-muted">Statut</label>
            <p className="text-text capitalize">{echeance.statut}</p>
          </div>

          {echeance.statut === 'prevu' && (
            <button
              onClick={() => {
                onAnnuler(echeance.id)
                onClose()
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors text-sm"
            >
              <X size={14} />
              Annuler cette échéance
            </button>
          )}
        </div>
      </div>
    </>
  )
}

/* ─── List Tab ─── */
function ListTab({
  echeances,
  onAnnuler,
}: {
  echeances: Echeance[]
  onAnnuler: (id: string) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date_prevue', desc: false }])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [perioFilter, setPerioFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    let data = [...echeances]
    if (statusFilter !== 'all') data = data.filter((e) => e.statut === statusFilter)
    if (perioFilter !== 'all') data = data.filter((e) => e.periodicite === perioFilter)
    return data
  }, [echeances, statusFilter, perioFilter])

  const columns = useMemo<ColumnDef<Echeance>[]>(
    () => [
      {
        accessorKey: 'date_prevue',
        header: 'Date prévue',
        cell: ({ getValue }) => formatDate(getValue<string>()),
        size: 110,
      },
      {
        accessorKey: 'libelle',
        header: 'Libellé',
        cell: ({ getValue }) => (
          <span className="truncate block max-w-[250px]">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: 'montant_prevu',
        header: 'Montant',
        cell: ({ row }) => {
          const m = row.original.montant_prevu
          const inc = row.original.incertitude
          return (
            <span className={cn('font-mono', m < 0 ? 'text-red-400' : 'text-emerald-400')}>
              {formatCurrency(m)}
              {inc > 0 && <span className="text-text-muted text-[10px] ml-1">±{inc.toFixed(0)}</span>}
            </span>
          )
        },
        size: 140,
      },
      {
        accessorKey: 'periodicite',
        header: 'Périodicité',
        cell: ({ getValue }) => {
          const p = getValue<string>()
          return (
            <span className={cn('px-2 py-0.5 rounded-full text-xs border', PERIODICITE_COLORS[p])}>
              {PERIODICITE_LABELS[p] || p}
            </span>
          )
        },
        size: 110,
      },
      {
        accessorKey: 'fiabilite',
        header: 'Fiabilité',
        cell: ({ getValue }) => {
          const f = getValue<number>()
          const color = f >= 0.8 ? 'text-emerald-400' : f >= 0.5 ? 'text-amber-400' : 'text-red-400'
          return <span className={cn('font-mono', color)}>{Math.round(f * 100)}%</span>
        },
        size: 80,
      },
      {
        accessorKey: 'statut',
        header: 'Statut',
        cell: ({ getValue }) => {
          const s = getValue<string>()
          const styles =
            s === 'realise'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : s === 'annule'
                ? 'bg-red-500/10 text-red-400 border-red-500/30'
                : 'bg-blue-500/10 text-blue-400 border-blue-500/30'
          return (
            <span className={cn('px-2 py-0.5 rounded-full text-xs border capitalize', styles)}>
              {s === 'prevu' ? 'Prévu' : s === 'realise' ? 'Réalisé' : 'Annulé'}
            </span>
          )
        },
        size: 90,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.statut === 'prevu' ? (
            <button
              onClick={() => onAnnuler(row.original.id)}
              className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors"
              title="Annuler"
            >
              <X size={14} />
            </button>
          ) : null,
        size: 40,
      },
    ],
    [onAnnuler]
  )

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-surface border border-border rounded-lg text-text"
        >
          <option value="all">Tous statuts</option>
          <option value="prevu">Prévu</option>
          <option value="realise">Réalisé</option>
          <option value="annule">Annulé</option>
        </select>
        <select
          value={perioFilter}
          onChange={(e) => setPerioFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-surface border border-border rounded-lg text-text"
        >
          <option value="all">Toutes périodicités</option>
          {Object.entries(PERIODICITE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-text-muted">{filtered.length} échéance(s)</span>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="px-4 py-3 text-left text-text-muted font-medium cursor-pointer hover:text-text select-none"
                    style={{ width: h.column.getSize() }}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getCanSort() && <ArrowUpDown size={12} className="text-text-muted/50" />}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-text-muted">
                  Aucune échéance trouvée
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-border/50 hover:bg-surface-hover transition-colors">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2.5 text-text">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─── Solde Tab ─── */
function SoldeTab({
  soldePrev,
  soldeInput,
  onSoldeInputChange,
  onSoldeSubmit,
  stats,
}: {
  soldePrev: { date: string; solde: number; evenement: string; montant: number; alerte: boolean }[]
  soldeInput: string
  onSoldeInputChange: (v: string) => void
  onSoldeSubmit: () => void
  stats?: { montant_mensuel_moyen: number; nb_alertes_decouvert: number } | null
}) {
  const chartData = useMemo(
    () =>
      soldePrev.map((s) => ({
        ...s,
        dateLabel: formatDate(s.date),
      })),
    [soldePrev]
  )

  return (
    <div>
      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-surface rounded-xl border border-border p-4">
          <label className="text-xs text-text-muted mb-2 block">Solde actuel (€)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={soldeInput}
              onChange={(e) => onSoldeInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSoldeSubmit()}
              className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-text text-sm font-mono"
              placeholder="0,00"
            />
            <button
              onClick={onSoldeSubmit}
              className="px-3 py-2 bg-primary/10 text-primary border border-primary/30 rounded-lg text-sm hover:bg-primary/20 transition-colors"
            >
              <Check size={14} />
            </button>
          </div>
        </div>
        <MetricCard
          title="Charge mensuelle moy."
          value={formatCurrency(stats?.montant_mensuel_moyen ?? 0)}
          icon={<TrendingDown size={20} />}
        />
        <div className="relative">
          <MetricCard
            title="Alertes découvert"
            value={String(stats?.nb_alertes_decouvert ?? 0)}
            icon={<AlertTriangle size={20} />}
          />
          {(stats?.nb_alertes_decouvert ?? 0) > 0 && (
            <span className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-danger" />
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-surface rounded-xl border border-border p-6">
        <h3 className="text-sm font-semibold text-text mb-4">Projection du solde</h3>
        {chartData.length === 0 ? (
          <div className="py-16 text-center text-text-muted">Aucune donnée de projection</div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="soldeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="dateLabel" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value: number, _name: string, props: { payload: { evenement: string } }) => [
                  `${formatCurrency(value)} — ${props.payload.evenement}`,
                  'Solde',
                ]}
              />
              <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" />
              <Area
                type="monotone"
                dataKey="solde"
                stroke="#8b5cf6"
                fill="url(#soldeGrad)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#8b5cf6' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
