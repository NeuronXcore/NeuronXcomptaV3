import { useEffect } from 'react'
import { useCategoryDetail } from '@/hooks/useApi'
import { useBatchCsgSplit } from '@/hooks/useSimulation'
import { formatCurrency, cn, MOIS_FR } from '@/lib/utils'
import toast from 'react-hot-toast'
import {
  X, Loader2, Tags, Calendar, DollarSign, FileText, AlertTriangle, Zap,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

interface Props {
  isOpen: boolean
  onClose: () => void
  category: string | null
  year: number | null
  quarter: number | null
  month: number | null
}

// Badge de nature fiscale (miroir backend _nature_of_category)
function NatureBadge({ category }: { category: string | null }) {
  if (!category) return null
  const cat = category.trim()
  const cl = cat.toLowerCase()
  let label: string
  let bg: string
  let color: string
  if (cl === 'perso') {
    label = 'perso'
    bg = 'rgba(148,163,184,0.15)'
    color = '#64748b'
  } else if (cat === '' || cl === 'autres' || cl === 'ventilé') {
    label = 'attente'
    bg = '#FAEEDA'
    color = '#854F0B'
  } else {
    label = 'pro'
    bg = '#EEEDFE'
    color = '#3C3489'
  }
  return (
    <span
      className="text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0"
      style={{ background: bg, color }}
      title={label === 'pro' ? 'Inclus dans le BNC' : label === 'perso' ? 'Hors BNC (ops personnelles)' : 'Compte d\'attente'}
    >
      {label}
    </span>
  )
}

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: '12px',
  color: '#e2e8f0',
}

export default function CategoryDetailDrawer({
  isOpen,
  onClose,
  category,
  year,
  quarter,
  month,
}: Props) {
  const { data, isLoading, refetch } = useCategoryDetail(
    isOpen ? category : null,
    year,
    quarter,
    month,
  )
  const batchMutation = useBatchCsgSplit()

  const isUrssafCategory = ['urssaf', 'cotisations'].includes((category || '').toLowerCase())

  const handleBatchCsg = async () => {
    if (!year) return
    try {
      const res = await batchMutation.mutateAsync({ year, force: true })
      toast.success(`${res.updated} opération(s) calculée(s) — ${formatCurrency(res.total_non_deductible)} non déductible`)
      refetch()
    } catch {
      toast.error('Erreur lors du calcul batch CSG/CRDS')
    }
  }

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const montant = data ? Math.max(data.total_debit, data.total_credit) : 0
  const maxSubAmount = data?.subcategories
    ? Math.max(...data.subcategories.map(s => Math.max(s.debit, s.credit)), 1)
    : 1

  // Format month labels for chart
  const chartData = (data?.monthly_evolution || []).map(m => {
    const parts = m.month.split('-')
    const mIdx = parseInt(parts[1] || '0') - 1
    return {
      ...m,
      label: MOIS_FR[mIdx]?.slice(0, 3) || m.month,
    }
  })

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[700px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Tags size={18} className="text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-text truncate">
                    {category || ''}
                  </h2>
                  <NatureBadge category={category} />
                </div>
                {data && (
                  <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5">
                    <span className="text-red-400">{formatCurrency(data.total_debit)} débit</span>
                    {data.total_credit > 0 && (
                      <span className="text-emerald-400">{formatCurrency(data.total_credit)} crédit</span>
                    )}
                    <span>{data.nb_operations} opération(s)</span>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-primary" />
            </div>
          ) : !data ? (
            <div className="text-center text-text-muted py-12">
              Aucune donnée
            </div>
          ) : (
            <>
              {/* Encadré CSG/CRDS déductibilité */}
              {isUrssafCategory && (
                <section className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="text-amber-400" />
                      <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                        Déductibilité CSG/CRDS
                      </h3>
                    </div>
                    <button
                      onClick={handleBatchCsg}
                      disabled={batchMutation.isPending}
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors',
                        'bg-primary/10 text-primary hover:bg-primary/20',
                        batchMutation.isPending && 'opacity-50 cursor-wait',
                      )}
                    >
                      <Zap size={10} />
                      {batchMutation.isPending ? 'Calcul...' : data.total_csg_non_deductible > 0 ? 'Recalculer' : 'Calculer tout'}
                    </button>
                  </div>
                  {data.total_csg_non_deductible > 0 ? (
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-text-muted">Cotisations brutes</span>
                        <span className="font-mono text-text">{formatCurrency(data.total_debit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-muted">├── Part déductible BNC</span>
                        <span className="font-mono text-emerald-400">{formatCurrency(data.total_deductible)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-muted">└── CSG/CRDS non déductible</span>
                        <span className="font-mono text-red-400">{formatCurrency(data.total_csg_non_deductible)}</span>
                      </div>
                      <div className="pt-1.5 border-t border-amber-500/10 text-[10px] text-text-muted">
                        La part non déductible (CSG 2,4% + CRDS 0,5%) est exclue du calcul BNC.
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-text-muted">
                      Cliquez sur « Calculer tout » pour calculer la part déductible de toutes les cotisations URSSAF de {year}.
                    </p>
                  )}
                </section>
              )}

              {/* Sous-catégories */}
              {data.subcategories.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                    Sous-catégories
                  </h3>
                  <div className="space-y-2">
                    {data.subcategories
                      .sort((a, b) => (b.debit + b.credit) - (a.debit + a.credit))
                      .map((sub) => {
                        const subTotal = Math.max(sub.debit, sub.credit)
                        const pct = montant > 0 ? (subTotal / montant * 100) : 0
                        const barWidth = (subTotal / maxSubAmount * 100)
                        return (
                          <div key={sub.name} className="bg-surface rounded-lg border border-border p-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs text-text font-medium">{sub.name || 'Non classé'}</span>
                              <div className="flex items-center gap-3 text-[10px] text-text-muted">
                                <span>{sub.count} ops</span>
                                <span className="font-mono">{pct.toFixed(1)}%</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full transition-all"
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                              <span className="text-xs text-text font-mono w-24 text-right">
                                {formatCurrency(subTotal)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </section>
              )}

              {/* Évolution mensuelle */}
              {chartData.length > 1 && (
                <section>
                  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                    Évolution mensuelle
                  </h3>
                  <div className="bg-surface rounded-lg border border-border p-3">
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={60} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                        <Bar dataKey="debit" name="Débit" fill="#ef4444" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="credit" name="Crédit" fill="#22c55e" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {/* Dernières opérations */}
              <section>
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                  Opérations ({data.operations.length})
                </h3>
                <div className="space-y-1">
                  {data.operations.map((op, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface transition-colors"
                    >
                      <span className="text-[10px] text-text-muted w-16 shrink-0 font-mono">
                        {op.date?.slice(5, 10)}
                      </span>
                      <span className="text-xs text-text truncate flex-1">
                        {op.libelle}
                      </span>
                      {op.sous_categorie && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary rounded shrink-0">
                          {op.sous_categorie}
                        </span>
                      )}
                      {op.csg_non_deductible > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded shrink-0" title="CSG/CRDS non déductible">
                          {formatCurrency(op.csg_non_deductible)} nd
                        </span>
                      )}
                      <span className={cn(
                        'text-xs font-mono w-20 text-right shrink-0',
                        op.debit > 0 ? 'text-red-400' : 'text-emerald-400',
                      )}>
                        {op.debit > 0 ? `-${formatCurrency(op.debit)}` : `+${formatCurrency(op.credit)}`}
                      </span>
                    </div>
                  ))}
                  {data.operations.length === 0 && (
                    <div className="text-center text-text-muted text-xs py-4">
                      Aucune opération
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  )
}
