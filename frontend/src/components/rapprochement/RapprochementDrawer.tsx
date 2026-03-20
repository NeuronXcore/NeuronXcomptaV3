import { useState, useEffect } from 'react'
import {
  useOperationSuggestions,
  useJustificatifSuggestions,
  useManualAssociate,
} from '@/hooks/useRapprochement'
import { useDissociate } from '@/hooks/useJustificatifs'
import { useJustificatifs } from '@/hooks/useJustificatifs'
import { formatCurrency, cn } from '@/lib/utils'
import {
  X, Link, Unlink, Loader2, Paperclip, FileText,
  CheckCircle, ChevronDown, ChevronUp, AlertCircle,
} from 'lucide-react'
import type { Operation, RapprochementSuggestion } from '@/types'

interface RapprochementDrawerProps {
  open: boolean
  onClose: () => void
  mode: 'operation' | 'justificatif'
  operationFile?: string
  operationIndex?: number
  operation?: Operation
  justificatifFilename?: string
}

const CONFIDENCE_COLORS: Record<string, { bg: string; text: string }> = {
  fort: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  probable: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  possible: { bg: 'bg-amber-500/15', text: 'text-amber-400' },
  faible: { bg: 'bg-zinc-500/15', text: 'text-text-muted' },
}

const CONFIDENCE_BAR: Record<string, string> = {
  fort: 'bg-emerald-500',
  probable: 'bg-emerald-400',
  possible: 'bg-amber-500',
  faible: 'bg-zinc-500',
}

