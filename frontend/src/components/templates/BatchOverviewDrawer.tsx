import { useState, useMemo } from 'react'
import {
  X, Layers, ChevronLeft, ChevronRight, Loader2, CheckCircle2,
  ChevronDown, ChevronUp, List, Calendar, FolderTree,
} from 'lucide-react'
import { cn, formatCurrency, MOIS_FR } from '@/lib/utils'
import { useDrawerResize } from '@/hooks/useDrawerResize'
import { useOpsWithoutJustificatif, useTemplates, useBatchGenerate } from '@/hooks/useTemplates'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import type { BatchCandidate, BatchGenerateResponse, OpsGroup } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
}

type ViewMode = 'category' | 'month' | 'list'

function formatDateFr(d: string): string {
  if (!d) return '\u2014'
  const parts = d.split('-')
  if (parts.length !== 3) return d
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function candidateKey(c: BatchCandidate): string {
  return `${c.operation_file}:${c.operation_index}`
}

export default function BatchOverviewDrawer({ open, onClose }: Props) {
  const { selectedYear } = useFiscalYearStore()
  const [year, setYear] = useState(selectedYear)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [initialized, setInitialized] = useState(false)
  const [expanded, setCollapsed] = useState<Set<string>>(new Set())
  const [templateOverrides, setTemplateOverrides] = useState<Record<string, string>>({})
  const [results, setResults] = useState<BatchGenerateResponse[]>([])
  const [generating, setGenerating] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('category')
  const { width: drawerWidth, handleMouseDown } = useDrawerResize({ defaultWidth: 750, minWidth: 500, maxWidth: 1100, storageKey: 'batch-overview-width' })

  const { data, isLoading } = useOpsWithoutJustificatif(year)
  const { data: templates } = useTemplates()
  const batchGenerate = useBatchGenerate()

  const groups = data?.groups || []
  const allCandidates = useMemo(() => groups.flatMap((g) => g.operations), [groups])

  // Init: select all
  if (allCandidates.length > 0 && !initialized) {
    setSelected(new Set(allCandidates.map(candidateKey)))
    setInitialized(true)
  }

  // Group by month (derived from category groups)
  const groupedByMonth = useMemo(() => {
    const map = new Map<number, BatchCandidate[]>()
    for (const c of allCandidates) {
      const list = map.get(c.mois) || []
      list.push(c)
      map.set(c.mois, list)
    }
    return [...map.entries()].sort(([a], [b]) => a - b)
  }, [allCandidates])

  const handleYearChange = (delta: number) => {
    setYear((y) => y + delta)
    setInitialized(false)
    setSelected(new Set())
    setCollapsed(new Set())
    setTemplateOverrides({})
    setResults([])
  }

  const toggleExpand = (key: string) => {
    const next = new Set(expanded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsed(next)
  }

  const toggleGroupOps = (ops: BatchCandidate[]) => {
    const keys = ops.map(candidateKey)
    const allSel = keys.every((k) => selected.has(k))
    const next = new Set(selected)
    if (allSel) keys.forEach((k) => next.delete(k))
    else keys.forEach((k) => next.add(k))
    setSelected(next)
  }

  const toggleOne = (c: BatchCandidate) => {
    const key = candidateKey(c)
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }

  const toggleAll = () => {
    if (selected.size === allCandidates.length) setSelected(new Set())
    else setSelected(new Set(allCandidates.map(candidateKey)))
  }

  const getGroupTemplateId = (g: OpsGroup): string | null => {
    const groupKey = `${g.category}::${g.sous_categorie}`
    return templateOverrides[groupKey] || g.suggested_template_id || null
  }

  const setGroupTemplate = (g: OpsGroup, tplId: string) => {
    const groupKey = `${g.category}::${g.sous_categorie}`
    setTemplateOverrides((prev) => ({ ...prev, [groupKey]: tplId }))
  }

  // For month/list views: find best template for a candidate via its category group
  const getTemplateForCandidate = (c: BatchCandidate): string | null => {
    const g = groups.find((g) => g.category === c.categorie && g.sous_categorie === c.sous_categorie)
    return g ? getGroupTemplateId(g) : null
  }

  // Count selected ops that have a template assigned
  const selectedWithTemplate = useMemo(() => {
    let count = 0
    for (const g of groups) {
      const tplId = getGroupTemplateId(g)
      if (!tplId) continue
      for (const c of g.operations) {
        if (selected.has(candidateKey(c))) count++
      }
    }
    return count
  }, [groups, selected, templateOverrides])

  const handleGenerate = async () => {
    setGenerating(true)
    const allResults: BatchGenerateResponse[] = []

    for (const g of groups) {
      const tplId = getGroupTemplateId(g)
      if (!tplId) continue
      const ops = g.operations
        .filter((c) => selected.has(candidateKey(c)))
        .map((c) => ({ operation_file: c.operation_file, operation_index: c.operation_index }))
      if (ops.length === 0) continue

      try {
        const res = await new Promise<BatchGenerateResponse>((resolve, reject) => {
          batchGenerate.mutate(
            { template_id: tplId, operations: ops },
            { onSuccess: resolve, onError: reject },
          )
        })
        allResults.push(res)
      } catch {
        // Error handled by mutation toast
      }
    }

    setResults(allResults)
    setGenerating(false)
  }

  const totalGenerated = results.reduce((s, r) => s + r.generated, 0)
  const totalErrors = results.reduce((s, r) => s + r.errors, 0)
  const hasResults = results.length > 0

  // Row renderer
  const renderRow = (c: BatchCandidate, idx: number) => {
    const key = candidateKey(c)
    return (
      <tr key={key} className={cn('border-t border-border/20', idx % 2 === 0 ? 'bg-card' : 'bg-background')}>
        <td className="px-2 py-1 w-8 text-center">
          <input type="checkbox" checked={selected.has(key)} onChange={() => toggleOne(c)} disabled={hasResults} className="accent-orange-500" />
        </td>
        <td className="px-2 py-1 text-text-muted whitespace-nowrap">{formatDateFr(c.date)}</td>
        <td className="px-2 py-1 text-text truncate max-w-[220px]" title={c.libelle}>
          {c.libelle.length > 35 ? c.libelle.slice(0, 35) + '...' : c.libelle}
        </td>
        <td className="px-2 py-1 text-right font-mono text-text">{formatCurrency(c.montant)}</td>
        {viewMode === 'list' && (
          <td className="px-2 py-1 text-[10px] text-text-muted truncate max-w-[80px]" title={c.categorie}>
            {c.categorie}
          </td>
        )}
      </tr>
    )
  }

  // Generic collapsible group section (for month + category views)
  const renderSection = (
    sectionKey: string, label: string, items: BatchCandidate[],
    templateSelector?: React.ReactNode,
    templateName?: string | null,
  ) => {
    const isOpen = expanded.has(sectionKey)
    const keys = items.map(candidateKey)
    const allSel = keys.every((k) => selected.has(k))
    const someSel = keys.some((k) => selected.has(k))
    const selCount = keys.filter((k) => selected.has(k)).length
    const totalMontant = items.reduce((s, c) => s + c.montant, 0)

    return (
      <div key={sectionKey} className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-hover">
          <input
            type="checkbox" checked={allSel}
            ref={(el) => { if (el) el.indeterminate = someSel && !allSel }}
            onChange={() => toggleGroupOps(items)}
            className="accent-orange-500 shrink-0"
          />
          <button onClick={() => toggleExpand(sectionKey)} className="flex items-center gap-1.5 flex-1 min-w-0">
            {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span className="text-xs font-medium text-text truncate">{label}</span>
            {!isOpen && templateName && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 shrink-0 ml-1">{templateName}</span>
            )}
            {!isOpen && !templateName && templateSelector && (
              <span className="text-[10px] text-text-muted/40 ml-1">pas de template</span>
            )}
          </button>
          <span className="text-[10px] text-text-muted shrink-0">{selCount}/{items.length}</span>
          <span className="text-[10px] font-mono text-text-muted shrink-0">{formatCurrency(totalMontant)}</span>
        </div>
        {isOpen && templateSelector && (
          <div className="px-3 py-2 bg-surface border-t border-border/30 flex items-center gap-2">
            {templateSelector}
          </div>
        )}
        {isOpen && (
          <table className="w-full text-xs">
            <tbody>{items.map((c, idx) => renderRow(c, idx))}</tbody>
          </table>
        )}
      </div>
    )
  }

  // Template label helper
  const tplLabel = (t: { vendor: string; category?: string | null; sous_categorie?: string | null }) => {
    const parts = [t.vendor]
    if (t.category) {
      parts.push(t.sous_categorie ? `${t.category} / ${t.sous_categorie}` : t.category)
    }
    return parts.join(' \u2014 ')
  }

  // Template selector for a category group — sorted by relevance (matching category first)
  const templateSelectorFor = (g: OpsGroup) => {
    const tplId = getGroupTemplateId(g)
    const sorted = templates
      ? [...templates].sort((a, b) => {
          const aMatch = (a.category || '').toLowerCase() === g.category.toLowerCase() ? 1 : 0
          const bMatch = (b.category || '').toLowerCase() === g.category.toLowerCase() ? 1 : 0
          return bMatch - aMatch
        })
      : []

    return (
      <>
        <span className="text-[10px] text-text-muted shrink-0">Template :</span>
        <select
          value={tplId || ''}
          onChange={(e) => setGroupTemplate(g, e.target.value)}
          className={cn(
            'flex-1 px-2 py-1 text-xs rounded border focus:outline-none focus:border-primary',
            tplId ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' : 'bg-surface border-border text-text-muted',
          )}
        >
          <option value="">-- Aucun template --</option>
          {sorted.map((t) => (
            <option key={t.id} value={t.id}>{tplLabel(t)}</option>
          ))}
        </select>
      </>
    )
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}

      <div
        className={cn(
          'fixed top-0 right-0 h-full max-w-[95vw] bg-background border-l border-border z-50 flex flex-col transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ width: drawerWidth }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-orange-400" />
            <div>
              <p className="text-sm font-semibold text-text">Operations sans justificatif</p>
              <p className="text-xs text-text-muted">{data?.total || 0} operations — {groups.length} categories</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Year selector + view toggle */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => handleYearChange(-1)} className="p-1 text-text-muted hover:text-text"><ChevronLeft size={16} /></button>
            <span className="text-sm font-semibold text-text w-12 text-center">{year}</span>
            <button onClick={() => handleYearChange(1)} className="p-1 text-text-muted hover:text-text"><ChevronRight size={16} /></button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex border border-border rounded-lg overflow-hidden">
              {([
                { mode: 'category' as ViewMode, icon: FolderTree, title: 'Par categorie' },
                { mode: 'month' as ViewMode, icon: Calendar, title: 'Par mois' },
                { mode: 'list' as ViewMode, icon: List, title: 'Liste' },
              ]).map(({ mode, icon: Icon, title }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    'p-1.5 transition-colors',
                    viewMode === mode ? 'bg-orange-500/15 text-orange-400' : 'text-text-muted hover:text-text',
                  )}
                  title={title}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSelected(new Set(allCandidates.map(candidateKey)))}
                className="px-2 py-1 text-[10px] rounded border border-border text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
              >
                Tout
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="px-2 py-1 text-[10px] rounded border border-border text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
              >
                Rien
              </button>
              <span className="text-[10px] text-text-muted ml-1">{selected.size}/{allCandidates.length}</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 text-text-muted py-12">
              <Loader2 size={16} className="animate-spin" />
              Chargement...
            </div>
          ) : allCandidates.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-3" />
              <p className="text-sm text-text">Toutes les operations ont un justificatif</p>
            </div>
          ) : viewMode === 'category' ? (
            /* ── Category view ── */
            groups.map((g) => {
              const groupKey = `cat::${g.category}::${g.sous_categorie}`
              const tplId = getGroupTemplateId(g)
              const tplName = tplId ? templates?.find((t) => t.id === tplId)?.vendor || null : g.suggested_template_vendor
              return renderSection(
                groupKey,
                g.sous_categorie ? `${g.category} / ${g.sous_categorie}` : g.category,
                g.operations,
                templateSelectorFor(g),
                tplName,
              )
            })
          ) : viewMode === 'month' ? (
            /* ── Month view ── */
            groupedByMonth.map(([mois, items]) => {
              const label = MOIS_FR[mois - 1] || `Mois ${mois}`
              return renderSection(`month::${mois}`, label, items)
            })
          ) : (
            /* ── List view ── */
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-hover text-text-muted">
                    <th className="w-8 px-2 py-1.5" />
                    <th className="text-left px-2 py-1.5">Date</th>
                    <th className="text-left px-2 py-1.5">Libelle</th>
                    <th className="text-right px-2 py-1.5">Montant</th>
                    <th className="text-left px-2 py-1.5">Categorie</th>
                  </tr>
                </thead>
                <tbody>
                  {allCandidates.map((c, idx) => renderRow(c, idx))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between">
          {hasResults ? (
            <>
              <div className="text-xs text-text-muted">
                <span className="text-emerald-400 font-medium">{totalGenerated}</span> generes
                {totalErrors > 0 && <>, <span className="text-red-400 font-medium">{totalErrors}</span> erreurs</>}
              </div>
              <button onClick={onClose} className="px-4 py-1.5 text-xs font-medium rounded-lg bg-surface text-text border border-border hover:bg-surface-hover transition-colors">
                Fermer
              </button>
            </>
          ) : (
            <>
              <span className="text-[10px] text-text-muted">
                {selectedWithTemplate} ops avec template
              </span>
              <button
                onClick={handleGenerate}
                disabled={selectedWithTemplate === 0 || generating}
                className={cn(
                  'px-4 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors',
                  selectedWithTemplate > 0 && !generating
                    ? 'bg-orange-500 text-white hover:bg-orange-600'
                    : 'bg-surface text-text-muted cursor-not-allowed',
                )}
              >
                {generating ? (
                  <><Loader2 size={13} className="animate-spin" /> Generation en cours...</>
                ) : (
                  <><Layers size={13} /> Generer {selectedWithTemplate} fac-simile{selectedWithTemplate > 1 ? 's' : ''}</>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
