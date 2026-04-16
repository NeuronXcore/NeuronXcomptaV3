import React, { useEffect, useRef } from 'react'
import {
  X,
  Search,
  Link2,
  ChevronRight,
  SkipForward,
  Sparkles,
  Eye,
  CalendarDays,
  Euro,
  Lock,
  LockOpen,
  Loader2,
  Check,
  ExternalLink,
} from 'lucide-react'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import PdfThumbnail from '@/components/shared/PdfThumbnail'
import ScorePills from '@/components/justificatifs/ScorePills'
import { UnlockConfirmModal } from '@/components/UnlockConfirmModal'
import PreviewSubDrawer from '@/components/ocr/PreviewSubDrawer'
import { useJustifToOp } from '@/hooks/useJustifToOp'
import type { JustificatifInfo, RapprochementSuggestion } from '@/types'

interface JustifToOpDrawerProps {
  open: boolean
  onClose: () => void
  initialFilename?: string
}

const DRAWER_WIDTH = 1000

export default function JustifToOpDrawer({
  open,
  onClose,
  initialFilename,
}: JustifToOpDrawerProps) {
  const h = useJustifToOp({ open, initialFilename, onClose })

  // Scroll-into-view du justif sélectionné (utile à l'ouverture sur initialFilename)
  const selectedRowRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!open) return
    selectedRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [open, h.selectedFilename])

  // ─── Raccourcis clavier ───
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (typing) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        h.goToNextJustif()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        h.goToPrevJustif()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const advanced = h.goToNextJustif()
        if (!advanced) onClose()
      } else if (e.key === 'Enter' && h.suggestions.length > 0) {
        e.preventDefault()
        const top = h.suggestions[0]
        if (top.score?.total >= 0.8 && !top.op_locked) {
          h.associate(top).then(ok => {
            if (ok) {
              const advanced = h.goToNextJustif()
              if (!advanced) onClose()
            }
          })
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, h])

  const handleAssociate = async (s: RapprochementSuggestion) => {
    const ok = await h.associate(s)
    if (ok) {
      const advanced = h.goToNextJustif()
      if (!advanced) onClose()
    }
  }

  const handleSkip = () => {
    const advanced = h.goToNextJustif()
    if (!advanced) onClose()
  }

  const navigateToOp = (s: RapprochementSuggestion) => {
    const params = new URLSearchParams({
      file: s.operation_file,
      highlight: String(s.operation_index),
      filter: 'sans',
    })
    onClose()
    window.location.href = `/justificatifs?${params.toString()}`
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/40 transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        style={{ zIndex: 60 }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full bg-background border-l border-border shadow-2xl',
          'transition-transform duration-300 flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ width: `${DRAWER_WIDTH}px`, maxWidth: '95vw', zIndex: 70 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Link2 size={18} className="text-primary" />
            <h2 className="text-sm font-semibold text-text">
              Rechercher une opération pour ce justificatif
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text hover:bg-surface rounded-md transition-colors"
            title="Fermer (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-row flex-1 min-h-0">
          {/* Panel justificatifs (300px) */}
          <div className="w-[300px] flex-shrink-0 border-r border-border flex flex-col">
            <div className="px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
                  En attente
                </span>
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary tabular-nums font-medium">
                  {h.filteredJustifs.length}
                </span>
              </div>
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type="text"
                  value={h.justifSearch}
                  onChange={e => h.setJustifSearch(e.target.value)}
                  placeholder="Rechercher (filename, fournisseur)…"
                  className="w-full pl-7 pr-2 py-1.5 text-xs bg-surface border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {h.isLoadingJustifs && (
                <div className="p-6 text-center text-xs text-text-muted">Chargement…</div>
              )}
              {!h.isLoadingJustifs && h.isEmpty && (
                <div className="p-6 text-center space-y-3">
                  <p className="text-xs text-text-muted leading-relaxed">
                    Aucun justificatif en attente.
                  </p>
                </div>
              )}
              {!h.isLoadingJustifs &&
                !h.isEmpty &&
                h.filteredJustifs.length === 0 && (
                  <div className="p-6 text-center text-xs text-text-muted">
                    Aucun résultat pour « {h.justifSearch} ».
                  </div>
                )}
              {h.filteredJustifs.map(j => (
                <JustifRow
                  key={j.filename}
                  justif={j}
                  selected={j.filename === h.selectedFilename}
                  previewing={j.filename === h.previewFilename}
                  onSelect={() => h.setSelectedFilename(j.filename)}
                  onTogglePreview={() => h.togglePreview(j.filename)}
                  ref={j.filename === h.selectedFilename ? selectedRowRef : null}
                  // Édition inline OCR (uniquement sur la row sélectionnée)
                  editDate={h.editDate}
                  setEditDate={h.setEditDate}
                  editAmount={h.editAmount}
                  setEditAmount={h.setEditAmount}
                  editSupplier={h.editSupplier}
                  setEditSupplier={h.setEditSupplier}
                  canSaveOcr={h.canSaveOcr}
                  saveOcrEdit={h.saveOcrEdit}
                  isSavingOcr={h.isSavingOcr}
                />
              ))}
            </div>
          </div>

          {/* Panel ops candidates (flex-1) */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
                    Opérations candidates
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary tabular-nums font-medium">
                    {h.suggestions.length}
                  </span>
                </div>
                <span className="text-[10px] text-text-muted italic">
                  trié par meilleur score
                </span>
              </div>
              {h.selectedJustif && (
                <div className="text-[11px] italic text-text-muted truncate">
                  Justificatif :{' '}
                  <span className="text-text">
                    {h.selectedJustif.ocr_supplier ||
                      parseFournisseurFromFilename(h.selectedJustif.filename)}
                  </span>
                  {h.selectedJustif.ocr_date && (
                    <>
                      {' · '}
                      <span className="text-sky-400 tabular-nums">
                        {formatDate(h.selectedJustif.ocr_date)}
                      </span>
                    </>
                  )}
                  {h.selectedJustif.ocr_amount != null && (
                    <>
                      {' · '}
                      <span className="text-amber-400 tabular-nums">
                        {formatCurrency(h.selectedJustif.ocr_amount)}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {h.isLoadingSuggestions && (
                <div className="p-6 text-center text-xs text-text-muted">Chargement…</div>
              )}
              {!h.isLoadingSuggestions && !h.selectedFilename && (
                <div className="p-6 text-center text-xs text-text-muted">
                  Sélectionnez un justificatif à gauche.
                </div>
              )}
              {!h.isLoadingSuggestions &&
                h.selectedFilename &&
                h.suggestions.length === 0 && (
                  <div className="p-6 text-center space-y-2">
                    <p className="text-xs text-text-muted">
                      Aucune opération candidate trouvée.
                    </p>
                    <p className="text-[11px] text-text-muted/70 italic">
                      Vérifiez les données OCR (date, montant) — corrigez-les à gauche pour
                      relancer la recherche.
                    </p>
                  </div>
                )}
              {h.suggestions.map((s, idx) => (
                <OpCandidateRow
                  key={`${s.operation_file}:${s.operation_index}:${s.ventilation_index ?? 'no-vl'}`}
                  suggestion={s}
                  isBestMatch={idx === 0 && s.score?.total >= 0.8}
                  loading={h.associateLoading}
                  onAssociate={() => handleAssociate(s)}
                  onView={() => navigateToOp(s)}
                  onUnlock={() => h.requestUnlock(s)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0">
          <div className="text-xs text-text-muted tabular-nums">
            {h.filteredJustifs.length > 0 && h.currentIdx >= 0 ? (
              <>
                {h.currentIdx + 1} / {h.filteredJustifs.length} justif. ·{' '}
                {h.suggestions.length} opération
                {h.suggestions.length > 1 ? 's' : ''} candidate
                {h.suggestions.length > 1 ? 's' : ''}
              </>
            ) : (
              <>
                {h.filteredJustifs.length} justif. · {h.suggestions.length} candidate
                {h.suggestions.length > 1 ? 's' : ''}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSkip}
              disabled={!h.selectedFilename}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border-secondary rounded-md hover:bg-surface text-text-muted hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <SkipForward size={13} />
              Ignorer
            </button>
            <button
              onClick={handleSkip}
              disabled={!h.selectedFilename}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Suivant
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Sous-drawer preview PDF grand format à gauche du drawer principal.
          Utilise z-65 (> backdrop z-60, < drawer principal z-70) pour venir se
          coller à gauche du JustifToOpDrawer tout en restant au-dessus du
          backdrop du drawer principal. */}
      <PreviewSubDrawer
        filename={h.previewFilename}
        mainDrawerOpen={open}
        mainDrawerWidth={DRAWER_WIDTH}
        width={700}
        onClose={() => h.setPreviewFilename(null)}
        zIndex={65}
      />

      {/* Modale unlock — z-index supérieur au drawer (z-70) */}
      <UnlockConfirmModal
        open={h.unlockTarget !== null}
        onConfirm={h.confirmUnlock}
        onCancel={h.cancelUnlock}
        loading={h.unlockLoading}
        zIndex={80}
      />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Helper : extrait fournisseur depuis filename canonique
// ─────────────────────────────────────────────────────────────────────────
function parseFournisseurFromFilename(name: string): string {
  const m = name.match(/^([a-z0-9-]+)_/i)
  return m ? m[1] : name.replace(/\.pdf$/i, '')
}

function computeDeltaJours(opDateStr: string | null, ocrDateStr: string | null): number | null {
  if (!opDateStr || !ocrDateStr) return null
  const op = new Date(opDateStr).getTime()
  const oc = new Date(ocrDateStr).getTime()
  if (isNaN(op) || isNaN(oc)) return null
  return Math.round((oc - op) / 86_400_000)
}

// ─────────────────────────────────────────────────────────────────────────
// Row justificatif (panneau gauche) avec édition inline OCR si sélectionné
// ─────────────────────────────────────────────────────────────────────────

interface JustifRowProps {
  justif: JustificatifInfo
  selected: boolean
  previewing: boolean
  onSelect: () => void
  onTogglePreview: () => void
  // Édition inline OCR (uniquement utilisée si selected)
  editDate: string
  setEditDate: (v: string) => void
  editAmount: string
  setEditAmount: (v: string) => void
  editSupplier: string
  setEditSupplier: (v: string) => void
  canSaveOcr: boolean
  saveOcrEdit: () => void
  isSavingOcr: boolean
}

const JustifRow = React.forwardRef<HTMLButtonElement, JustifRowProps>(function JustifRow(
  {
    justif,
    selected,
    previewing,
    onSelect,
    onTogglePreview,
    editDate,
    setEditDate,
    editAmount,
    setEditAmount,
    editSupplier,
    setEditSupplier,
    canSaveOcr,
    saveOcrEdit,
    isSavingOcr,
  },
  ref,
) {
  const hasOcrPartiel = !justif.ocr_date || justif.ocr_amount == null
  const fournisseur = justif.ocr_supplier || parseFournisseurFromFilename(justif.filename)

  return (
    <div
      className={cn(
        'border-b border-border',
        selected && 'bg-primary/5',
        !selected && previewing && 'bg-primary/5',
      )}
    >
      <button
        ref={ref}
        onClick={onSelect}
        className={cn(
          'w-full text-left px-3 py-2 flex items-stretch gap-2 relative transition-colors',
          selected && 'border-l-2 border-l-primary',
          !selected && 'border-l-2 border-l-transparent hover:bg-surface',
        )}
      >
        {/* Thumbnail cliquable preview */}
        <span
          role="button"
          tabIndex={0}
          onClick={e => {
            e.stopPropagation()
            onTogglePreview()
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              onTogglePreview()
            }
          }}
          className={cn(
            'relative w-[32px] h-[38px] rounded border flex-shrink-0 overflow-hidden group/thumb cursor-pointer',
            previewing
              ? 'border-primary'
              : 'border-border-secondary hover:border-primary/50',
          )}
          title="Ouvrir l'aperçu"
        >
          <PdfThumbnail
            justificatifFilename={justif.filename}
            lazy
            className="w-full h-full"
            iconSize={14}
          />
          <span className="absolute inset-0 bg-primary/60 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
            <Eye size={12} className="text-white" />
          </span>
        </span>

        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="text-xs text-text font-medium truncate"
              title={justif.filename}
            >
              {fournisseur}
            </span>
            {hasOcrPartiel && (
              <span
                className="px-1 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[9px] font-medium flex-shrink-0"
                title="OCR partiel : date ou montant manquant"
              >
                OCR partiel
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-[10px] tabular-nums">
            {justif.ocr_date ? (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-sky-500/15 text-sky-400">
                <CalendarDays size={9} />
                {formatDate(justif.ocr_date)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-zinc-500/15 text-text-muted/70 italic">
                <CalendarDays size={9} /> n/a
              </span>
            )}
            {justif.ocr_amount != null ? (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-500/15 text-amber-400">
                <Euro size={9} />
                {formatCurrency(justif.ocr_amount)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-zinc-500/15 text-text-muted/70 italic">
                <Euro size={9} /> n/a
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Zone édition inline OCR — uniquement sur la row sélectionnée */}
      {selected && (
        <div
          className="px-3 py-2.5 border-t border-border bg-surface/50 space-y-2"
          onClick={e => e.stopPropagation()}
        >
          <div className="text-[9px] uppercase text-text-muted tracking-wider font-medium">
            Corriger les données OCR
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              value={editDate}
              onChange={e => setEditDate(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="text-[11px] px-1.5 py-1 bg-background border border-border rounded focus:outline-none focus:border-primary tabular-nums"
            />
            <input
              type="number"
              step="0.01"
              value={editAmount}
              onChange={e => setEditAmount(e.target.value)}
              placeholder="Montant"
              className="text-[11px] px-1.5 py-1 bg-background border border-border rounded focus:outline-none focus:border-primary tabular-nums"
            />
          </div>
          <input
            type="text"
            value={editSupplier}
            onChange={e => setEditSupplier(e.target.value)}
            placeholder="Fournisseur"
            className="w-full text-[11px] px-1.5 py-1 bg-background border border-border rounded focus:outline-none focus:border-primary"
          />
          <button
            onClick={saveOcrEdit}
            disabled={!canSaveOcr || isSavingOcr}
            className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSavingOcr ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Check size={11} />
            )}
            Appliquer & relancer
          </button>
        </div>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────
// Row opération candidate (panneau droit)
// ─────────────────────────────────────────────────────────────────────────
interface OpCandidateRowProps {
  suggestion: RapprochementSuggestion
  isBestMatch: boolean
  loading: boolean
  onAssociate: () => void
  onView: () => void
  onUnlock: () => void
}

function OpCandidateRow({
  suggestion,
  isBestMatch,
  loading,
  onAssociate,
  onView,
  onUnlock,
}: OpCandidateRowProps) {
  const isLocked = !!suggestion.op_locked
  const detail = suggestion.score?.detail
  const total = suggestion.score?.total ?? 0
  // Pas de date OCR ici (côté ops, pas de delta jours utile sans champ ocr) — on calcule depuis suggestion
  const deltaJours = computeDeltaJours(suggestion.operation_date, suggestion.operation_date)

  return (
    <div
      className={cn(
        'flex items-stretch gap-3 px-4 py-2.5 border-b border-border transition-colors',
        isBestMatch && 'bg-emerald-500/10 border-l-2 border-l-emerald-500',
        !isBestMatch && 'border-l-2 border-l-transparent hover:bg-surface',
      )}
    >
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-xs text-text font-medium truncate"
            title={suggestion.operation_libelle}
          >
            {suggestion.operation_libelle}
          </span>
          {isBestMatch && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-medium flex-shrink-0"
              title="Meilleur score"
            >
              <Sparkles size={9} /> Meilleur match
            </span>
          )}
          {isLocked && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-warning/20 text-warning text-[9px] font-medium flex-shrink-0"
              title={`Opération verrouillée${suggestion.op_locked_at ? ` depuis ${suggestion.op_locked_at}` : ''}`}
            >
              <Lock size={9} /> Verrouillée
            </span>
          )}
          {suggestion.ventilation_index != null && (
            <span
              className="px-1 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-medium flex-shrink-0"
              title="Sous-ligne ventilée"
            >
              L{suggestion.ventilation_index + 1}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap text-[11px] tabular-nums">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 font-medium">
            <CalendarDays size={10} />
            {formatDate(suggestion.operation_date)}
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">
            <Euro size={10} />
            {formatCurrency(suggestion.operation_montant)}
          </span>
        </div>

        {detail && (
          <ScorePills
            detail={{
              montant: detail.montant,
              date: detail.date,
              fournisseur: detail.fournisseur,
              categorie: detail.categorie ?? null,
            }}
            total={total}
            deltaJours={deltaJours}
          />
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isLocked && (
          <button
            onClick={onUnlock}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-md border border-warning/40 text-warning hover:bg-warning/10 transition-colors"
            title="Déverrouiller cette opération"
          >
            <LockOpen size={12} />
            Déverrouiller
          </button>
        )}
        <button
          onClick={onView}
          className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-md border border-border-secondary text-text-muted hover:bg-surface hover:text-text transition-colors"
          title="Voir l'opération dans Justificatifs"
        >
          <ExternalLink size={12} />
        </button>
        <button
          onClick={onAssociate}
          disabled={isLocked || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={isLocked ? 'Op verrouillée — déverrouillez d\'abord' : 'Associer ce justificatif à cette opération'}
        >
          <Link2 size={12} />
          Associer
        </button>
      </div>
    </div>
  )
}
