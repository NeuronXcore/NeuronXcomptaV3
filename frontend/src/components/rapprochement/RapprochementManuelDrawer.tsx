import { useState, useEffect } from 'react'
import { useRapprochementManuel } from '@/hooks/useRapprochementManuel'
import type { JustificatifSuggestion } from '@/hooks/useRapprochementManuel'
import { formatCurrency, cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import {
  X, Search, Calendar, DollarSign, FileText, Check,
  RotateCcw, Eye, Loader2,
} from 'lucide-react'
import ReconstituerButton from '@/components/ocr/ReconstituerButton'

interface Props {
  isOpen: boolean
  onClose: () => void
  filename: string | null
  operation: {
    index: number
    date: string
    libelle: string
    debit: number
    credit: number
  } | null
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color =
    pct >= 70
      ? 'bg-emerald-500/20 text-emerald-400'
      : pct >= 40
        ? 'bg-amber-500/20 text-amber-400'
        : 'bg-red-500/20 text-red-400'

  return (
    <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-mono font-semibold', color)}>
      {pct}%
    </span>
  )
}

export default function RapprochementManuelDrawer({
  isOpen,
  onClose,
  filename,
  operation,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<string | null>(null)

  const {
    filters,
    updateFilter,
    resetFilters,
    suggestions,
    isLoading,
    associate,
  } = useRapprochementManuel(filename, operation?.index ?? null)

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setSelectedFile(null)
      setPreviewFile(null)
      resetFilters()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const handleAssociate = () => {
    if (!selectedFile || !operation || !filename) return
    const suggestion = suggestions.find(s => s.filename === selectedFile)
    associate.mutate(
      {
        operation_index: operation.index,
        justificatif_filename: selectedFile,
        rapprochement_score: suggestion?.score,
      },
      {
        onSuccess: () => {
          toast.success('Association effectuée avec succès')
          onClose()
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Erreur lors de l'association")
        },
      },
    )
  }

  const montant = operation
    ? Math.max(operation.debit || 0, operation.credit || 0)
    : 0

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[800px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* A. Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-text">Rapprochement manuel</h2>
              {operation && (
                <p className="text-xs text-text-muted mt-0.5 truncate">
                  {operation.libelle} — {formatCurrency(montant)} — {operation.date?.slice(0, 10)}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* B. Filtres */}
        <div className="px-4 py-3 border-b border-border space-y-2 shrink-0">
          {/* Ligne 1 : recherche fournisseur */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Rechercher par fournisseur..."
              value={filters.search}
              onChange={e => updateFilter('search', e.target.value)}
              className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
            />
          </div>

          {/* Ligne 2 : grille 4 colonnes */}
          <div className="grid grid-cols-4 gap-2">
            <div className="relative">
              <DollarSign size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="number"
                placeholder="Montant min"
                value={filters.montantMin}
                onChange={e => updateFilter('montantMin', e.target.value)}
                className="w-full bg-surface border border-border rounded-lg pl-7 pr-2 py-1.5 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
              />
            </div>
            <div className="relative">
              <DollarSign size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="number"
                placeholder="Montant max"
                value={filters.montantMax}
                onChange={e => updateFilter('montantMax', e.target.value)}
                className="w-full bg-surface border border-border rounded-lg pl-7 pr-2 py-1.5 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
              />
            </div>
            <div className="relative">
              <Calendar size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="date"
                value={filters.dateFrom}
                onChange={e => updateFilter('dateFrom', e.target.value)}
                className="w-full bg-surface border border-border rounded-lg pl-7 pr-2 py-1.5 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
              />
            </div>
            <div className="relative">
              <Calendar size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="date"
                value={filters.dateTo}
                onChange={e => updateFilter('dateTo', e.target.value)}
                className="w-full bg-surface border border-border rounded-lg pl-7 pr-2 py-1.5 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Ligne 3 : reset + compteur */}
          <div className="flex items-center justify-between">
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text transition-colors"
            >
              <RotateCcw size={11} />
              Réinitialiser les filtres
            </button>
            <span className="text-[11px] text-text-muted">
              {isLoading ? '...' : `${suggestions.length} justificatif(s)`}
            </span>
          </div>
        </div>

        {/* C. Zone scrollable split */}
        <div className="flex-1 overflow-hidden flex min-h-0">
          {/* Panneau gauche — Liste */}
          <div
            className={cn(
              'overflow-y-auto border-r border-border',
              previewFile ? 'w-[320px] shrink-0' : 'w-full',
            )}
          >
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={20} className="animate-spin text-text-muted" />
              </div>
            ) : suggestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-3">
                <FileText size={28} className="opacity-20 mb-2" />
                <p>Aucun justificatif trouvé</p>
                {filename && operation && (
                  <ReconstituerButton
                    operationFile={filename}
                    operationIndex={operation.index}
                    libelle={operation.libelle}
                    size="md"
                  />
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {suggestions.map((s) => (
                  <SuggestionItem
                    key={s.filename}
                    suggestion={s}
                    isSelected={selectedFile === s.filename}
                    isPreviewed={previewFile === s.filename}
                    onSelect={() => setSelectedFile(s.filename)}
                    onTogglePreview={(e) => {
                      e.stopPropagation()
                      setPreviewFile(prev =>
                        prev === s.filename ? null : s.filename,
                      )
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Panneau droit — Preview PDF */}
          {previewFile && (
            <div className="flex-1 bg-background">
              <iframe
                src={`/api/justificatifs/${previewFile}/preview`}
                className="w-full h-full border-0"
                title="Preview PDF"
              />
            </div>
          )}
        </div>

        {/* D. Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-text-muted min-w-0">
            {selectedFile ? (
              <>
                <Check size={14} className="text-emerald-400 shrink-0" />
                <span className="truncate text-text">Sélectionné : {selectedFile}</span>
              </>
            ) : (
              <span>Cliquez sur un justificatif pour le sélectionner...</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs border border-border rounded-lg text-text-muted hover:text-text hover:bg-surface transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleAssociate}
              disabled={!selectedFile || associate.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {associate.isPending && <Loader2 size={12} className="animate-spin" />}
              Associer
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ──── Suggestion Item ────

function SuggestionItem({
  suggestion,
  isSelected,
  isPreviewed,
  onSelect,
  onTogglePreview,
}: {
  suggestion: JustificatifSuggestion
  isSelected: boolean
  isPreviewed: boolean
  onSelect: () => void
  onTogglePreview: (e: React.MouseEvent) => void
}) {
  const displayName = suggestion.ocr_fournisseur || suggestion.filename
  const showFilename = !!suggestion.ocr_fournisseur

  return (
    <div
      onClick={onSelect}
      className={cn(
        'px-3 py-2.5 cursor-pointer transition-colors group',
        isSelected
          ? 'bg-primary/10 border-l-2 border-l-primary'
          : 'hover:bg-surface-hover border-l-2 border-l-transparent',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText size={14} className="text-text-muted shrink-0" />
          <span className="text-xs text-text truncate">{displayName}</span>
          <ScoreBadge score={suggestion.score} />
        </div>
        <button
          onClick={onTogglePreview}
          className={cn(
            'p-1 rounded transition-colors shrink-0',
            isPreviewed
              ? 'text-primary bg-primary/10'
              : 'text-text-muted hover:text-text opacity-0 group-hover:opacity-100',
          )}
        >
          <Eye size={14} />
        </button>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1 ml-6">
        {suggestion.ocr_date && (
          <span className="flex items-center gap-0.5">
            <Calendar size={9} />
            {suggestion.ocr_date.slice(0, 10)}
          </span>
        )}
        {suggestion.ocr_montant != null && (
          <span className="flex items-center gap-0.5">
            <DollarSign size={9} />
            {formatCurrency(suggestion.ocr_montant)}
          </span>
        )}
        <span>{suggestion.size_human}</span>
      </div>

      {showFilename && (
        <p className="text-[9px] text-text-muted mt-0.5 ml-6 truncate opacity-60">
          {suggestion.filename}
        </p>
      )}
    </div>
  )
}
