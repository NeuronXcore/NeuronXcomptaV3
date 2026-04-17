import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  Inbox, RefreshCw, PlayCircle, Loader2, Info, Search,
  FileText, ExternalLink, X, Check, Minus, Play, AlertTriangle,
} from 'lucide-react'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'
import { showDeleteConfirmToast } from '@/lib/deleteJustificatifToast'
import {
  useSandboxList,
  useProcessSandboxFile,
  useDeleteFromSandbox,
} from '@/hooks/useSandboxInbox'
import { useSettings, useUpdateSettings } from '@/hooks/useApi'
import type { AppSettings } from '@/types'
import SandboxRow from './SandboxRow'

interface SandboxTabProps {
  /** Handler optionnel — si non fourni, ouvre le drawer interne. Utilisé par les
   *  tests ou si un parent veut router différemment (p. ex. native open). */
  onPreview?: (filename: string) => void
}

export default function SandboxTab({ onPreview }: SandboxTabProps) {
  const { data: items = [], isLoading, refetch, isRefetching } = useSandboxList()
  const processOne = useProcessSandboxFile()
  const deleteOne = useDeleteFromSandbox()

  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()

  const [search, setSearch] = useState('')
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set())
  const [focusedFilename, setFocusedFilename] = useState<string | null>(null)
  const [processAllRunning, setProcessAllRunning] = useState(false)
  const [previewFilename, setPreviewFilename] = useState<string | null>(null)
  // Multi-s\u00e9lection pour OCR batch. Persist\u00e9 par filename, auto-purg\u00e9 quand
  // un fichier quitte la sandbox (post-process ou delete).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchRunning, setBatchRunning] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Gestion du preview : si le parent fournit onPreview, on délègue ;
  // sinon on ouvre le drawer interne (PDF inline).
  const handlePreview = useCallback(
    (filename: string) => {
      if (onPreview) {
        onPreview(filename)
      } else {
        setPreviewFilename(filename)
      }
    },
    [onPreview],
  )

  // Escape pour fermer le drawer preview
  useEffect(() => {
    if (!previewFilename) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewFilename(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewFilename])

  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter((i) => i.filename.toLowerCase().includes(q))
  }, [items, search])

  // Focus first row on mount
  useEffect(() => {
    if (focusedFilename == null && filtered.length > 0) {
      setFocusedFilename(filtered[0].filename)
    }
  }, [filtered, focusedFilename])

  const handleProcess = useCallback(
    (filename: string) => {
      // OCR tourne en background côté backend (thread daemon) — la mutation
      // retourne immédiatement {status:"started"}. Le toast final (succès
      // + auto-rapprochement éventuel) vient via SSE processed → SandboxArrivalToast.
      setProcessingFiles((s) => new Set(s).add(filename))
      processOne.mutate(filename, {
        onSuccess: () => {
          toast.loading(`OCR lancé : ${filename}`, { duration: 3000 })
        },
        onError: (err) => {
          toast.error(`Erreur OCR : ${(err as Error).message}`)
          // Clear du state processing uniquement en cas d'erreur — en cas de
          // succès, la row disparaît du list quand le fichier quitte sandbox/.
          setProcessingFiles((s) => {
            const n = new Set(s)
            n.delete(filename)
            return n
          })
        },
      })
    },
    [processOne],
  )

  const handleDelete = useCallback(
    (filename: string) => {
      showDeleteConfirmToast(filename, null, () => {
        deleteOne.mutate(filename, {
          onSuccess: () => toast.success(`Supprimé : ${filename}`),
          onError: (err) => toast.error(`Erreur suppression : ${(err as Error).message}`),
        })
      })
    },
    [deleteOne],
  )

  const handleProcessAll = useCallback(async () => {
    if (filtered.length === 0) return
    const canonicals = filtered.filter((i) => i.is_canonical).length
    if (canonicals === 0) {
      toast('Aucun fichier canonique à traiter. Renomme d\'abord les non-canoniques.', { icon: 'ℹ️' })
      return
    }
    setProcessAllRunning(true)
    try {
      await api.post('/sandbox/process-all')
      toast.success(`Traitement lancé pour ${canonicals} fichier(s) canonique(s)`)
    } catch (err) {
      toast.error(`Erreur : ${(err as Error).message}`)
    } finally {
      // Laisser le scheduler rafraîchir
      setTimeout(() => setProcessAllRunning(false), 2000)
    }
  }, [filtered])

  const handleToggleAutoMode = useCallback(() => {
    if (!settings) return
    const next: AppSettings = { ...settings, sandbox_auto_mode: !settings.sandbox_auto_mode }
    updateSettings.mutate(next, {
      onSuccess: () => {
        toast.success(
          next.sandbox_auto_mode
            ? `Mode auto activé (${next.sandbox_auto_delay_seconds}s)`
            : 'Mode auto désactivé',
        )
      },
    })
  }, [settings, updateSettings])

  const handleDelayChange = useCallback(
    (delay: number) => {
      if (!settings) return
      const next: AppSettings = { ...settings, sandbox_auto_delay_seconds: delay }
      updateSettings.mutate(next)
    },
    [settings, updateSettings],
  )

  // Auto-purge des s\u00e9lections dont le fichier n'est plus dans sandbox/
  // (post-process ou delete) pour \u00e9viter des s\u00e9lections fant\u00f4mes.
  useEffect(() => {
    const live = new Set(items.map((i) => i.filename))
    setSelected((prev) => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Set<string>()
      for (const name of prev) {
        if (live.has(name)) next.add(name)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [items])

  const toggleSelected = useCallback((filename: string, next: boolean) => {
    setSelected((prev) => {
      const set = new Set(prev)
      if (next) set.add(filename)
      else set.delete(filename)
      return set
    })
  }, [])

  // Toggle Select All sur les items \u00ab filtered \u00bb (respecte la recherche) :
  // - 0 s\u00e9lectionn\u00e9 → tout cocher
  // - partiel ou tout → tout d\u00e9cocher
  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.filename))
  const someFilteredSelected = filtered.some((i) => selected.has(i.filename))
  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (allFilteredSelected) {
        // Tout d\u00e9cocher (parmi les filtered — laisse intacte la s\u00e9lection hors-filter)
        const next = new Set(prev)
        for (const item of filtered) next.delete(item.filename)
        return next
      }
      // Tout cocher
      const next = new Set(prev)
      for (const item of filtered) next.add(item.filename)
      return next
    })
  }, [filtered, allFilteredSelected])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  // Lancer OCR sur les fichiers s\u00e9lectionn\u00e9s (background task c\u00f4t\u00e9 backend,
  // 1 POST par fichier — le backend traite en parall\u00e8le via ses propres threads).
  const handleProcessBatch = useCallback(async () => {
    if (selected.size === 0) return
    const selectedItems = items.filter((i) => selected.has(i.filename))
    const nonCanonicals = selectedItems.filter((i) => !i.is_canonical)
    if (nonCanonicals.length > 0) {
      // Non-bloquant : on avertit + on lance quand m\u00eame. L'auto-rename post-OCR
      // peut rattraper si supplier/date/montant sont bien extraits par l'OCR.
      toast(
        `\u26a0\ufe0f ${nonCanonicals.length} fichier(s) non-canonique(s) OCR\u00e9(s) avec leur nom actuel. Renomme avant OCR pour un filename-first optimal.`,
        { icon: '\u26a0\ufe0f', duration: 6000, position: 'top-right' },
      )
    }

    setBatchRunning(true)
    setProcessingFiles((s) => {
      const next = new Set(s)
      for (const item of selectedItems) next.add(item.filename)
      return next
    })

    // Fire-and-forget : on lance tous les POST en parall\u00e8le, chacun retourne
    // imm\u00e9diatement (background task backend). Les SSE events suivront.
    const promises = selectedItems.map((item) =>
      processOne.mutateAsync(item.filename).catch((err) => {
        toast.error(`Erreur OCR ${item.filename} : ${(err as Error).message}`)
        setProcessingFiles((s) => {
          const n = new Set(s)
          n.delete(item.filename)
          return n
        })
      }),
    )
    await Promise.allSettled(promises)
    toast.success(`OCR lanc\u00e9 sur ${selectedItems.length} fichier(s)`)
    clearSelection()
    setTimeout(() => setBatchRunning(false), 800)
  }, [selected, items, processOne, clearSelection])

  // Keyboard: Tab navigation is native via tabIndex on rows
  // Cmd+Backspace / Enter are handled at row level

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    )
  }

  const canonicalCount = items.filter((i) => i.is_canonical).length
  const nonCanonicalCount = items.length - canonicalCount
  const autoMode = settings?.sandbox_auto_mode ?? false
  const autoDelay = settings?.sandbox_auto_delay_seconds ?? 30

  return (
    <div ref={containerRef} className="space-y-4">
      {/* Header ribbon : intro + compteur + settings auto-mode compacts */}
      <div className="flex items-center gap-3 p-4 bg-primary/5 border border-primary/20 rounded-lg">
        <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
          <Inbox size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">Boîte d'arrivée</span>
            <span className="text-xs text-text-muted">
              {items.length} fichier(s) · {nonCanonicalCount} à renommer · {canonicalCount} canonique(s)
            </span>
          </div>
          <div className="text-xs text-text-muted mt-0.5 flex items-start gap-1">
            <Info size={11} className="mt-0.5 shrink-0" />
            <span>
              Renomme chaque fichier à la convention <code className="text-primary">fournisseur_YYYYMMDD_montant.XX</code>{' '}
              avant de lancer l'OCR. Les fichiers canoniques sont traités automatiquement.
            </span>
          </div>
        </div>
        {/* Mini toggle + slider auto-mode */}
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <span className={cn('text-xs', autoMode ? 'text-amber-400' : 'text-text-muted')}>
              OCR auto
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={autoMode}
              onClick={handleToggleAutoMode}
              className={cn(
                'w-8 h-4 rounded-full border transition-colors relative',
                autoMode ? 'bg-amber-500/40 border-amber-500/60' : 'bg-surface border-border',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all',
                  autoMode ? 'left-4' : 'left-0.5',
                )}
              />
            </button>
          </label>
          {autoMode && (
            <div className="flex items-center gap-1.5">
              <input
                type="range"
                min={15}
                max={300}
                step={15}
                value={autoDelay}
                onChange={(e) => handleDelayChange(Number(e.target.value))}
                className="w-24 accent-amber-500"
              />
              <span className="text-xs tabular-nums text-amber-400 min-w-[45px]">
                {autoDelay < 60 ? `${autoDelay}s` : `${Math.round(autoDelay / 60)}min`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar : select-all + search + process-all + refresh */}
      <div className="flex items-center gap-2">
        {/* Select All — tri-state : checked / indeterminate / unchecked */}
        {filtered.length > 0 && (
          <button
            type="button"
            role="checkbox"
            aria-checked={allFilteredSelected ? 'true' : someFilteredSelected ? 'mixed' : 'false'}
            onClick={toggleSelectAll}
            className={cn(
              'shrink-0 w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center transition-all',
              allFilteredSelected
                ? 'bg-primary border-primary text-white'
                : someFilteredSelected
                  ? 'bg-primary/30 border-primary text-primary'
                  : 'bg-background border-border text-transparent hover:border-primary/60',
            )}
            title={
              allFilteredSelected
                ? 'Tout d\u00e9s\u00e9lectionner'
                : someFilteredSelected
                  ? `S\u00e9lectionner les ${filtered.length - filtered.filter(i => selected.has(i.filename)).length} restants`
                  : `Tout s\u00e9lectionner (${filtered.length})`
            }
          >
            {allFilteredSelected ? (
              <Check size={14} strokeWidth={3} />
            ) : someFilteredSelected ? (
              <Minus size={14} strokeWidth={3} />
            ) : null}
          </button>
        )}
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrer par nom…"
            className="w-full bg-surface border border-border rounded-md pl-9 pr-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary/50"
          />
        </div>
        <button
          type="button"
          onClick={handleProcessAll}
          disabled={canonicalCount === 0 || processAllRunning}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
            canonicalCount === 0 || processAllRunning
              ? 'bg-surface text-text-muted cursor-not-allowed border border-border'
              : 'bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30',
          )}
          title="Lance l'OCR sur tous les fichiers déjà canoniques"
        >
          {processAllRunning ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
          Traiter canoniques ({canonicalCount})
        </button>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="p-2 rounded-md text-text-muted hover:text-text hover:bg-surface border border-border"
          title="Rafraîchir"
        >
          <RefreshCw size={14} className={isRefetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="text-center py-16 bg-surface rounded-lg border border-dashed border-border">
          <Inbox size={32} className="mx-auto text-text-muted mb-3" />
          <div className="text-sm text-text-muted">
            Aucun fichier en attente dans la boîte d'arrivée.
          </div>
          <div className="text-xs text-text-muted mt-1">
            Dépose des PDF/JPG/PNG dans <code className="text-primary">data/justificatifs/sandbox/</code> pour commencer.
          </div>
        </div>
      )}

      {/* Non-matching filter */}
      {items.length > 0 && filtered.length === 0 && (
        <div className="text-center py-8 bg-surface rounded-lg border border-border">
          <div className="text-sm text-text-muted">
            Aucun fichier ne correspond à « {search} ».
          </div>
        </div>
      )}

      {/* Rows */}
      <div className={cn('space-y-2', selected.size > 0 && 'pb-20')}>
        {filtered.map((item) => (
          <SandboxRow
            key={item.filename}
            item={item}
            processing={processingFiles.has(item.filename)}
            focused={focusedFilename === item.filename}
            onFocus={() => setFocusedFilename(item.filename)}
            onProcess={handleProcess}
            onDelete={handleDelete}
            onPreview={handlePreview}
            selected={selected.has(item.filename)}
            onToggleSelected={(next) => toggleSelected(item.filename, next)}
          />
        ))}
      </div>

      {/* Barre flottante batch \u2014 visible d\u00e8s 1 s\u00e9lection.
          Miroir du pattern BatchReconstituerBar de JustificatifsPage. */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 bg-surface border border-primary/40 rounded-xl shadow-2xl backdrop-blur-sm">
          <div className="flex items-center gap-2 pr-4 border-r border-border">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold">
              {selected.size}
            </span>
            <span className="text-sm text-text">
              {selected.size === 1 ? 'fichier s\u00e9lectionn\u00e9' : 'fichiers s\u00e9lectionn\u00e9s'}
            </span>
            {(() => {
              const nonCanonInSel = items.filter(i => selected.has(i.filename) && !i.is_canonical).length
              return nonCanonInSel > 0 ? (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[11px] border border-amber-500/30"
                  title={`${nonCanonInSel} fichier(s) non-canonique(s) dans la s\u00e9lection`}
                >
                  <AlertTriangle size={11} /> {nonCanonInSel} non-canon.
                </span>
              ) : null
            })()}
          </div>
          <button
            type="button"
            onClick={handleProcessBatch}
            disabled={batchRunning}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              batchRunning
                ? 'bg-primary/50 text-white/70 cursor-not-allowed'
                : 'bg-primary text-white hover:bg-primary/90',
            )}
            title="Lance l'OCR sur tous les fichiers s\u00e9lectionn\u00e9s (background)"
          >
            {batchRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Lancer OCR ({selected.size})
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={batchRunning}
            className="p-2 rounded-md text-text-muted hover:text-text hover:bg-surface-hover"
            title="D\u00e9s\u00e9lectionner tout"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Preview drawer inline — PDF sandbox en grand format */}
      {previewFilename && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-in fade-in"
            onClick={() => setPreviewFilename(null)}
            aria-hidden
          />

          {/* Drawer slide-from-right */}
          <div
            className={cn(
              'fixed top-0 right-0 h-full w-[720px] max-w-[95vw] bg-background',
              'border-l border-border shadow-2xl z-50 flex flex-col',
              'transition-transform duration-300 translate-x-0',
            )}
            role="dialog"
            aria-modal="true"
            aria-label={`Aperçu PDF : ${previewFilename}`}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
              <FileText size={16} className="text-primary shrink-0" />
              <span
                className="text-xs font-mono text-text truncate flex-1"
                title={previewFilename}
              >
                {previewFilename}
              </span>
              <a
                href={`/api/sandbox/${encodeURIComponent(previewFilename)}/preview`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-primary/20 hover:bg-primary/30 text-text transition-colors shrink-0"
                title="Ouvrir dans un nouvel onglet"
              >
                <ExternalLink size={12} />
                Ouvrir dans un onglet
              </a>
              <button
                onClick={() => setPreviewFilename(null)}
                className="p-1 text-text-muted hover:text-text rounded-md hover:bg-surface"
                title="Fermer (Esc)"
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </div>

            {/* PDF natif via <object> — toolbar PDF du navigateur (zoom, scroll, print) */}
            <div className="flex-1 min-h-0 p-3">
              <div className="w-full h-full rounded-md overflow-hidden border border-border bg-surface">
                <object
                  key={previewFilename}
                  data={`/api/sandbox/${encodeURIComponent(previewFilename)}/preview#toolbar=1`}
                  type="application/pdf"
                  className="w-full h-full"
                >
                  <div className="flex items-center justify-center h-full text-text-muted text-xs p-6 text-center">
                    Impossible d'afficher le PDF dans ce navigateur.
                    <br />
                    Utilise « Ouvrir dans un onglet » pour le voir.
                  </div>
                </object>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
