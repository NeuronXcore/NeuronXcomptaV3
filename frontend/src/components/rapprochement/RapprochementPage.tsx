import { useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import RapprochementDrawer from './RapprochementDrawer'
import RapprochementManuelDrawer from './RapprochementManuelDrawer'
import {
  useUnmatched,
  useRunAutoRapprochement,
  useAutoLog,
  useOperationSuggestions,
  useManualAssociate,
} from '@/hooks/useRapprochement'
import { useOperationFiles, useOperations } from '@/hooks/useOperations'
import { formatCurrency, cn, MOIS_FR } from '@/lib/utils'
import {
  Paperclip, Clock, Zap, History, Link, Loader2, Check,
  AlertCircle, X, ChevronRight, FileText, Search, Scissors,
} from 'lucide-react'
import type { Operation, AutoRapprochementReport, RapprochementSuggestion, VentilationLine } from '@/types'

export default function RapprochementPage() {
  const { data: unmatched, isLoading: unmatchedLoading } = useUnmatched()
  const { data: opFiles } = useOperationFiles()
  const autoMutation = useRunAutoRapprochement()

  // Selection state
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedOpIndex, setSelectedOpIndex] = useState<number | null>(null)
  const [selectedOp, setSelectedOp] = useState<Operation | null>(null)

  // Drawer rapprochement manuel
  const [drawerOp, setDrawerOp] = useState<{
    index: number
    date: string
    libelle: string
    debit: number
    credit: number
    ventilation?: VentilationLine[]
  } | null>(null)

  // UI state
  const [showAutoReport, setShowAutoReport] = useState(false)
  const [autoReport, setAutoReport] = useState<AutoRapprochementReport | null>(null)
  const [showLogDrawer, setShowLogDrawer] = useState(false)
  const [monthFilter, setMonthFilter] = useState<string>('')
  const [catFilter, setCatFilter] = useState<string>('')

  // Load operations for selected file
  const { data: fileOperations } = useOperations(selectedFile)

  // Load suggestions for selected operation
  const { data: suggestions, isLoading: suggestionsLoading } = useOperationSuggestions(
    selectedFile, selectedOpIndex
  )

  const associateMutation = useManualAssociate()

  // Unassociated operations from the selected file
  const unmatchedOps = (fileOperations || [])
    .map((op, idx) => ({ op, idx }))
    .filter(({ op }) => {
      const vlines = op.ventilation ?? []
      if (vlines.length > 0) {
        // Ventilée : visible si au moins une sous-ligne sans justificatif
        return vlines.some(vl => !vl.justificatif)
      }
      return !op.Justificatif
    })
    .filter(({ op }) => {
      if (monthFilter) {
        const m = op.Date?.slice(5, 7)
        if (m !== monthFilter) return false
      }
      if (catFilter) {
        const vlines = op.ventilation ?? []
        if (vlines.length > 0) {
          // Pour ops ventilées, matcher si une sous-ligne a la catégorie
          return vlines.some(vl => vl.categorie === catFilter)
        }
        if ((op['Catégorie'] || '') !== catFilter) return false
      }
      return true
    })

  // Categories from current file for filter
  const fileCategories = [...new Set(
    (fileOperations || []).map(op => op['Catégorie']).filter(Boolean)
  )].sort() as string[]

  const handleRunAuto = () => {
    autoMutation.mutate(undefined, {
      onSuccess: (data) => {
        setAutoReport(data)
        setShowAutoReport(true)
      },
    })
  }

  const handleAssociate = (suggestion: RapprochementSuggestion) => {
    associateMutation.mutate({
      justificatif_filename: suggestion.justificatif_filename,
      operation_file: suggestion.operation_file,
      operation_index: suggestion.operation_index,
      rapprochement_score: suggestion.score.total,
    }, {
      onSuccess: () => {
        setSelectedOpIndex(null)
        setSelectedOp(null)
      },
    })
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Rapprochement"
        description="Associer les opérations bancaires aux justificatifs"
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => setShowLogDrawer(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover transition-colors"
            >
              <History size={15} />
              Log auto
            </button>
            <button
              onClick={handleRunAuto}
              disabled={autoMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {autoMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
              Rapprochement auto
            </button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <MetricCard
          title="Opérations sans justificatif"
          value={unmatchedLoading ? '...' : String(unmatched?.operations_sans_justificatif ?? 0)}
          icon={<Paperclip size={20} />}
        />
        <MetricCard
          title="Justificatifs en attente"
          value={unmatchedLoading ? '...' : String(unmatched?.justificatifs_en_attente ?? 0)}
          icon={<Clock size={20} />}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Left: Operations */}
        <div className="bg-surface rounded-xl border border-border flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold mb-2">Opérations sans justificatif</h3>
            <div className="flex gap-2">
              <select
                value={selectedFile || ''}
                onChange={e => {
                  setSelectedFile(e.target.value || null)
                  setSelectedOpIndex(null)
                  setSelectedOp(null)
                }}
                className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-text flex-1"
              >
                <option value="">Fichier...</option>
                {opFiles?.map(f => (
                  <option key={f.filename} value={f.filename}>
                    {f.month ? `${MOIS_FR[f.month - 1]} ${f.year}` : f.filename} ({f.count})
                  </option>
                ))}
              </select>
              <select
                value={monthFilter}
                onChange={e => setMonthFilter(e.target.value)}
                className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-text w-24"
              >
                <option value="">Mois</option>
                {MOIS_FR.map((m, i) => (
                  <option key={i} value={String(i + 1).padStart(2, '0')}>{m.slice(0, 3)}</option>
                ))}
              </select>
              <select
                value={catFilter}
                onChange={e => setCatFilter(e.target.value)}
                className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-text w-32"
              >
                <option value="">Catégorie</option>
                {fileCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!selectedFile ? (
              <div className="p-8 text-center text-text-muted text-sm">
                Sélectionnez un fichier d'opérations
              </div>
            ) : unmatchedOps.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-sm">
                <Check size={24} className="mx-auto mb-2 text-emerald-400" />
                Toutes les opérations sont associées
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {unmatchedOps.map(({ op, idx }) => {
                  const vlines = op.ventilation ?? []
                  const isVentilated = vlines.length > 0
                  return (
                    <div key={idx}>
                      <div
                        onClick={() => {
                          setSelectedOpIndex(idx)
                          setSelectedOp(op)
                        }}
                        className={cn(
                          'w-full text-left px-4 py-2.5 transition-colors cursor-pointer',
                          selectedOpIndex === idx
                            ? 'bg-primary/10 border-l-2 border-l-primary'
                            : 'hover:bg-surface-hover'
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 truncate flex-1">
                            {isVentilated && <Scissors size={11} className="text-primary shrink-0" />}
                            <p className="text-xs text-text truncate">{op['Libellé']}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setDrawerOp({
                                index: idx,
                                date: op.Date || '',
                                libelle: op['Libellé'] || '',
                                debit: op['Débit'] || 0,
                                credit: op['Crédit'] || 0,
                                ventilation: isVentilated ? vlines : undefined,
                              })
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-primary bg-primary/10 rounded hover:bg-primary/20 transition-colors shrink-0"
                            title="Rapprochement manuel"
                          >
                            <Search size={10} />
                            Associer
                          </button>
                          <ChevronRight size={12} className="text-text-muted shrink-0" />
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-text-muted mt-0.5">
                          <span>{op.Date?.slice(0, 10)}</span>
                          {(op['Débit'] || 0) > 0 && (
                            <span className="text-red-400">{formatCurrency(op['Débit'])}</span>
                          )}
                          {(op['Crédit'] || 0) > 0 && (
                            <span className="text-emerald-400">{formatCurrency(op['Crédit'])}</span>
                          )}
                          {isVentilated ? (
                            <span className="text-primary/70">Ventilé ({vlines.length} lignes)</span>
                          ) : (
                            op['Catégorie'] && <span className="text-primary">{op['Catégorie']}</span>
                          )}
                        </div>
                      </div>

                      {/* Sous-lignes ventilées */}
                      {isVentilated && (
                        <div className="bg-background/50">
                          {vlines.map((vl, vlIdx) => (
                            <div
                              key={vlIdx}
                              className={cn(
                                'flex items-center gap-2 px-4 py-1.5 pl-8 text-[10px] border-t border-border/10',
                                vl.justificatif ? 'opacity-50' : ''
                              )}
                            >
                              <div className="w-0.5 h-3 bg-border rounded-full shrink-0" />
                              <span className="text-text-muted">L{vlIdx + 1}</span>
                              <span className="text-text truncate flex-1">{vl.libelle || vl.categorie || '—'}</span>
                              <span className="font-mono text-text-muted">{formatCurrency(vl.montant)}</span>
                              {vl.categorie && (
                                <span className="text-primary/70">{vl.categorie}</span>
                              )}
                              {vl.justificatif ? (
                                <Paperclip size={10} className="text-emerald-400 shrink-0" />
                              ) : (
                                <span className="text-red-400/60 text-[9px]">manquant</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Suggestions */}
        <div className="bg-surface rounded-xl border border-border flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">Justificatifs suggérés</h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {!selectedOp ? (
              <div className="h-full flex items-center justify-center text-text-muted text-sm">
                <div className="text-center">
                  <Paperclip size={32} className="mx-auto mb-3 opacity-20" />
                  <p>Sélectionnez une opération</p>
                  <p className="text-xs mt-1">pour voir les correspondances</p>
                </div>
              </div>
            ) : suggestionsLoading ? (
              <div className="h-full flex items-center justify-center">
                <LoadingSpinner text="Calcul des correspondances..." />
              </div>
            ) : !suggestions || suggestions.length === 0 ? (
              <div className="h-full flex items-center justify-center text-text-muted text-sm">
                <div className="text-center">
                  <AlertCircle size={24} className="mx-auto mb-2 opacity-40" />
                  <p>Aucune correspondance trouvée</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Selected operation summary */}
                <div className="bg-background rounded-lg p-3 mb-4">
                  <p className="text-xs font-medium text-text truncate">{selectedOp['Libellé']}</p>
                  <div className="flex gap-3 text-[10px] text-text-muted mt-1">
                    <span>{selectedOp.Date?.slice(0, 10)}</span>
                    <span className="text-red-400">
                      {formatCurrency(Math.max(selectedOp['Débit'] || 0, selectedOp['Crédit'] || 0))}
                    </span>
                  </div>
                </div>

                {suggestions.map((s, i) => {
                  const colors = {
                    fort: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', bar: 'bg-emerald-500' },
                    probable: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', bar: 'bg-emerald-400' },
                    possible: { bg: 'bg-amber-500/15', text: 'text-amber-400', bar: 'bg-amber-500' },
                    faible: { bg: 'bg-zinc-500/15', text: 'text-text-muted', bar: 'bg-zinc-500' },
                  }[s.score.confidence_level] || { bg: '', text: '', bar: '' }

                  return (
                    <div
                      key={`${s.justificatif_filename}_${i}`}
                      className={cn(
                        'rounded-lg border border-border p-3 transition-colors',
                        i === 0 ? 'bg-primary/5 border-primary/30' : 'bg-background'
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
                            <div
                              className={cn('h-full rounded-full', colors.bar)}
                              style={{ width: `${Math.round(s.score.total * 100)}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-text-muted">
                            {Math.round(s.score.total * 100)}%
                          </span>
                          <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-medium', colors.bg, colors.text)}>
                            {s.score.confidence_level}
                          </span>
                          {i === 0 && <span className="text-[10px] text-primary font-medium">Meilleur</span>}
                        </div>
                        <button
                          onClick={() => handleAssociate(s)}
                          disabled={associateMutation.isPending}
                          className="flex items-center gap-1 px-2.5 py-1 bg-primary/15 text-primary text-xs rounded-lg hover:bg-primary/25 transition-colors disabled:opacity-50"
                        >
                          {associateMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Link size={11} />}
                          Associer
                        </button>
                      </div>

                      <p className="text-xs text-text truncate">
                        <FileText size={11} className="inline mr-1 text-text-muted" />
                        {s.justificatif_filename}
                      </p>

                      <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1.5">
                        <span>Montant: {Math.round(s.score.detail.montant * 100)}%</span>
                        <span>Date: {Math.round(s.score.detail.date * 100)}%</span>
                        <span>Fournisseur: {Math.round(s.score.detail.fournisseur * 100)}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Auto-rapprochement report modal */}
      {showAutoReport && autoReport && (
        <AutoReportModal report={autoReport} onClose={() => setShowAutoReport(false)} />
      )}

      {/* Log drawer */}
      {showLogDrawer && (
        <LogDrawer onClose={() => setShowLogDrawer(false)} />
      )}

      {/* Rapprochement manuel drawer */}
      <RapprochementManuelDrawer
        isOpen={drawerOp !== null}
        onClose={() => setDrawerOp(null)}
        filename={selectedFile}
        operation={drawerOp}
      />
    </div>
  )
}


// ──── Auto Report Modal ────

function AutoReportModal({
  report,
  onClose,
}: {
  report: AutoRapprochementReport
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background border border-border rounded-xl shadow-2xl p-6 z-50 w-[400px]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Zap size={16} className="text-primary" />
            Rapport de rapprochement
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Justificatifs analysés</span>
            <span className="font-mono">{report.total_justificatifs_traites}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Associations automatiques</span>
            <span className="font-mono text-emerald-400">{report.associations_auto}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Suggestions fortes</span>
            <span className="font-mono text-amber-400">{report.suggestions_fortes}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Sans correspondance</span>
            <span className="font-mono text-text-muted">{report.sans_correspondance}</span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-5 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors"
        >
          Fermer
        </button>
      </div>
    </>
  )
}


// ──── Log Drawer ────

function LogDrawer({ onClose }: { onClose: () => void }) {
  const { data: log, isLoading } = useAutoLog()

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className={cn(
        'fixed top-0 right-0 h-full w-[500px] max-w-[95vw] bg-background border-l border-border z-50 flex flex-col',
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <History size={16} className="text-primary" />
            Log du rapprochement automatique
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <LoadingSpinner text="Chargement..." />
          ) : !log || log.length === 0 ? (
            <div className="text-text-muted text-sm text-center py-8">
              Aucune association automatique enregistrée
            </div>
          ) : (
            <div className="space-y-2">
              {log.map((entry, i) => (
                <div key={i} className="bg-surface rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                      entry.action === 'associe'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-amber-500/15 text-amber-400'
                    )}>
                      {entry.action === 'associe' ? 'Associé' : 'Annulé'}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {Math.round(entry.score * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-text truncate">{entry.operation_libelle}</p>
                  <p className="text-[10px] text-text-muted truncate mt-0.5">
                    {entry.justificatif}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {entry.timestamp?.slice(0, 16).replace('T', ' ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