export default function RapprochementDrawer({
  open,
  onClose,
  mode,
  operationFile,
  operationIndex,
  operation,
  justificatifFilename,
}: RapprochementDrawerProps) {
  const [successMsg, setSuccessMsg] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualJustificatif, setManualJustificatif] = useState('')

  // Queries
  const { data: opSuggestions, isLoading: opSugLoading } = useOperationSuggestions(
    mode === 'operation' && open ? operationFile ?? null : null,
    mode === 'operation' && open ? operationIndex ?? null : null,
  )
  const { data: justSuggestions, isLoading: justSugLoading } = useJustificatifSuggestions(
    mode === 'justificatif' && open ? justificatifFilename ?? null : null,
  )

  // Justificatifs en attente pour association manuelle
  const { data: pendingJustificatifs } = useJustificatifs({
    status: 'en_attente',
    search: '',
    sort_by: 'date',
    sort_order: 'desc',
  })

  const associateMutation = useManualAssociate()
  const dissociateMutation = useDissociate()

  const suggestions = mode === 'operation' ? opSuggestions : justSuggestions
  const isLoading = mode === 'operation' ? opSugLoading : justSugLoading

  // Reset on change
  useEffect(() => {
    setSuccessMsg('')
    setManualOpen(false)
    setManualJustificatif('')
  }, [operationFile, operationIndex, justificatifFilename])

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleAssociate = (suggestion: RapprochementSuggestion) => {
    associateMutation.mutate(
      {
        justificatif_filename: suggestion.justificatif_filename,
        operation_file: suggestion.operation_file,
        operation_index: suggestion.operation_index,
        rapprochement_score: suggestion.score.total,
      },
      {
        onSuccess: () => {
          setSuccessMsg('Association effectuée')
          setTimeout(() => setSuccessMsg(''), 3000)
        },
      }
    )
  }

  const handleManualAssociateJustificatif = () => {
    if (!manualJustificatif || !operationFile || operationIndex === undefined) return
    associateMutation.mutate(
      {
        justificatif_filename: manualJustificatif,
        operation_file: operationFile,
        operation_index: operationIndex,
      },
      {
        onSuccess: () => {
          setSuccessMsg('Association effectuée')
          setManualOpen(false)
          setTimeout(() => setSuccessMsg(''), 3000)
        },
      }
    )
  }

  const handleDissociate = () => {
    if (!operationFile || operationIndex === undefined) return
    dissociateMutation.mutate(
      { operation_file: operationFile, operation_index: operationIndex },
      {
        onSuccess: () => {
          setSuccessMsg('Dissociation effectuée')
          setTimeout(() => setSuccessMsg(''), 3000)
        },
      }
    )
  }

  // Is this an already-associated operation?
  const isAssociated = mode === 'operation' && operation?.Justificatif

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[600px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              {mode === 'operation' ? (
                <Paperclip size={18} className="text-primary" />
              ) : (
                <FileText size={18} className="text-primary" />
              )}
            </div>
            <div className="min-w-0">
              {mode === 'operation' && operation ? (
                <>
                  <p className="text-sm font-semibold text-text truncate">{operation['Libellé']}</p>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span>{operation.Date?.slice(0, 10)}</span>
                    <span>·</span>
                    <span className={operation['Débit'] > 0 ? 'text-red-400' : 'text-emerald-400'}>
                      {formatCurrency(Math.max(operation['Débit'] || 0, operation['Crédit'] || 0))}
                    </span>
                    {isAssociated && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400">
                        Associé{operation.rapprochement_mode === 'auto' ? ' (auto)' : ''}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-text truncate">{justificatifFilename}</p>
                  <p className="text-xs text-text-muted">Recherche d'opérations correspondantes</p>
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {successMsg && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm">
              <CheckCircle size={14} />
              {successMsg}
            </div>
          )}

          {/* Already associated: show dissociate option */}
          {isAssociated ? (
            <AssociatedSection
              operation={operation!}
              onDissociate={handleDissociate}
              dissociating={dissociateMutation.isPending}
            />
          ) : (
            <>
              {/* Suggestions */}
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Link size={14} className="text-primary" />
                  Suggestions de rapprochement
                </h3>

                {isLoading ? (
                  <div className="flex items-center gap-2 text-text-muted text-sm py-4">
                    <Loader2 size={14} className="animate-spin" />
                    Calcul des correspondances...
                  </div>
                ) : !suggestions || suggestions.length === 0 ? (
                  <div className="text-text-muted text-sm py-3 flex items-center gap-2">
                    <AlertCircle size={14} />
                    Aucune correspondance trouvée
                  </div>
                ) : (
                  <div className="space-y-2">
                    {suggestions.map((s) => (
                      <SuggestionCard
                        key={`${s.operation_file}_${s.operation_index}_${s.justificatif_filename}`}
                        suggestion={s}
                        mode={mode}
                        onAssociate={() => handleAssociate(s)}
                        associating={associateMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Manual association (only in operation mode) */}
              {mode === 'operation' && (
                <div className="border-t border-border pt-3">
                  <button
                    onClick={() => setManualOpen(!manualOpen)}
                    className="flex items-center gap-2 text-xs text-text-muted hover:text-text transition-colors"
                  >
                    {manualOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    Associer manuellement un justificatif
                  </button>

                  {manualOpen && (
                    <div className="mt-3 space-y-2">
                      <select
                        value={manualJustificatif}
                        onChange={e => setManualJustificatif(e.target.value)}
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                      >
                        <option value="">Sélectionner un justificatif...</option>
                        {pendingJustificatifs?.map(j => (
                          <option key={j.filename} value={j.filename}>
                            {j.original_name} ({j.date})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleManualAssociateJustificatif}
                        disabled={!manualJustificatif || associateMutation.isPending}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        <Link size={14} />
                        Confirmer l'association
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}


// ──── Suggestion Card ────

function SuggestionCard({
  suggestion,
  mode,
  onAssociate,
  associating,
}: {
  suggestion: RapprochementSuggestion
  mode: 'operation' | 'justificatif'
  onAssociate: () => void
  associating: boolean
}) {
  const { score } = suggestion
  const colors = CONFIDENCE_COLORS[score.confidence_level] || CONFIDENCE_COLORS.faible
  const barColor = CONFIDENCE_BAR[score.confidence_level] || CONFIDENCE_BAR.faible

  return (
    <div className="bg-surface rounded-lg border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-background rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', barColor)}
              style={{ width: `${Math.round(score.total * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-text-muted">
            {Math.round(score.total * 100)}%
          </span>
          <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-medium', colors.bg, colors.text)}>
            {score.confidence_level}
          </span>
        </div>
        <button
          onClick={onAssociate}
          disabled={associating}
          className="flex items-center gap-1 px-2.5 py-1 bg-primary/15 text-primary text-xs rounded-lg hover:bg-primary/25 transition-colors disabled:opacity-50"
        >
          {associating ? <Loader2 size={11} className="animate-spin" /> : <Link size={11} />}
          Associer
        </button>
      </div>

      {mode === 'operation' ? (
        <>
          <p className="text-xs text-text truncate">
            <FileText size={11} className="inline mr-1 text-text-muted" />
            {suggestion.justificatif_filename}
          </p>
        </>
      ) : (
        <>
          <p className="text-xs text-text truncate">{suggestion.operation_libelle}</p>
          <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1">
            <span>{suggestion.operation_date}</span>
            <span className="text-red-400">{formatCurrency(suggestion.operation_montant)}</span>
          </div>
        </>
      )}

      {/* Score detail */}
      <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1.5">
        <span>Montant: {Math.round(score.detail.montant * 100)}%</span>
        <span>Date: {Math.round(score.detail.date * 100)}%</span>
        <span>Fournisseur: {Math.round(score.detail.fournisseur * 100)}%</span>
      </div>
    </div>
  )
}


// ──── Associated Section ────

function AssociatedSection({
  operation,
  onDissociate,
  dissociating,
}: {
  operation: Operation
  onDissociate: () => void
  dissociating: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle size={16} className="text-emerald-400" />
          <h3 className="text-sm font-semibold text-text">Justificatif associé</h3>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Fichier</span>
            <span className="text-text">{operation['Lien justificatif']?.split('/').pop() || '-'}</span>
          </div>
          {operation.rapprochement_mode && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Mode</span>
              <span className={cn(
                'px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                operation.rapprochement_mode === 'auto'
                  ? 'bg-blue-500/15 text-blue-400'
                  : 'bg-primary/15 text-primary'
              )}>
                {operation.rapprochement_mode === 'auto' ? 'Automatique' : 'Manuel'}
              </span>
            </div>
          )}
          {operation.rapprochement_score != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Score</span>
              <span className="text-text">{Math.round(operation.rapprochement_score * 100)}%</span>
            </div>
          )}
          {operation.rapprochement_date && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Date</span>
              <span className="text-text">{operation.rapprochement_date.slice(0, 10)}</span>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={onDissociate}
        disabled={dissociating}
        className="flex items-center gap-2 px-3 py-2 bg-amber-500/15 text-amber-400 rounded-lg text-xs hover:bg-amber-500/25 transition-colors disabled:opacity-50"
      >
        {dissociating ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
        Dissocier ce justificatif
      </button>
    </div>
  )
}
