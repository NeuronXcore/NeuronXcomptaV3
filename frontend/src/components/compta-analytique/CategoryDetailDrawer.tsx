import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toPng } from 'html-to-image'
import { useCategoryDetail, useExportCategorySnapshot } from '@/hooks/useApi'
import { useBatchCsgSplit } from '@/hooks/useSimulation'
import { formatCurrency, cn, MOIS_FR } from '@/lib/utils'
import toast from 'react-hot-toast'
import {
  X, Loader2, Tags, Calendar, DollarSign, FileText, AlertTriangle, Zap, Camera, Filter, ChevronDown,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import DotationsVirtualDrawer from './DotationsVirtualDrawer'

interface Props {
  isOpen: boolean
  onClose: () => void
  category: string | null
  year: number | null
  quarter: number | null
  month: number | null
}

// La ligne virtuelle "Dotations aux amortissements" est unique et synthétique
// (injectée par le backend avec is_virtual=true). Détection par nom suffit.
const VIRTUAL_DOTATIONS_NAME = 'Dotations aux amortissements'

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
  // Branchement vers le drawer spécialisé pour la ligne virtuelle dotations.
  // Sur année complète (pas de filtre mois/trimestre) — sinon retombe sur le drawer standard.
  const isVirtualDotation =
    category === VIRTUAL_DOTATIONS_NAME && year != null && quarter == null && month == null

  const { data, isLoading, refetch } = useCategoryDetail(
    // Gate la query pour éviter un appel inutile quand on délègue au drawer virtuel.
    !isVirtualDotation && isOpen ? category : null,
    year,
    quarter,
    month,
  )
  const batchMutation = useBatchCsgSplit()
  const exportSnapshotMutation = useExportCategorySnapshot()
  const navigate = useNavigate()

  // Ref sur la zone capturable du drawer (sans le bouton X et l'icône Camera)
  // pour ne pas inclure les contrôles UI dans le PNG final.
  const captureRef = useRef<HTMLDivElement | null>(null)

  // Filtre sous-catégorie : null = vue complète (groupement), sinon vue filtrée à plat.
  // Reset au changement de catégorie ou de période (les sous-cat dispo varient).
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null)
  useEffect(() => {
    setSelectedSubCategory(null)
  }, [category, year, month, quarter])

  const isUrssafCategory = ['urssaf', 'cotisations'].includes((category || '').toLowerCase())

  // Ops filtrées selon la sous-cat sélectionnée (ou liste complète si null)
  const filteredOps = useMemo(() => {
    if (!data) return []
    if (!selectedSubCategory) return data.operations
    // Helper d'égalité tolérante : "Non classé" mappe sur sous_categorie vide ("")
    return data.operations.filter(op => {
      const opSubcat = (op.sous_categorie || '').trim()
      if (selectedSubCategory === '__empty__') return opSubcat === ''
      return opSubcat === selectedSubCategory
    })
  }, [data, selectedSubCategory])

  // Totaux du footer : recalculés sur filteredOps quand un filtre est actif,
  // sinon réutilisent les totaux backend (data.total_debit/total_credit).
  const footerTotals = useMemo(() => {
    if (!data) return { debit: 0, credit: 0, count: 0 }
    if (!selectedSubCategory) {
      return {
        debit: data.total_debit,
        credit: data.total_credit,
        count: data.nb_operations,
      }
    }
    return {
      debit: filteredOps.reduce((s, op) => s + (op.debit || 0), 0),
      credit: filteredOps.reduce((s, op) => s + (op.credit || 0), 0),
      count: filteredOps.length,
    }
  }, [data, selectedSubCategory, filteredOps])

  // Groupement par sous-catégorie pour la vue non-filtrée. Chaque groupe contient
  // les ops triées par date (l'ordre backend est déjà ASC) + total débit/crédit.
  // Ordre des groupes : aligné sur data.subcategories (déjà trié par montant DESC
  // dans le rendu sub-cat list — on garde le même ordre pour cohérence visuelle).
  type OpsGroup = {
    name: string  // libellé affiché ("Non classé" pour vide)
    key: string   // clé unique (sous_categorie ou "__empty__")
    ops: typeof data.operations
    debit: number
    credit: number
  }
  const opsGroups = useMemo<OpsGroup[]>(() => {
    if (!data) return []
    const groups: Record<string, OpsGroup> = {}
    for (const op of data.operations) {
      const subcat = (op.sous_categorie || '').trim()
      const key = subcat || '__empty__'
      const name = subcat || 'Non classé'
      if (!groups[key]) {
        groups[key] = { name, key, ops: [], debit: 0, credit: 0 }
      }
      groups[key].ops.push(op)
      groups[key].debit += op.debit || 0
      groups[key].credit += op.credit || 0
    }
    // Tri par montant total DESC (cohérent avec la section sous-catégories en haut)
    return Object.values(groups).sort((a, b) =>
      (b.debit + b.credit) - (a.debit + a.credit)
    )
  }, [data])

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

  /**
   * Capture le contenu du drawer en PNG (via html-to-image) et l'envoie au backend
   * qui le wrap dans un PDF A4 1-page enregistré dans la GED comme rapport.
   * On capture `captureRef.current` qui exclut volontairement les boutons header
   * (X, Camera) pour un rendu final épuré.
   */
  const handleExportSnapshot = async () => {
    if (!captureRef.current || !category || !data) return
    const loadingId = toast.loading('Génération du snapshot…')
    const node = captureRef.current
    // Capture complète : on étire temporairement le wrapper pour inclure tout le
    // contenu (y compris les ops scrollées hors viewport). try/finally garantit
    // la restauration même si toPng plante. Le user voit un flash imperceptible.
    const scrollableContent = node.querySelector('.overflow-y-auto') as HTMLElement | null
    const originalHeight = node.style.height
    const originalScrollOverflow = scrollableContent?.style.overflow ?? ''

    try {
      let dataUrl: string
      try {
        node.style.height = 'auto'
        if (scrollableContent) scrollableContent.style.overflow = 'visible'

        const fullWidth = node.offsetWidth
        const fullHeight = node.offsetHeight

        dataUrl = await toPng(node, {
          pixelRatio: 2,
          backgroundColor: '#0f172a', // bg-background fallback dark
          cacheBust: true,
          width: fullWidth,
          height: fullHeight,
          // Style override : neutralise les contraintes flex/transform du parent fixed
          // pour que le clone se rende correctement (sans ça → résultat noir uniforme).
          style: {
            height: `${fullHeight}px`,
            width: `${fullWidth}px`,
            transform: 'none',
            position: 'static',
          },
          filter: (n) => {
            if (!(n instanceof HTMLElement)) return true
            return n.dataset?.snapshotSkip !== 'true'
          },
        })
      } finally {
        node.style.height = originalHeight
        if (scrollableContent) scrollableContent.style.overflow = originalScrollOverflow
      }

      const blob = await (await fetch(dataUrl)).blob()
      const result = await exportSnapshotMutation.mutateAsync({
        pngBlob: blob,
        category,
        year,
        month,
        quarter,
      })
      toast.dismiss(loadingId)
      toast.success(
        (t) => (
          <span className="flex items-center gap-2">
            <span>Snapshot exporté dans la GED</span>
            <button
              onClick={() => {
                toast.dismiss(t.id)
                navigate(`/ged?type=rapport&search=${encodeURIComponent(result.filename)}`)
              }}
              className="text-xs underline text-primary hover:text-primary/80"
            >
              Voir →
            </button>
          </span>
        ),
        { duration: 6000 },
      )
    } catch (err) {
      toast.dismiss(loadingId)
      toast.error(`Échec snapshot : ${err instanceof Error ? err.message : 'inconnue'}`)
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

  // Délégation au drawer virtuel — placée après les hooks pour respecter Rules of Hooks.
  if (isVirtualDotation) {
    return <DotationsVirtualDrawer year={year} isOpen={isOpen} onClose={onClose} />
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer — outer fixed container (NE PAS y mettre captureRef : html-to-image
          ne sait pas capturer un élément `position: fixed` correctement → résultat noir uniforme).
          Le captureRef est appliqué sur le wrapper interne `flex flex-col h-full bg-background`
          qui est en flow normal du point de vue du rendu cloné. */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[700px] max-w-[95vw] border-l border-border z-50 transition-transform duration-300',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
      <div ref={captureRef} className="flex flex-col h-full bg-background">
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
            <div className="flex items-center gap-1 shrink-0" data-snapshot-skip="true">
              <button
                onClick={handleExportSnapshot}
                disabled={!data || exportSnapshotMutation.isPending}
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  exportSnapshotMutation.isPending
                    ? 'text-primary bg-primary/10'
                    : 'text-text-muted hover:text-primary hover:bg-primary/10',
                  (!data || exportSnapshotMutation.isPending) && 'opacity-50 cursor-not-allowed',
                )}
                title="Capturer en snapshot PDF dans la GED"
              >
                {exportSnapshotMutation.isPending
                  ? <Loader2 size={16} className="animate-spin" />
                  : <Camera size={16} />}
              </button>
              <button
                onClick={onClose}
                className="p-1 text-text-muted hover:text-text transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Content — wrapped via captureRef pour permettre le snapshot html-to-image.
            Le ref n'inclut PAS le header avec les boutons X/Camera (UI exclue du PNG final). */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-background">
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
                      {batchMutation.isPending ? 'Calcul...' : (data.total_csg_non_deductible ?? 0) > 0 ? 'Recalculer' : 'Calculer tout'}
                    </button>
                  </div>
                  {(data.total_csg_non_deductible ?? 0) > 0 ? (
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-text-muted">Cotisations brutes</span>
                        <span className="font-mono text-text">{formatCurrency(data.total_debit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-muted">├── Part déductible BNC</span>
                        <span className="font-mono text-emerald-400">{formatCurrency(data.total_deductible ?? 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-muted">└── CSG/CRDS non déductible</span>
                        <span className="font-mono text-red-400">{formatCurrency((data.total_csg_non_deductible ?? 0))}</span>
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

              {/* Sous-catégories — cliquables pour filtrer la liste des opérations */}
              {data.subcategories.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                      Sous-catégories
                    </h3>
                    {selectedSubCategory && (
                      <button
                        onClick={() => setSelectedSubCategory(null)}
                        className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 underline"
                        title="Effacer le filtre sous-catégorie"
                      >
                        <X size={10} />
                        Tout voir
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {data.subcategories
                      .sort((a, b) => (b.debit + b.credit) - (a.debit + a.credit))
                      .map((sub) => {
                        const subTotal = Math.max(sub.debit, sub.credit)
                        const pct = montant > 0 ? (subTotal / montant * 100) : 0
                        const barWidth = (subTotal / maxSubAmount * 100)
                        const subKey = sub.name || '__empty__'
                        const isSelected = selectedSubCategory === subKey
                        return (
                          <button
                            key={sub.name}
                            type="button"
                            onClick={() => setSelectedSubCategory(prev => prev === subKey ? null : subKey)}
                            className={cn(
                              'w-full text-left bg-surface rounded-lg border p-3 transition-all',
                              'hover:border-primary/50 hover:shadow-sm cursor-pointer',
                              isSelected
                                ? 'border-primary ring-2 ring-primary/40 bg-primary/5'
                                : 'border-border',
                            )}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                {isSelected && <Filter size={11} className="text-primary shrink-0" />}
                                <span className={cn(
                                  'text-xs font-medium truncate',
                                  isSelected ? 'text-primary' : 'text-text',
                                )}>
                                  {sub.name || 'Non classé'}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-[10px] text-text-muted shrink-0">
                                <span>{sub.count} ops</span>
                                <span className="font-mono">{pct.toFixed(1)}%</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    'h-full rounded-full transition-all',
                                    isSelected ? 'bg-primary' : 'bg-primary/70',
                                  )}
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                              <span className="text-xs text-text font-mono w-24 text-right">
                                {formatCurrency(subTotal)}
                              </span>
                            </div>
                          </button>
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
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatCurrency(Number(v))} />
                        <Bar dataKey="debit" name="Débit" fill="#ef4444" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="credit" name="Crédit" fill="#22c55e" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {/* Opérations — vue filtrée (à plat) ou groupée par sous-cat avec sous-totaux */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                    {selectedSubCategory ? 'Opérations filtrées' : 'Opérations'} ({selectedSubCategory ? filteredOps.length : data.operations.length})
                  </h3>
                  {selectedSubCategory && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-primary/15 text-primary rounded inline-flex items-center gap-1">
                      <Filter size={9} />
                      {selectedSubCategory === '__empty__' ? 'Non classé' : selectedSubCategory}
                    </span>
                  )}
                </div>

                {/* Mode filtré : ops à plat (la sous-cat est déjà visible dans la pill du header) */}
                {selectedSubCategory ? (
                  <div className="space-y-1">
                    {filteredOps.map((op, i) => (
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
                        {(op.csg_non_deductible ?? 0) > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded shrink-0" title="CSG/CRDS non déductible">
                            {formatCurrency(op.csg_non_deductible ?? 0)} nd
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
                    {filteredOps.length === 0 && (
                      <div className="text-center text-text-muted text-xs py-4">
                        Aucune opération pour cette sous-catégorie
                      </div>
                    )}
                  </div>
                ) : (
                  /* Mode groupé : un sous-bandeau par sous-catégorie avec sous-total inline */
                  <div className="space-y-4">
                    {opsGroups.map((group) => {
                      const groupTotal = Math.max(group.debit, group.credit)
                      const isPositive = group.credit > group.debit
                      return (
                        <div key={group.key} className="bg-surface/40 rounded-lg border border-border/40 overflow-hidden">
                          {/* Header de groupe — sous-cat + sous-total + count, cliquable pour filtrer */}
                          <button
                            type="button"
                            onClick={() => setSelectedSubCategory(group.key)}
                            className={cn(
                              'w-full flex items-center justify-between px-3 py-2 bg-primary/8 border-b border-border/40',
                              'hover:bg-primary/15 transition-colors group/groupheader cursor-pointer',
                            )}
                            title="Cliquer pour filtrer sur cette sous-catégorie"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <ChevronDown size={11} className="text-primary shrink-0" />
                              <span className="text-xs font-semibold text-primary truncate">
                                {group.name}
                              </span>
                              <span className="text-[10px] text-text-muted shrink-0">
                                · {group.ops.length} op{group.ops.length > 1 ? 's' : ''}
                              </span>
                            </div>
                            <span className={cn(
                              'text-xs font-mono font-semibold tabular-nums shrink-0',
                              isPositive ? 'text-emerald-400' : 'text-red-400',
                            )}>
                              {isPositive ? '+' : '-'}{formatCurrency(groupTotal)}
                            </span>
                          </button>
                          {/* Ops du groupe */}
                          <div className="space-y-0">
                            {group.ops.map((op, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-3 px-3 py-1.5 hover:bg-surface transition-colors border-b border-border/20 last:border-b-0"
                              >
                                <span className="text-[10px] text-text-muted w-16 shrink-0 font-mono">
                                  {op.date?.slice(5, 10)}
                                </span>
                                <span className="text-xs text-text truncate flex-1">
                                  {op.libelle}
                                </span>
                                {(op.csg_non_deductible ?? 0) > 0 && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded shrink-0" title="CSG/CRDS non déductible">
                                    {formatCurrency(op.csg_non_deductible ?? 0)} nd
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
                          </div>
                        </div>
                      )
                    })}
                    {opsGroups.length === 0 && (
                      <div className="text-center text-text-muted text-xs py-4">
                        Aucune opération
                      </div>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Footer Total — sticky bottom (pattern miroir EditorPage / JustificatifsPage).
            Reste visible quand l'utilisateur scrolle. Si un filtre sous-cat est actif,
            les totaux reflètent UNIQUEMENT les ops filtrées (recalculés depuis filteredOps). */}
        {data && data.nb_operations > 0 && (
          <div className="px-5 py-3 border-t-2 border-warning bg-gradient-to-r from-warning/30 via-warning/25 to-warning/30 shadow-[0_-2px_8px_rgba(0,0,0,0.15)] shrink-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-warning">
                <span className="text-lg font-bold leading-none">∑</span>
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {selectedSubCategory ? 'Sous-total' : 'Total'}
                </span>
                <span className="text-xs italic text-text-muted">
                  · {footerTotals.count} opération{footerTotals.count > 1 ? 's' : ''}
                  {selectedSubCategory && (
                    <span className="not-italic">
                      {' '}· filtre actif
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                {footerTotals.debit > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-text-muted">Débit</span>
                    <span className="font-mono text-red-400 tabular-nums font-semibold">
                      {formatCurrency(footerTotals.debit)}
                    </span>
                  </div>
                )}
                {footerTotals.credit > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-text-muted">Crédit</span>
                    <span className="font-mono text-emerald-400 tabular-nums font-semibold">
                      {formatCurrency(footerTotals.credit)}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-text-muted">Solde</span>
                  <span
                    className={cn(
                      'font-mono tabular-nums px-2 py-0.5 rounded ring-1 font-semibold',
                      (footerTotals.credit - footerTotals.debit) >= 0
                        ? 'bg-success/20 text-emerald-400 ring-success/40'
                        : 'bg-danger/20 text-red-400 ring-danger/40',
                    )}
                  >
                    {(footerTotals.credit - footerTotals.debit) >= 0 ? '+' : ''}
                    {formatCurrency(footerTotals.credit - footerTotals.debit)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </>
  )
}
