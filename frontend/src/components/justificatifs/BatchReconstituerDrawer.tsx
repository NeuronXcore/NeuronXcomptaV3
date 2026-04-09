import { useState, useEffect, useCallback, useMemo } from 'react'
import { cn, formatDate, formatCurrency } from '@/lib/utils'
import { useTemplates, useBatchSuggest, useBatchGenerate } from '@/hooks/useTemplates'
import type { EnrichedOperation } from '@/hooks/useJustificatifsPage'
import type { BatchSuggestGroup } from '@/types'
import toast from 'react-hot-toast'
import {
  X, Loader2, Stamp, ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  operations: EnrichedOperation[]
  onDone: () => void
}

interface GroupWithOverride extends BatchSuggestGroup {
  overrideTemplateId?: string
}

export default function BatchReconstituerDrawer({ open, onClose, operations, onDone }: Props) {
  const { data: allTemplates = [] } = useTemplates()
  const batchSuggest = useBatchSuggest()
  const batchGenerate = useBatchGenerate()

  const [groups, setGroups] = useState<GroupWithOverride[]>([])
  const [unmatched, setUnmatched] = useState<{ operation_file: string; operation_index: number; libelle: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Fetch suggestions when drawer opens
  useEffect(() => {
    if (!open || operations.length === 0) return

    setLoading(true)
    setGroups([])
    setUnmatched([])

    const ops = operations.map(op => ({
      operation_file: op._filename,
      operation_index: op._originalIndex,
    }))

    batchSuggest.mutateAsync(ops).then(result => {
      setGroups(result.groups)
      setUnmatched(result.unmatched)
      // Expand all groups by default
      setExpandedGroups(new Set(result.groups.map(g => g.template_id)))
    }).catch(() => {
      toast.error('Erreur lors de la recherche de templates')
    }).finally(() => {
      setLoading(false)
    })
  }, [open, operations]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTemplateChange = useCallback((groupIdx: number, newTemplateId: string) => {
    setGroups(prev => {
      const next = [...prev]
      const tpl = allTemplates.find(t => t.id === newTemplateId)
      next[groupIdx] = {
        ...next[groupIdx],
        overrideTemplateId: newTemplateId,
        template_id: newTemplateId,
        template_vendor: tpl?.vendor ?? next[groupIdx].template_vendor,
      }
      return next
    })
  }, [allTemplates])

  const toggleGroup = useCallback((templateId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(templateId)) next.delete(templateId)
      else next.add(templateId)
      return next
    })
  }, [])

  const totalOps = useMemo(() => groups.reduce((acc, g) => acc + g.operations.length, 0), [groups])

  const handleGenerate = useCallback(async () => {
    if (groups.length === 0) return

    setGenerating(true)
    try {
      let totalGenerated = 0
      let totalErrors = 0

      for (const group of groups) {
        const templateId = group.overrideTemplateId ?? group.template_id
        const result = await batchGenerate.mutateAsync({
          template_id: templateId,
          operations: group.operations.map(o => ({
            operation_file: o.operation_file,
            operation_index: o.operation_index,
          })),
        })
        totalGenerated += result.generated
        totalErrors += result.errors
      }

      if (totalErrors > 0) {
        toast(`${totalGenerated} fac-similés générés, ${totalErrors} erreurs`, { icon: '⚠️' })
      } else {
        toast.success(`${totalGenerated} fac-similé${totalGenerated > 1 ? 's' : ''} généré${totalGenerated > 1 ? 's' : ''} et associé${totalGenerated > 1 ? 's' : ''}`)
      }

      onDone()
      onClose()
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la génération batch')
    } finally {
      setGenerating(false)
    }
  }, [groups, batchGenerate, onDone, onClose])

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[550px] max-w-[95vw] bg-background border-l border-border z-50 flex flex-col transition-transform">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Stamp size={18} className="text-warning" />
            <div>
              <p className="text-sm font-semibold text-text">Reconstituer en batch</p>
              <p className="text-xs text-text-muted">{operations.length} opération{operations.length > 1 ? 's' : ''} sélectionnée{operations.length > 1 ? 's' : ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <Loader2 size={24} className="animate-spin mb-3" />
              <p className="text-sm">Recherche des templates...</p>
            </div>
          ) : (
            <>
              {/* Groups */}
              {groups.map((group, gIdx) => (
                <div key={group.template_id + gIdx} className="border border-border rounded-xl overflow-hidden">
                  {/* Group header */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-surface/50">
                    <button
                      onClick={() => toggleGroup(group.template_id)}
                      className="p-0.5 text-text-muted hover:text-text"
                    >
                      {expandedGroups.has(group.template_id)
                        ? <ChevronDown size={14} />
                        : <ChevronRight size={14} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-text">
                          {group.operations.length} op{group.operations.length > 1 ? 's' : ''}
                        </span>
                        <span className="text-[10px] text-text-muted">—</span>
                        <span className="text-xs text-text-muted">Template :</span>
                      </div>
                    </div>
                    <select
                      value={group.overrideTemplateId ?? group.template_id}
                      onChange={e => handleTemplateChange(gIdx, e.target.value)}
                      className="bg-surface border border-border rounded px-2 py-1 text-xs text-text max-w-[200px] truncate"
                    >
                      {allTemplates.map(tpl => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.vendor}{tpl.category ? ` (${tpl.category})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Group operations */}
                  {expandedGroups.has(group.template_id) && (
                    <div className="divide-y divide-border/50">
                      {group.operations.map((op, oIdx) => (
                        <div key={oIdx} className="flex items-center gap-3 px-4 py-2 text-xs">
                          <span className="text-text-muted whitespace-nowrap w-[72px]">
                            {op.libelle ? '' : '—'}
                          </span>
                          <span className="text-text truncate flex-1" title={op.libelle}>
                            {op.libelle || '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Unmatched */}
              {unmatched.length > 0 && (
                <div className="border border-amber-500/30 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10">
                    <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                    <span className="text-xs font-semibold text-amber-400">
                      {unmatched.length} opération{unmatched.length > 1 ? 's' : ''} sans template
                    </span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {unmatched.map((op, idx) => (
                      <div key={idx} className="flex items-center gap-3 px-4 py-2 text-xs text-text-muted">
                        <span className="truncate flex-1">{op.libelle || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {groups.length === 0 && unmatched.length === 0 && !loading && (
                <div className="text-center py-12 text-text-muted text-sm">
                  Aucune opération à traiter
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
          <span className="text-xs text-text-muted">
            {totalOps > 0 ? `${totalOps} opération${totalOps > 1 ? 's' : ''} à générer` : ''}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || groups.length === 0 || loading}
              className={cn(
                'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all',
                'bg-warning text-background shadow-lg shadow-warning/25 hover:shadow-warning/40 hover:scale-[1.02]',
                'disabled:opacity-60 disabled:hover:scale-100 disabled:shadow-none'
              )}
            >
              {generating
                ? <Loader2 size={16} className="animate-spin" />
                : <Stamp size={16} />}
              {generating ? 'Génération...' : `Générer (${totalOps})`}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
