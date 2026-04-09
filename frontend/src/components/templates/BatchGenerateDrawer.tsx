import { useState, useMemo } from 'react'
import {
  X, Layers, ChevronLeft, ChevronRight, Loader2, CheckCircle2,
  List, Calendar, FolderTree, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn, formatCurrency, MOIS_FR } from '@/lib/utils'
import { useDrawerResize } from '@/hooks/useDrawerResize'
import { useBatchCandidates, useBatchGenerate } from '@/hooks/useTemplates'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import type { BatchCandidate, BatchGenerateResponse } from '@/types'

interface Props {
  templateId: string | null
  vendor: string
  onClose: () => void
}

type ViewMode = 'list' | 'month' | 'category'

function formatDateFr(d: string): string {
  if (!d) return '\u2014'
  const parts = d.split('-')
  if (parts.length !== 3) return d
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function candidateKey(c: BatchCandidate): string {
  return `${c.operation_file}:${c.operation_index}`
}

export default function BatchGenerateDrawer({ templateId, vendor, onClose }: Props) {
  const { selectedYear } = useFiscalYearStore()
  const [year, setYear] = useState(selectedYear)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [initialized, setInitialized] = useState(false)
  const [result, setResult] = useState<BatchGenerateResponse | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [expanded, setCollapsed] = useState<Set<string>>(new Set())
  const { width: drawerWidth, handleMouseDown } = useDrawerResize({ defaultWidth: 700, minWidth: 500, maxWidth: 1100, storageKey: 'batch-generate-width' })

  const { data, isLoading } = useBatchCandidates(templateId, year)
  const batchGenerate = useBatchGenerate()

  const candidates = data?.candidates || []

  // Init: select all when data arrives
  if (candidates.length > 0 && !initialized) {
    setSelected(new Set(candidates.map(candidateKey)))
    setInitialized(true)
  }

  const handleYearChange = (delta: number) => {
    setYear((y) => y + delta)
    setInitialized(false)
    setSelected(new Set())
    setResult(null)
    setCollapsed(new Set())
  }

  const toggleAll = () => {
    if (selected.size === candidates.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(candidates.map(candidateKey)))
    }
  }

  const toggleOne = (c: BatchCandidate) => {
    const key = candidateKey(c)
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }

  const toggleGroup = (groupCandidates: BatchCandidate[]) => {
    const keys = groupCandidates.map(candidateKey)
    const allSelected = keys.every((k) => selected.has(k))
    const next = new Set(selected)
    if (allSelected) {
      keys.forEach((k) => next.delete(k))
    } else {
      keys.forEach((k) => next.add(k))
    }
    setSelected(next)
  }

  const toggleExpand = (groupKey: string) => {
    const next = new Set(expanded)
    if (next.has(groupKey)) next.delete(groupKey)
    else next.add(groupKey)
    setCollapsed(next)
  }

  const selectedOps = useMemo(() => {
    return candidates
      .filter((c) => selected.has(candidateKey(c)))
      .map((c) => ({ operation_file: c.operation_file, operation_index: c.operation_index }))
  }, [candidates, selected])

  const handleGenerate = () => {
    if (!templateId || selectedOps.length === 0) return
    batchGenerate.mutate(
      { template_id: templateId, operations: selectedOps },
      { onSuccess: (res) => setResult(res) },
    )
  }

  // Build result map
  const resultMap = useMemo(() => {
    if (!result) return new Map<string, { ok: boolean; filename: string | null; error: string | null }>()
    const m = new Map<string, { ok: boolean; filename: string | null; error: string | null }>()
    for (const r of result.results) {
      m.set(`${r.operation_file}:${r.operation_index}`, {
        ok: !r.error, filename: r.filename, error: r.error,
      })
    }
    return m
  }, [result])

  // Grouped data
  const groupedByMonth = useMemo(() => {
    const groups = new Map<number, BatchCandidate[]>()
    for (const c of candidates) {
      const list = groups.get(c.mois) || []
      list.push(c)
      groups.set(c.mois, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a - b)
  }, [candidates])

  const groupedByCategory = useMemo(() => {
    const groups = new Map<string, BatchCandidate[]>()
    for (const c of candidates) {
      const label = c.sous_categorie
        ? `${c.categorie} / ${c.sous_categorie}`
        : c.categorie || 'Sans categorie'
      const list = groups.get(label) || []
      list.push(c)
      groups.set(label, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [candidates])

  const open = !!templateId

  // Shared row renderer
  const renderRow = (c: BatchCandidate, idx: number) => {
    const key = candidateKey(c)
    const r = resultMap.get(key)
    return (
      <tr key={key} className={cn('border-t border-border/30', idx % 2 === 0 ? 'bg-card' : 'bg-background')}>
        <td className="px-2 py-1.5 text-center">
          <input type="checkbox" checked={selected.has(key)} onChange={() => toggleOne(c)} disabled={!!result} className="accent-orange-500" />
        </td>
        <td className="px-2 py-1.5 text-text-muted whitespace-nowrap">{formatDateFr(c.date)}</td>
        <td className="px-2 py-1.5 text-text truncate max-w-[220px]" title={c.libelle}>
          {c.libelle.length > 35 ? c.libelle.slice(0, 35) + '...' : c.libelle}
        </td>
        <td className="px-2 py-1.5 text-right font-mono text-text">{formatCurrency(c.montant)}</td>
        {result && (
          <td className="px-2 py-1.5 text-center">
            {r ? (
              r.ok ? <span className="text-emerald-400 text-[10px]">OK</span>
                : <span className="text-red-400 text-[10px]" title={r.error || ''}>Erreur</span>
            ) : <span className="text-text-muted/30">{'\u2014'}</span>}
          </td>
        )}
      </tr>
    )
  }

  // Group section renderer
  const renderGroup = (groupKey: string, label: string, items: BatchCandidate[]) => {
    const isOpen = expanded.has(groupKey)
    const keys = items.map(candidateKey)
    const allSel = keys.every((k) => selected.has(k))
    const someSel = keys.some((k) => selected.has(k))
    const selCount = keys.filter((k) => selected.has(k)).length

    return (
      <div key={groupKey} className="border border-border rounded-lg overflow-hidden mb-2">
        <button
          onClick={() => toggleExpand(groupKey)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-surface-hover text-xs hover:bg-surface transition-colors"
        >
          <input
            type="checkbox"
            checked={allSel}
            ref={(el) => { if (el) el.indeterminate = someSel && !allSel }}
            onChange={(e) => { e.stopPropagation(); toggleGroup(items) }}
            onClick={(e) => e.stopPropagation()}
            className="accent-orange-500"
          />
          {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span className="font-medium text-text flex-1 text-left">{label}</span>
          <span className="text-text-muted">
            {selCount}/{items.length}
          </span>
        </button>
        {isOpen && (
          <table className="w-full text-xs">
            <tbody>
              {items.map((c, idx) => renderRow(c, idx))}
            </tbody>
          </table>
        )}
      </div>
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
              <p className="text-sm font-semibold text-text">Generation batch</p>
              <p className="text-xs text-text-muted">{vendor}</p>
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
          <div className="flex border border-border rounded-lg overflow-hidden">
            {([
              { mode: 'list' as ViewMode, icon: List, title: 'Liste' },
              { mode: 'month' as ViewMode, icon: Calendar, title: 'Par mois' },
              { mode: 'category' as ViewMode, icon: FolderTree, title: 'Par categorie' },
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
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 text-text-muted py-12">
              <Loader2 size={16} className="animate-spin" />
              Recherche des candidats...
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-3" />
              <p className="text-sm text-text">Aucune operation sans justificatif</p>
              <p className="text-xs text-text-muted mt-1">
                Toutes les operations correspondantes pour {year} ont deja un justificatif.
              </p>
            </div>
          ) : (
            <>
              {/* Select all + counter */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSelected(new Set(candidates.map(candidateKey)))}
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
                </div>
                <span className="text-xs text-text-muted">
                  {selected.size} / {candidates.length}
                </span>
              </div>

              {/* List view */}
              {viewMode === 'list' && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-hover text-text-muted">
                        <th className="w-8 px-2 py-1.5" />
                        <th className="text-left px-2 py-1.5">Date</th>
                        <th className="text-left px-2 py-1.5">Libelle</th>
                        <th className="text-right px-2 py-1.5">Montant</th>
                        {result && <th className="text-center px-2 py-1.5 w-16">Statut</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c, idx) => renderRow(c, idx))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Month view */}
              {viewMode === 'month' && (
                <div className="space-y-0">
                  {groupedByMonth.map(([mois, items]) => {
                    const label = MOIS_FR[mois - 1] || `Mois ${mois}`
                    return renderGroup(`month-${mois}`, label, items)
                  })}
                </div>
              )}

              {/* Category view */}
              {viewMode === 'category' && (
                <div className="space-y-0">
                  {groupedByCategory.map(([label, items]) =>
                    renderGroup(`cat-${label}`, label, items)
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-end">
          {result ? (
            <div className="flex items-center gap-3 w-full justify-between">
              <div className="text-xs text-text-muted">
                <span className="text-emerald-400 font-medium">{result.generated}</span> generes
                {result.errors > 0 && (
                  <>, <span className="text-red-400 font-medium">{result.errors}</span> erreurs</>
                )}
              </div>
              <button onClick={onClose} className="px-4 py-1.5 text-xs font-medium rounded-lg bg-surface text-text border border-border hover:bg-surface-hover transition-colors">
                Fermer
              </button>
            </div>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={selected.size === 0 || batchGenerate.isPending}
              className={cn(
                'px-4 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors',
                selected.size > 0 && !batchGenerate.isPending
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'bg-surface text-text-muted cursor-not-allowed',
              )}
            >
              {batchGenerate.isPending ? (
                <><Loader2 size={13} className="animate-spin" /> Generation en cours...</>
              ) : (
                <><Layers size={13} /> Generer {selected.size} fac-simile{selected.size > 1 ? 's' : ''}</>
              )}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
