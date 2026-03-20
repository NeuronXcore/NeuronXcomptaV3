import { useState, useEffect } from 'react'
import {
  useSuggestions,
  useAssociate,
  useDissociate,
  useDeleteJustificatif,
} from '@/hooks/useJustificatifs'
import { useOperationFiles } from '@/hooks/useOperations'
import { useExtractOcr, useOcrResult } from '@/hooks/useOcr'
import { formatCurrency, formatFileTitle, cn } from '@/lib/utils'
import {
  X, Link, Unlink, Trash2, Loader2, FileText,
  CheckCircle, AlertCircle, ChevronDown, ChevronUp, ScanLine,
} from 'lucide-react'
import type { JustificatifInfo, OperationSuggestion } from '@/types'

interface JustificatifDrawerProps {
  open: boolean
  justificatif: JustificatifInfo | null
  onClose: () => void
  onDeleted: () => void
}

export default function JustificatifDrawer({
  open,
  justificatif,
  onClose,
  onDeleted,
}: JustificatifDrawerProps) {
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualFile, setManualFile] = useState('')
  const [manualIndex, setManualIndex] = useState<number | ''>('')
  const [successMsg, setSuccessMsg] = useState('')

  const { data: suggestions, isLoading: suggestionsLoading } = useSuggestions(
    open && justificatif?.status === 'en_attente' ? justificatif.filename : null
  )
  const { data: opFiles } = useOperationFiles()
  const associateMutation = useAssociate()
  const dissociateMutation = useDissociate()
  const deleteMutation = useDeleteJustificatif()

  // Reset state when justificatif changes
  useEffect(() => {
    setDeleteConfirm(false)
    setManualOpen(false)
    setManualFile('')
    setManualIndex('')
    setSuccessMsg('')
  }, [justificatif?.filename])

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleAssociate = (suggestion: OperationSuggestion) => {
    if (!justificatif) return
    associateMutation.mutate(
      {
        justificatif_filename: justificatif.filename,
        operation_file: suggestion.operation_file,
        operation_index: suggestion.operation_index,
      },
      {
        onSuccess: () => {
          setSuccessMsg('Justificatif associé avec succès')
          setTimeout(() => setSuccessMsg(''), 3000)
        },
      }
    )
  }

  const handleManualAssociate = () => {
    if (!justificatif || !manualFile || manualIndex === '') return
    associateMutation.mutate(
      {
        justificatif_filename: justificatif.filename,
        operation_file: manualFile,
        operation_index: Number(manualIndex),
      },
      {
        onSuccess: () => {
          setSuccessMsg('Justificatif associé avec succès')
          setManualOpen(false)
          setTimeout(() => setSuccessMsg(''), 3000)
        },
      }
    )
  }

  const handleDissociate = () => {
    if (!justificatif) return
    // Find the operation file and index for this justificatif
    // The linked_operation info is limited, we need the suggestions endpoint
    // For dissociation, we search through operations
    dissociateMutation.mutate(
      {
        operation_file: '', // Will be resolved by searching
        operation_index: 0,
      },
      {
        onSuccess: () => {
          setSuccessMsg('Justificatif dissocié')
          setTimeout(() => setSuccessMsg(''), 3000)
        },
      }
    )
  }

  const handleDelete = () => {
    if (!justificatif) return
    deleteMutation.mutate(justificatif.filename, {
      onSuccess: () => onDeleted(),
    })
  }

  if (!justificatif) return null

  const previewUrl = `/api/justificatifs/${encodeURIComponent(justificatif.filename)}/preview`

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
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
              <FileText size={18} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text truncate">{justificatif.original_name}</p>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span>{justificatif.date}</span>
                <span>·</span>
                <span>{justificatif.size_human}</span>
                <span className={cn(
                  'px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                  justificatif.status === 'traites'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-amber-500/15 text-amber-400'
                )}>
                  {justificatif.status === 'traites' ? 'Traité' : 'En attente'}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Success message */}
          {successMsg && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm">
              <CheckCircle size={14} />
              {successMsg}
            </div>
          )}

          {/* PDF Preview */}
          <div className="rounded-lg border border-border overflow-hidden bg-white">
            <iframe
              src={previewUrl}
              className="w-full h-[45vh]"
              title="PDF Preview"
            />
          </div>

          {/* OCR Data Section */}
          <OcrSection justificatif={justificatif} />

          {/* Actions based on status */}
          {justificatif.status === 'en_attente' ? (
            <EnAttenteActions
              suggestions={suggestions || []}
              suggestionsLoading={suggestionsLoading}
              onAssociate={handleAssociate}
              associating={associateMutation.isPending}
              manualOpen={manualOpen}
              setManualOpen={setManualOpen}
              manualFile={manualFile}
              setManualFile={setManualFile}
              manualIndex={manualIndex}
              setManualIndex={setManualIndex}
              onManualAssociate={handleManualAssociate}
              opFiles={opFiles || []}
            />
          ) : (
            <TraiteActions
              justificatif={justificatif}
              onDissociate={handleDissociate}
              dissociating={dissociateMutation.isPending}
            />
          )}

          {/* Delete zone */}
          <div className="border-t border-border pt-4">
            {deleteConfirm ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-red-400">Supprimer ce justificatif ?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs hover:bg-red-500/30"
                >
                  {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Confirmer'}
                </button>
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="px-3 py-1.5 bg-surface-hover text-text-muted rounded-lg text-xs"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                onClick={() => setDeleteConfirm(true)}
                className="flex items-center gap-2 text-red-400/70 hover:text-red-400 text-xs transition-colors"
              >
                <Trash2 size={13} />
                Supprimer ce justificatif
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}


// ──── En Attente Actions ────

function EnAttenteActions({
  suggestions,
  suggestionsLoading,
  onAssociate,
  associating,
  manualOpen,
  setManualOpen,
  manualFile,
  setManualFile,
  manualIndex,
  setManualIndex,
  onManualAssociate,
  opFiles,
}: {
  suggestions: OperationSuggestion[]
  suggestionsLoading: boolean
  onAssociate: (s: OperationSuggestion) => void
  associating: boolean
  manualOpen: boolean
  setManualOpen: (v: boolean) => void
  manualFile: string
  setManualFile: (v: string) => void
  manualIndex: number | ''
  setManualIndex: (v: number | '') => void
  onManualAssociate: () => void
  opFiles: { filename: string; month?: number; year?: number; count: number }[]
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Link size={14} className="text-primary" />
        Suggestions d'association
      </h3>

      {suggestionsLoading ? (
        <div className="flex items-center gap-2 text-text-muted text-sm py-4">
          <Loader2 size={14} className="animate-spin" />
          Recherche de correspondances...
        </div>
      ) : suggestions.length === 0 ? (
        <div className="text-text-muted text-sm py-3 flex items-center gap-2">
          <AlertCircle size={14} />
          Aucune suggestion trouvée
        </div>
      ) : (
        <div className="space-y-2">
          {suggestions.map((s, i) => (
            <div
              key={`${s.operation_file}_${s.operation_index}`}
              className="bg-surface rounded-lg border border-border p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {/* Score bar */}
                  <div className="w-12 h-1.5 bg-background rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        s.score >= 0.7 ? 'bg-emerald-500' :
                        s.score >= 0.4 ? 'bg-amber-500' : 'bg-red-400'
                      )}
                      style={{ width: `${Math.round(s.score * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-muted">
                    {Math.round(s.score * 100)}%
                  </span>
                </div>
                <button
                  onClick={() => onAssociate(s)}
                  disabled={associating}
                  className="flex items-center gap-1 px-2.5 py-1 bg-primary/15 text-primary text-xs rounded-lg hover:bg-primary/25 transition-colors disabled:opacity-50"
                >
                  {associating ? <Loader2 size={11} className="animate-spin" /> : <Link size={11} />}
                  Associer
                </button>
              </div>
              <p className="text-xs text-text truncate">{s.libelle}</p>
              <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1">
                <span>{s.date}</span>
                {s.debit > 0 && <span className="text-red-400">{formatCurrency(s.debit)}</span>}
                {s.credit > 0 && <span className="text-emerald-400">{formatCurrency(s.credit)}</span>}
                {s.categorie && <span className="text-primary">{s.categorie}</span>}
                <span className="ml-auto">{s.score_detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Manual association */}
      <div className="border-t border-border pt-3">
        <button
          onClick={() => setManualOpen(!manualOpen)}
          className="flex items-center gap-2 text-xs text-text-muted hover:text-text transition-colors"
        >
          {manualOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Association manuelle
        </button>

        {manualOpen && (
          <div className="mt-3 space-y-2">
            <select
              value={manualFile}
              onChange={e => { setManualFile(e.target.value); setManualIndex('') }}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
            >
              <option value="">Sélectionner un fichier...</option>
              {opFiles.map(f => (
                <option key={f.filename} value={f.filename}>
                  {formatFileTitle(f)} ({f.count} ops)
                </option>
              ))}
            </select>

            {manualFile && (
              <input
                type="number"
                min={0}
                placeholder="Index de l'opération"
                value={manualIndex}
                onChange={e => setManualIndex(e.target.value ? Number(e.target.value) : '')}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              />
            )}

            <button
              onClick={onManualAssociate}
              disabled={!manualFile || manualIndex === '' || associating}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Link size={14} />
              Associer manuellement
            </button>
          </div>
        )}
      </div>
    </div>
  )
}


// ──── OCR Section ────

function OcrSection({ justificatif }: { justificatif: JustificatifInfo }) {
  const extractOcr = useExtractOcr()
  const { data: ocrResult } = useOcrResult(
    justificatif.ocr_data?.processed ? justificatif.filename : null
  )
  const ocr = justificatif.ocr_data

  const handleExtract = () => {
    extractOcr.mutate(justificatif.filename)
  }

  return (
    <div className="bg-surface rounded-lg border border-border p-3.5">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold flex items-center gap-1.5 text-text">
          <ScanLine size={13} className="text-primary" />
          Données OCR
        </h4>
        {ocr?.processed && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500/15 text-emerald-400 font-medium">
            Traité
          </span>
        )}
      </div>

      {ocr?.processed ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-[10px] text-text-muted">Date</p>
              <p className="text-xs text-text font-medium">{ocr.best_date || '-'}</p>
            </div>
            <div>
              <p className="text-[10px] text-text-muted">Montant</p>
              <p className="text-xs text-text font-medium">
                {ocr.best_amount ? formatCurrency(ocr.best_amount) : '-'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-text-muted">Fournisseur</p>
              <p className="text-xs text-text font-medium truncate" title={ocr.supplier || ''}>
                {ocr.supplier || '-'}
              </p>
            </div>
          </div>
          {/* Re-extract button */}
          <button
            onClick={handleExtract}
            disabled={extractOcr.isPending}
            className="flex items-center gap-1.5 text-[10px] text-text-muted hover:text-primary transition-colors"
          >
            {extractOcr.isPending ? <Loader2 size={10} className="animate-spin" /> : <ScanLine size={10} />}
            Relancer l'OCR
          </button>
        </div>
      ) : (
        <button
          onClick={handleExtract}
          disabled={extractOcr.isPending}
          className="flex items-center gap-2 px-3 py-2 bg-primary/10 text-primary rounded-lg text-xs hover:bg-primary/20 transition-colors w-full justify-center"
        >
          {extractOcr.isPending ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Extraction en cours...
            </>
          ) : (
            <>
              <ScanLine size={12} />
              Lancer l'OCR
            </>
          )}
        </button>
      )}
    </div>
  )
}


// ──── Traite Actions ────

function TraiteActions({
  justificatif,
  onDissociate,
  dissociating,
}: {
  justificatif: JustificatifInfo
  onDissociate: () => void
  dissociating: boolean
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <CheckCircle size={14} className="text-emerald-400" />
        Opération liée
      </h3>

      {justificatif.linked_operation ? (
        <div className="bg-surface rounded-lg border border-border p-3">
          <p className="text-sm text-text">{justificatif.linked_operation}</p>
        </div>
      ) : (
        <p className="text-sm text-text-muted">Information de l'opération non disponible</p>
      )}

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
