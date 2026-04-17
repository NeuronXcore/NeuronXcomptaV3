import { useEffect } from 'react'
import {
  X,
  Search,
  Link2,
  ChevronRight,
  SkipForward,
  Sparkles,
  Globe,
  Eye,
  CalendarDays,
  Euro,
} from 'lucide-react'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import PdfThumbnail from '@/components/shared/PdfThumbnail'
import ScorePills from '@/components/justificatifs/ScorePills'
import {
  useManualAssociation,
  type TargetedOp,
  type DrawerOp,
  type DrawerSuggestion,
} from '@/hooks/useManualAssociation'

export type { TargetedOp } from '@/hooks/useManualAssociation'

interface ManualAssociationDrawerProps {
  open: boolean
  onClose: () => void
  year: number
  month: number | null
  targetedOps?: TargetedOp[]
}

const DRAWER_WIDTH_BASE = 1100
const DRAWER_WIDTH_WITH_PREVIEW = 1500
const PREVIEW_PANEL_WIDTH = 600

export default function ManualAssociationDrawer(props: ManualAssociationDrawerProps) {
  const { open, onClose, year, month, targetedOps } = props

  const h = useManualAssociation({ open, year, month, targetedOps })

  // ─── Raccourcis clavier ───
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (typing) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        h.goToNextOp()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        h.goToPrevOp()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const advanced = h.goToNextOp()
        if (!advanced) onClose()
      } else if (e.key === 'Enter' && h.filteredSuggestions.length > 0 && h.selectedOp) {
        e.preventDefault()
        const top = h.filteredSuggestions[0]
        h.associate(top.filename, top.score).then(ok => {
          if (ok) {
            const advanced = h.goToNextOp()
            if (!advanced) onClose()
          }
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, h])

  const handleAssociate = async (s: DrawerSuggestion) => {
    const ok = await h.associate(s.filename, s.score)
    if (ok) {
      const advanced = h.goToNextOp()
      if (!advanced) onClose()
    }
  }

  const handleSkip = () => {
    const advanced = h.goToNextOp()
    if (!advanced) onClose()
  }

  const emptyTargeted = h.mode === 'targeted' && h.filteredOpsList.length === 0

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/30 z-40 transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />

      {/* Drawer — s'élargit dynamiquement quand le panel preview est ouvert */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full bg-background border-l border-border shadow-2xl z-50',
          'transition-[transform,width] duration-300 flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{
          width: `${h.previewFilename ? DRAWER_WIDTH_WITH_PREVIEW : DRAWER_WIDTH_BASE}px`,
          maxWidth: '98vw',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Link2 size={18} className="text-primary" />
            <h2 className="text-sm font-semibold text-text">
              Association manuelle — justificatifs
            </h2>
          </div>

          {/* Tabs mode (visibles si targetedOps fourni) */}
          {h.hasTargeted && (
            <div className="flex items-center gap-0 border border-border-secondary rounded-md overflow-hidden">
              <button
                onClick={() => h.setMode('targeted')}
                className={cn(
                  'px-3 py-1.5 text-xs transition-colors',
                  h.mode === 'targeted'
                    ? 'bg-primary text-white font-medium'
                    : 'bg-transparent text-text-muted hover:bg-surface',
                )}
              >
                Opérations ciblées ({h.targetedCount})
              </button>
              <button
                onClick={() => h.setMode('all')}
                className={cn(
                  'px-3 py-1.5 text-xs transition-colors',
                  h.mode === 'all'
                    ? 'bg-primary text-white font-medium'
                    : 'bg-transparent text-text-muted hover:bg-surface',
                )}
              >
                Toutes sans justificatif
              </button>
            </div>
          )}

          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text hover:bg-surface rounded-md transition-colors"
            title="Fermer (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body : flex row (preview | ops | justifs) */}
        <div className="flex flex-row flex-1 min-h-0">
          {/* Panel preview (gauche, width animée) — 600px pour lisibilité PDF */}
          <div
            className="flex-shrink-0 overflow-hidden border-r border-border flex flex-col bg-surface transition-all duration-[250ms] ease-in-out"
            style={{ width: h.previewFilename ? `${PREVIEW_PANEL_WIDTH}px` : '0px' }}
          >
            {h.previewFilename && (
              <>
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
                  <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide truncate">
                    Aperçu
                  </span>
                  <button
                    onClick={() => h.setPreviewFilename(null)}
                    className="text-text-muted hover:text-text text-base leading-none px-1"
                  >
                    ×
                  </button>
                </div>
                <div className="flex-1 min-h-0 p-2">
                  <object
                    key={h.previewFilename}
                    data={`/api/justificatifs/${encodeURIComponent(h.previewFilename)}/preview#toolbar=1`}
                    type="application/pdf"
                    className="w-full h-full rounded border border-border bg-background"
                  >
                    <div className="flex items-center justify-center h-40 text-xs text-text-muted">
                      Aperçu non disponible
                    </div>
                  </object>
                </div>
                <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted break-all shrink-0 font-mono">
                  {h.previewFilename}
                </div>
              </>
            )}
          </div>

          {/* Panel opérations (340px) */}
          <div className="w-[340px] flex-shrink-0 border-r border-border flex flex-col">
            {/* Sub-header ops */}
            <div className="px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
                  Opérations
                </span>
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary tabular-nums font-medium">
                  {h.filteredOpsList.length}
                </span>
              </div>
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type="text"
                  value={h.opSearch}
                  onChange={e => h.setOpSearch(e.target.value)}
                  placeholder="Rechercher un libellé…"
                  className="w-full pl-7 pr-2 py-1.5 text-xs bg-surface border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            {/* Liste ops scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {h.isLoadingOps && (
                <div className="p-6 text-center text-xs text-text-muted">Chargement…</div>
              )}
              {!h.isLoadingOps && emptyTargeted && (
                <div className="p-6 text-center space-y-3">
                  <p className="text-xs text-text-muted leading-relaxed">
                    Aucune opération débitrice sans justificatif dans votre sélection.
                  </p>
                  <button
                    onClick={() => h.setMode('all')}
                    className="text-xs text-primary hover:underline"
                  >
                    Passer en mode « toutes sans justif »
                  </button>
                </div>
              )}
              {!h.isLoadingOps && !emptyTargeted && h.filteredOpsList.length === 0 && (
                <div className="p-6 text-center text-xs text-text-muted">
                  {h.opSearch
                    ? `Aucune opération ne correspond à "${h.opSearch}".`
                    : 'Aucune opération sans justificatif.'}
                </div>
              )}
              {h.filteredOpsList.map(op => (
                <OpRow
                  key={op.key}
                  op={op}
                  selected={op.key === h.selectedOpKey}
                  onClick={() => h.setSelectedOpKey(op.key)}
                />
              ))}
            </div>
          </div>

          {/* Panel justificatifs (flex-1) */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Sub-header justifs */}
            <div className="px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
                    Justificatifs
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary tabular-nums font-medium">
                    {h.filteredSuggestions.length}
                  </span>
                  {h.broadMode && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium flex items-center gap-1">
                      <Globe size={10} />
                      Mode élargi
                    </span>
                  )}
                </div>

                {/* Toggle broadMode */}
                <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={h.broadMode}
                    onChange={e => h.setBroadMode(e.target.checked)}
                    className="accent-primary"
                  />
                  <span
                    title="Ignore le pré-filtre ±1 mois — affiche tous les justificatifs sans association"
                  >
                    Élargir à tous les en attente
                  </span>
                </label>
              </div>

              {/* Barre filtres libres (masquée en mode élargi) */}
              {!h.broadMode && (
                <div className="flex items-center gap-3 text-[11px]">
                  <div className="flex items-center gap-1">
                    <span className="text-text-muted">Date</span>
                    <input
                      type="date"
                      value={h.filterDate}
                      onChange={e => h.setFilterDate(e.target.value)}
                      className="w-[128px] px-1.5 py-0.5 text-[11px] bg-surface border border-border rounded focus:outline-none focus:border-primary tabular-nums [color-scheme:dark]"
                      title="Centre de la recherche — calendrier"
                    />
                    <span className="text-text-muted">±</span>
                    <input
                      type="number"
                      value={h.filterDateTol}
                      onChange={e => h.setFilterDateTol(Number(e.target.value) || 0)}
                      min={0}
                      className="w-12 px-1 py-0.5 text-[11px] bg-surface border border-border rounded focus:outline-none focus:border-primary tabular-nums"
                    />
                    <span className="text-text-muted">j</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="text-text-muted">Montant</span>
                    <input
                      type="text"
                      value={h.filterAmount}
                      onChange={e => h.setFilterAmount(e.target.value)}
                      placeholder="1439"
                      className="w-[72px] px-1.5 py-0.5 text-[11px] bg-surface border border-border rounded focus:outline-none focus:border-primary tabular-nums"
                    />
                    <span className="text-text-muted">±</span>
                    <input
                      type="number"
                      value={h.filterAmountTol}
                      onChange={e => h.setFilterAmountTol(Number(e.target.value) || 0)}
                      min={0}
                      className="w-14 px-1 py-0.5 text-[11px] bg-surface border border-border rounded focus:outline-none focus:border-primary tabular-nums"
                    />
                    <span className="text-text-muted">€</span>
                  </div>

                  {(h.filterDate || h.filterAmount) && (
                    <button
                      onClick={h.clearFilters}
                      className="ml-auto text-[11px] text-text-muted hover:text-text flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface"
                    >
                      <X size={11} /> effacer
                    </button>
                  )}
                </div>
              )}

              {/* Hint op sélectionnée */}
              {h.selectedOp && (
                <div className="mt-2 text-[11px] italic text-text-muted truncate">
                  Op. sélectionnée : <span className="text-text">{h.selectedOp.libelle}</span>
                  {h.selectedOp.date && (
                    <> · <span className="text-text tabular-nums">{formatDate(h.selectedOp.date)}</span></>
                  )}
                  <> · <span className="text-red-400 tabular-nums">{formatCurrency(h.selectedOp.montant)}</span></>
                </div>
              )}
            </div>

            {/* Liste suggestions scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {h.isLoadingSuggestions && (
                <div className="p-6 text-center text-xs text-text-muted">Chargement…</div>
              )}
              {!h.isLoadingSuggestions && !h.selectedOp && !h.broadMode && (
                <div className="p-6 text-center text-xs text-text-muted">
                  Sélectionnez une opération à gauche.
                </div>
              )}
              {!h.isLoadingSuggestions && h.selectedOp && h.filteredSuggestions.length === 0 && (
                <div className="p-6 text-center space-y-2">
                  <p className="text-xs text-text-muted">
                    Aucun justificatif ne correspond.
                  </p>
                  {!h.broadMode && (
                    <button
                      onClick={() => h.setBroadMode(true)}
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <Globe size={11} /> Élargir à tous les justificatifs en attente
                    </button>
                  )}
                </div>
              )}
              {h.filteredSuggestions.map((s, idx) => (
                <JustifRow
                  key={s.filename}
                  suggestion={s}
                  opDate={h.selectedOp?.date ?? null}
                  isBestMatch={idx === 0 && (s.score ?? 0) >= 0.8 && !h.broadMode}
                  isPreviewing={s.filename === h.previewFilename}
                  onTogglePreview={() => h.togglePreview(s.filename)}
                  onAssociate={() => handleAssociate(s)}
                  loading={h.associateLoading}
                  broadMode={h.broadMode}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0">
          <div className="text-xs text-text-muted tabular-nums">
            {h.filteredOpsList.length > 0 && h.currentIdx >= 0 ? (
              <>
                {h.currentIdx + 1} / {h.filteredOpsList.length} op. · {h.filteredSuggestions.length}{' '}
                suggestion{h.filteredSuggestions.length > 1 ? 's' : ''}
              </>
            ) : (
              <>
                {h.filteredOpsList.length} op. · {h.filteredSuggestions.length} suggestion{h.filteredSuggestions.length > 1 ? 's' : ''}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSkip}
              disabled={!h.selectedOp}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border-secondary rounded-md hover:bg-surface text-text-muted hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <SkipForward size={13} />
              Ignorer
            </button>
            <button
              onClick={handleSkip}
              disabled={!h.selectedOp}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Suivant
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Row opération (panneau gauche)
// ─────────────────────────────────────────────────────────────────────────

interface OpRowProps {
  op: DrawerOp
  selected: boolean
  onClick: () => void
}

function OpRow({ op, selected, onClick }: OpRowProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2 border-b border-border transition-colors flex items-start gap-2 relative',
        selected
          ? 'bg-primary/10 border-l-2 border-l-primary'
          : 'hover:bg-surface border-l-2 border-l-transparent',
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full mt-1.5 shrink-0',
          selected ? 'bg-primary' : 'bg-amber-500/70',
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text truncate" style={{ maxWidth: '260px' }} title={op.libelle}>
          {op.libelle}
        </div>
        <div className="flex items-center justify-between mt-0.5 text-[10px] text-text-muted">
          <span className="tabular-nums">{formatDate(op.date)}</span>
          <span className="text-red-400 tabular-nums font-medium">
            {formatCurrency(op.montant)}
          </span>
        </div>
        {op.categorie && (
          <div className="text-[10px] text-text-muted/80 truncate mt-0.5">
            {op.categorie}
            {op.sousCategorie && <> · <span>{op.sousCategorie}</span></>}
            {op.ventilationIndex != null && (
              <span className="ml-1 px-1 py-px rounded bg-primary/10 text-primary text-[9px]">
                L{op.ventilationIndex + 1}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Row justificatif (panneau droit)
// ─────────────────────────────────────────────────────────────────────────

interface JustifRowProps {
  suggestion: DrawerSuggestion
  opDate: string | null
  isBestMatch: boolean
  isPreviewing: boolean
  onTogglePreview: () => void
  onAssociate: () => void
  loading: boolean
  broadMode: boolean
}

function computeDeltaJours(opDateStr: string | null, ocrDateStr: string | null): number | null {
  if (!opDateStr || !ocrDateStr) return null
  const op = new Date(opDateStr).getTime()
  const oc = new Date(ocrDateStr).getTime()
  if (isNaN(op) || isNaN(oc)) return null
  return Math.round((oc - op) / 86_400_000)
}

function parseFournisseurFromFilename(name: string): string {
  // "auchan_20250315_87.81.pdf" → "auchan"
  const m = name.match(/^([a-z0-9-]+)_/i)
  return m ? m[1] : name.replace(/\.pdf$/i, '')
}

function JustifRow({
  suggestion,
  opDate,
  isBestMatch,
  isPreviewing,
  onTogglePreview,
  onAssociate,
  loading,
  broadMode,
}: JustifRowProps) {
  const hasOcrPartiel = !suggestion.ocr_date || suggestion.ocr_montant == null
  const fournisseur =
    suggestion.ocr_fournisseur || parseFournisseurFromFilename(suggestion.filename)
  const deltaJours = computeDeltaJours(opDate, suggestion.ocr_date)

  return (
    <div
      className={cn(
        'flex items-stretch gap-3 px-4 py-2.5 border-b border-border transition-colors',
        isPreviewing && 'bg-primary/10 border-l-2 border-l-primary',
        !isPreviewing && isBestMatch && 'bg-emerald-500/10 border-l-2 border-l-emerald-500',
        !isPreviewing && !isBestMatch && 'border-l-2 border-l-transparent hover:bg-surface',
      )}
    >
      {/* Thumbnail cliquable pour ouvrir preview */}
      <button
        onClick={onTogglePreview}
        className={cn(
          'relative w-[32px] h-[38px] rounded border flex-shrink-0 overflow-hidden group/thumb',
          isPreviewing
            ? 'border-primary'
            : 'border-border-secondary hover:border-primary/50',
        )}
        title="Ouvrir l'aperçu"
      >
        <PdfThumbnail
          justificatifFilename={suggestion.filename}
          lazy
          className="w-full h-full"
          iconSize={14}
        />
        <span className="absolute inset-0 bg-primary/60 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
          <Eye size={12} className="text-white" />
        </span>
      </button>

      {/* Infos */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-text font-medium truncate" title={suggestion.filename}>
            {fournisseur}
          </span>
          {isBestMatch && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-medium flex-shrink-0"
              title="Meilleur score de la liste"
            >
              <Sparkles size={9} /> Meilleur match
            </span>
          )}
          {hasOcrPartiel && (
            <span
              className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[9px] font-medium flex-shrink-0"
              title={`OCR partiel : ${!suggestion.ocr_date ? 'date' : ''}${!suggestion.ocr_date && suggestion.ocr_montant == null ? ' + ' : ''}${suggestion.ocr_montant == null ? 'montant' : ''} manquant`}
            >
              OCR partiel
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap text-[11px] tabular-nums">
          {suggestion.ocr_date ? (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 font-medium"
              title="Date extraite par l'OCR"
            >
              <CalendarDays size={10} />
              {formatDate(suggestion.ocr_date)}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-zinc-500/15 text-text-muted/70 italic"
              title="Date OCR absente"
            >
              <CalendarDays size={10} />
              n/a
            </span>
          )}
          {suggestion.ocr_montant != null ? (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium"
              title="Montant extrait par l'OCR"
            >
              <Euro size={10} />
              {formatCurrency(suggestion.ocr_montant)}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-zinc-500/15 text-text-muted/70 italic"
              title="Montant OCR absent"
            >
              <Euro size={10} />
              n/a
            </span>
          )}
          {suggestion.size_human && (
            <span className="text-text-muted/50 text-[10px]">· {suggestion.size_human}</span>
          )}
        </div>

        {!broadMode && suggestion.score != null && suggestion.score_detail && (
          <ScorePills
            detail={suggestion.score_detail}
            total={suggestion.score}
            deltaJours={deltaJours}
          />
        )}
      </div>

      {/* Bouton associer */}
      <div className="flex items-center shrink-0">
        <button
          onClick={onAssociate}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Link2 size={12} />
          Associer
        </button>
      </div>
    </div>
  )
}

