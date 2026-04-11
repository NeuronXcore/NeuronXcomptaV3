import { useEffect, useRef, useState } from 'react'
import {
  X,
  ChevronLeft,
  ChevronRight,
  Search,
  FileSearch,
  Check,
  Loader2,
  FileText,
  Sparkles,
} from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { useRapprochementWorkflow } from '@/hooks/useRapprochementWorkflow'
import ReconstituerButton from '@/components/ocr/ReconstituerButton'
import ScorePills from '@/components/justificatifs/ScorePills'
import type { Operation, JustificatifSuggestion, JustificatifInfo } from '@/types'

interface RapprochementWorkflowDrawerProps {
  isOpen: boolean
  operations: Operation[]
  initialIndex?: number
  fallbackFilename?: string
  onClose: () => void
  onAttribution?: () => void
}

function formatShortDate(raw: string | undefined): string {
  if (!raw) return ''
  // Expect YYYY-MM-DD
  const parts = raw.slice(0, 10).split('-')
  if (parts.length !== 3) return raw
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function scoreClasses(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500/15 text-emerald-400'
  if (pct >= 60) return 'bg-amber-500/15 text-amber-400'
  return 'bg-zinc-500/15 text-text-muted'
}

export default function RapprochementWorkflowDrawer({
  isOpen,
  operations,
  initialIndex,
  fallbackFilename,
  onClose,
  onAttribution,
}: RapprochementWorkflowDrawerProps) {
  const wf = useRapprochementWorkflow({
    operations,
    initialIndex,
    isOpen,
    fallbackFilename,
  })

  const {
    mode,
    setMode,
    currentOp,
    currentIndex,
    currentFile,
    totalOps,
    unmatchedCount,
    progressPct,
    canPrev,
    canNext,
    goPrev,
    skipToNextUnmatched,
    currentOpVentilated,
    ventilationLines,
    selectedVentilationIndex,
    setSelectedVentilationIndex,
    suggestions,
    suggestionsLoading,
    selectedSuggestion,
    setSelectedSuggestion,
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    attribuer,
    attribuerLoading,
    isCurrentDone,
  } = wf

  // Escape + keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (isInput) return

      if (e.key === 'Enter') {
        if (selectedSuggestion && !isCurrentDone && !attribuerLoading) {
          e.preventDefault()
          attribuer().then(() => {
            if (onAttribution) onAttribution()
          })
        }
        return
      }
      if (mode === 'all') {
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          skipToNextUnmatched()
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          goPrev()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    isOpen,
    onClose,
    selectedSuggestion,
    isCurrentDone,
    attribuerLoading,
    attribuer,
    onAttribution,
    mode,
    skipToNextUnmatched,
    goPrev,
  ])

  const debit = currentOp?.['Débit'] ?? 0
  const credit = currentOp?.['Crédit'] ?? 0
  const opMontant = debit || credit
  const isDebit = debit > 0
  const categorie = currentOp?.['Catégorie'] ?? ''
  const sousCategorie = currentOp?.['Sous-catégorie'] ?? ''
  const hasTargetedTab = initialIndex !== undefined
  const currentOpDate = currentOp?.Date ?? ''

  const previewFilename = selectedSuggestion?.filename ?? null
  const previewUrl = previewFilename
    ? `/api/justificatifs/${encodeURIComponent(previewFilename)}/preview`
    : null

  const handleAttribuer = async () => {
    await attribuer()
    if (onAttribution) onAttribution()
  }

  // Lazy mount : on ne rend le contenu du drawer (qui contient ReconstituerButton,
  // SuggestionRow avec thumbnails, etc.) qu'après la première ouverture. Évite les
  // fetches eager (template suggestions, reconstitue templates) au chargement de la
  // page alors que le drawer est invisible. Une fois monté, on garde en mémoire pour
  // que l'animation slide-out fonctionne et pour éviter un re-mount au prochain open.
  const [hasBeenOpened, setHasBeenOpened] = useState(isOpen)
  useEffect(() => {
    if (isOpen && !hasBeenOpened) setHasBeenOpened(true)
  }, [isOpen, hasBeenOpened])

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[700px] max-w-[95vw] bg-background border-l border-border z-50 shadow-xl flex flex-col',
          'transition-transform duration-300',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {!hasBeenOpened ? null : (<>
        {/* ── Header navigator ── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          <button
            onClick={goPrev}
            disabled={!canPrev}
            className="h-7 w-7 flex items-center justify-center rounded border border-border text-text-muted hover:text-text hover:bg-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Précédent"
          >
            <ChevronLeft size={14} />
          </button>

          <div className="flex-1 text-center text-xs text-text-muted">
            {mode === 'all' ? (
              <>
                <span className="text-text font-medium">{currentIndex + 1}</span>
                <span className="mx-1">/</span>
                <span>{totalOps}</span>
                <span className="mx-2">·</span>
                <span>
                  {unmatchedCount} restant{unmatchedCount > 1 ? 's' : ''}
                </span>
              </>
            ) : (
              <>
                <span className="text-text font-medium">Opération ciblée</span>
                <span className="mx-2">·</span>
                <span>
                  {unmatchedCount} sans justif
                </span>
              </>
            )}
          </div>

          <button
            onClick={skipToNextUnmatched}
            disabled={!canNext || mode !== 'all'}
            className="h-7 w-7 flex items-center justify-center rounded border border-border text-text-muted hover:text-text hover:bg-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Suivant"
          >
            <ChevronRight size={14} />
          </button>

          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded text-text-muted hover:text-text hover:bg-surface transition-colors ml-1"
            title="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Progress bar ── */}
        <div className="h-[3px] bg-border/50 shrink-0">
          <div
            className="h-full bg-emerald-500 transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* ── Mode tabs ── */}
        {hasTargetedTab ? (
          <div className="flex border-b border-border shrink-0">
            <button
              onClick={() => setMode('all')}
              className={cn(
                'flex-1 py-2 text-xs transition-colors border-b-2',
                mode === 'all'
                  ? 'border-primary text-text font-medium'
                  : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              Toutes sans justificatif
            </button>
            <button
              onClick={() => setMode('single')}
              className={cn(
                'flex-1 py-2 text-xs transition-colors border-b-2',
                mode === 'single'
                  ? 'border-primary text-text font-medium'
                  : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              Opération ciblée
            </button>
          </div>
        ) : null}

        {/* ── Current operation context ── */}
        {currentOp && (
          <div className="px-4 py-2.5 bg-surface/50 border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-text-muted tabular-nums shrink-0">
                {formatShortDate(currentOp.Date)}
              </span>
              <span className="flex-1 text-[13px] text-text font-medium truncate">
                {currentOp['Libellé']}
              </span>
              <span
                className={cn(
                  'text-sm font-medium tabular-nums shrink-0',
                  isDebit ? 'text-red-400' : 'text-emerald-400',
                )}
              >
                {isDebit ? '-' : '+'}
                {formatCurrency(Math.abs(opMontant))}
              </span>
              {isCurrentDone && (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-medium shrink-0">
                  attribué
                </span>
              )}
            </div>
            {(categorie || sousCategorie) && (
              <div className="text-[11px] text-text-muted mt-0.5 pl-[62px] truncate">
                {categorie}
                {sousCategorie ? ` · ${sousCategorie}` : ''}
              </div>
            )}
          </div>
        )}

        {/* ── Ventilation pills ── */}
        {currentOpVentilated && (
          <div className="px-4 py-2 border-b border-border shrink-0">
            <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">
              Sous-lignes ventilées
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedVentilationIndex(null)}
                className={cn(
                  'px-2.5 py-1 rounded-full border text-[11px] transition-colors',
                  selectedVentilationIndex === null
                    ? 'bg-primary/10 border-primary text-primary font-medium'
                    : 'bg-background border-border text-text-muted hover:text-text',
                )}
              >
                Opération complète · {formatCurrency(Math.abs(opMontant))}
              </button>
              {ventilationLines.map((vl, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedVentilationIndex(idx)}
                  className={cn(
                    'px-2.5 py-1 rounded-full border text-[11px] transition-colors max-w-[220px] truncate',
                    selectedVentilationIndex === idx
                      ? 'bg-primary/10 border-primary text-primary font-medium'
                      : 'bg-background border-border text-text-muted hover:text-text',
                  )}
                  title={vl.libelle || vl.categorie}
                >
                  {(vl.libelle || vl.categorie || `L${idx + 1}`) + ' · '}
                  <span className="font-medium">
                    {formatCurrency(Math.abs(vl.montant))}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Suggestions / recherche section ── */}
        <div className="shrink-0">
          <div className="px-4 pt-3 pb-1">
            <div className="text-[10px] text-text-muted uppercase tracking-wide mb-2">
              {isSearching ? 'Résultats de recherche' : 'Suggestions'}
            </div>
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un justificatif..."
                className="w-full pl-7 pr-3 py-1.5 text-xs bg-surface border border-border rounded text-text placeholder:text-text-muted/60 focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="max-h-[220px] overflow-y-auto border-b border-border">
            {isSearching ? (
              // Recherche exclusive : afficher uniquement les résultats de recherche
              searchResults.length === 0 ? (
                <div className="flex items-center justify-center py-6 text-text-muted text-xs">
                  Aucun justificatif trouvé pour « {searchQuery} »
                </div>
              ) : (
                searchResults.map((j) => (
                  <SearchResultRow
                    key={j.filename}
                    info={j}
                    isSelected={selectedSuggestion?.filename === j.filename}
                    onSelect={() => {
                      setSelectedSuggestion({
                        filename: j.filename,
                        ocr_date: j.ocr_date ?? '',
                        ocr_montant: j.ocr_amount ?? null,
                        ocr_fournisseur: j.ocr_supplier ?? '',
                        score: 0,
                        size_human: j.size_human,
                      })
                    }}
                  />
                ))
              )
            ) : suggestionsLoading ? (
              <div className="flex items-center justify-center py-6 text-text-muted text-xs gap-2">
                <Loader2 size={12} className="animate-spin" />
                Chargement...
              </div>
            ) : suggestions.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-text-muted text-xs">
                Aucune suggestion
              </div>
            ) : (
              suggestions.map((s, idx) => (
                <SuggestionRow
                  key={s.filename}
                  suggestion={s}
                  isSelected={selectedSuggestion?.filename === s.filename}
                  isBestMatch={idx === 0 && s.score >= 0.80}
                  isTopMatch={idx === 0 && s.score >= 0.95}
                  opDate={currentOpDate}
                  onClick={() => setSelectedSuggestion(s)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── PDF preview ── */}
        <div className="flex-1 min-h-0 flex flex-col">
          {previewUrl ? (
            <div className="flex-1 m-3 rounded-md overflow-hidden border border-border bg-surface">
              <object
                data={`${previewUrl}#toolbar=1`}
                type="application/pdf"
                className="w-full h-full"
              >
                <div className="flex items-center justify-center h-full text-text-muted text-xs">
                  Impossible d'afficher le PDF
                </div>
              </object>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-muted">
              <FileSearch size={40} className="opacity-30" />
              <span className="text-xs">Sélectionnez un justificatif</span>
            </div>
          )}
        </div>

        {/* ── Action bar ── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border shrink-0">
          {!isCurrentDone && selectedSuggestion && (
            <button
              onClick={handleAttribuer}
              disabled={attribuerLoading}
              className="flex items-center gap-1.5 bg-warning text-background font-medium px-4 py-1.5 rounded-md text-xs hover:bg-warning/90 transition-colors disabled:opacity-50"
            >
              {attribuerLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} />
              )}
              Attribuer
              <kbd className="ml-1 text-[9px] bg-background/20 px-1 rounded">⏎</kbd>
            </button>
          )}

          {isCurrentDone && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <Check size={12} />
              Déjà attribué
            </span>
          )}

          {currentOp && currentFile && (
            <ReconstituerButton
              operationFile={currentFile}
              operationIndex={currentIndex}
              libelle={currentOp['Libellé'] ?? ''}
              size="md"
              onGenerated={() => {
                if (onAttribution) onAttribution()
                if (mode === 'all') {
                  setTimeout(() => skipToNextUnmatched(), 50)
                }
              }}
            />
          )}

          {mode === 'all' && (
            <button
              onClick={skipToNextUnmatched}
              className="ml-auto flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors px-2 py-1"
            >
              Passer
              <kbd className="text-[9px] bg-surface px-1 rounded border border-border">→</kbd>
            </button>
          )}
        </div>
        </>
        )}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────

function Thumbnail({ filename }: { filename: string }) {
  // Endpoint dédié qui résout automatiquement la location (en_attente ou
  // traites) via justificatif_service.get_justificatif_path. Avant, on
  // hard-codait `en_attente/` → les fichiers déjà associés dans `traites/`
  // retournaient 404 et affichaient une page blanche.
  const url = `/api/justificatifs/${encodeURIComponent(filename)}/thumbnail`

  // IntersectionObserver : ne charge l'image que lorsqu'elle entre dans le viewport
  // de son conteneur scrollable (le <img loading="lazy"> natif ne marche pas bien
  // pour les scrollers internes). Ça évite 30+ requêtes HTTP simultanées au moment
  // de l'ouverture du drawer — seules les ~5 lignes visibles initialement chargent.
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (visible) return // déjà chargé, pas besoin de l'observer
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
            break
          }
        }
      },
      { root: null, rootMargin: '200px', threshold: 0.01 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  return (
    <span
      ref={ref}
      className="relative w-9 h-12 shrink-0 rounded bg-surface border border-border overflow-hidden"
    >
      {visible && !errored && (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      )}
      {(!visible || errored) && (
        <span className="absolute inset-0 flex items-center justify-center text-text-muted/40">
          <FileText size={16} />
        </span>
      )}
    </span>
  )
}

function computeDeltaJours(opDate: string | undefined, ocrDate: string | undefined): number | null {
  if (!opDate || !ocrDate) return null
  const op = Date.parse(opDate.slice(0, 10))
  const ocr = Date.parse(ocrDate.slice(0, 10))
  if (Number.isNaN(op) || Number.isNaN(ocr)) return null
  return Math.round((op - ocr) / 86_400_000)
}

function SuggestionRow({
  suggestion,
  isSelected,
  isBestMatch,
  isTopMatch,
  opDate,
  onClick,
}: {
  suggestion: JustificatifSuggestion
  isSelected: boolean
  isBestMatch: boolean
  isTopMatch: boolean
  opDate: string
  onClick: () => void
}) {
  const deltaJours = computeDeltaJours(opDate, suggestion.ocr_date)
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2 px-4 py-2 text-left border-l-[3px] transition-colors',
        isSelected
          ? 'border-l-primary bg-primary/5'
          : isBestMatch
            ? 'border-l-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10'
            : 'border-l-transparent hover:bg-surface/60',
      )}
    >
      <Thumbnail filename={suggestion.filename} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text truncate flex-1 font-medium">
            {suggestion.ocr_fournisseur || suggestion.filename}
          </span>
          {suggestion.ocr_date && (
            <span className="text-[10px] text-warning font-medium tabular-nums shrink-0">
              {formatShortDate(suggestion.ocr_date)}
            </span>
          )}
          {suggestion.ocr_montant != null && (
            <span className="text-[10px] text-warning font-medium tabular-nums shrink-0">
              {formatCurrency(Math.abs(suggestion.ocr_montant))}
            </span>
          )}
        </div>
        {isTopMatch && (
          <div className="flex items-center gap-1 text-[10px] text-emerald-400 mt-0.5">
            <Sparkles size={10} />
            Meilleur match
          </div>
        )}
        {suggestion.score_detail ? (
          <ScorePills
            detail={suggestion.score_detail}
            total={suggestion.score ?? 0}
            deltaJours={deltaJours}
            className="mt-1"
          />
        ) : (
          <span
            className={cn(
              'inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[36px] text-center tabular-nums',
              scoreClasses(Math.round((suggestion.score ?? 0) * 100)),
            )}
          >
            {Math.round((suggestion.score ?? 0) * 100)}%
          </span>
        )}
      </div>
    </button>
  )
}

function SearchResultRow({
  info,
  isSelected,
  onSelect,
}: {
  info: JustificatifInfo
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-2 px-4 py-2 text-left border-l-[3px] transition-colors',
        isSelected
          ? 'border-l-primary bg-primary/5'
          : 'border-l-transparent hover:bg-surface/60',
      )}
    >
      <Thumbnail filename={info.filename} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <FileText size={11} className="text-text-muted shrink-0" />
          <span className="text-xs text-text truncate flex-1">{info.filename}</span>
          {info.ocr_date && (
            <span className="text-[10px] text-warning font-medium tabular-nums shrink-0">
              {formatShortDate(info.ocr_date)}
            </span>
          )}
          {info.ocr_amount != null && (
            <span className="text-[10px] text-warning font-medium tabular-nums shrink-0">
              {formatCurrency(Math.abs(info.ocr_amount))}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
