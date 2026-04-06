import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Search, FileText, Check, Unlink, ArrowRight, ExternalLink } from 'lucide-react'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/api/client'
import { useOperationSuggestions } from '@/hooks/useRapprochement'
import { useAssociate, useDissociate } from '@/hooks/useJustificatifs'
import ReconstituerButton from '@/components/ocr/ReconstituerButton'
import toast from 'react-hot-toast'
import type { Operation, RapprochementSuggestion } from '@/types'

interface JustificatifAttributionDrawerProps {
  open: boolean
  onClose: () => void
  operation: Operation | null
  operationFile: string
  operationIndex: number
  onNextWithout: () => void
}

type SuggestionSort = 'score' | 'date' | 'montant'

function getPreviewBasename(file: string): string {
  return file.split('/').pop() ?? file
}

export default function JustificatifAttributionDrawer({
  open,
  onClose,
  operation,
  operationFile,
  operationIndex,
  onNextWithout,
}: JustificatifAttributionDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SuggestionSort>('score')
  const [previewFile, setPreviewFile] = useState<string | null>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Drawer width resizable (bord gauche)
  const [drawerWidth, setDrawerWidth] = useState(() => {
    const saved = localStorage.getItem('neuronx-justif-drawer-width')
    return saved ? parseInt(saved) : 800
  })
  const drawerResizing = useRef(false)

  // Split resizable (panneau gauche / droit)
  const [splitX, setSplitX] = useState(() => {
    const saved = localStorage.getItem('neuronx-justif-drawer-split')
    return saved ? parseInt(saved) : 400
  })
  const splitDragging = useRef(false)
  const splitXRef = useRef(splitX)
  splitXRef.current = splitX

  // Suggestions
  const { data: suggestions = [], isLoading: suggestionsLoading } = useOperationSuggestions(
    open ? operationFile : null,
    open ? operationIndex : null
  )

  // Mutations
  const associateMutation = useAssociate()
  const dissociateMutation = useDissociate()

  // Si l'op a déjà un justificatif, prévisualiser par défaut
  useEffect(() => {
    if (open && operation?.['Lien justificatif']) {
      setPreviewFile(operation['Lien justificatif'])
    } else {
      setPreviewFile(null)
    }
    setSearch('')
  }, [open, operation])

  // Filtrer et trier les suggestions
  const filteredSuggestions = (() => {
    let items = suggestions.filter(
      (s): s is RapprochementSuggestion => 'justificatif_filename' in s
    )

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(s =>
        s.justificatif_filename.toLowerCase().includes(q)
      )
    }

    items.sort((a, b) => {
      switch (sortBy) {
        case 'score': return (b.score?.total ?? 0) - (a.score?.total ?? 0)
        case 'date': return (b.operation_date ?? '').localeCompare(a.operation_date ?? '')
        case 'montant': return Math.abs(b.operation_montant ?? 0) - Math.abs(a.operation_montant ?? 0)
        default: return 0
      }
    })

    return items
  })()

  // Hover preview avec debounce
  const handleMouseEnter = useCallback((filename: string) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    hoverTimeout.current = setTimeout(() => {
      setPreviewFile(filename)
    }, 300)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
  }, [])

  // Attribution
  const handleAssociate = useCallback((justificatifFilename: string) => {
    associateMutation.mutate(
      {
        justificatif_filename: justificatifFilename,
        operation_file: operationFile,
        operation_index: operationIndex,
      },
      {
        onSuccess: () => {
          toast.success('Justificatif attribué')
          onNextWithout()
        },
        onError: () => {
          toast.error("Erreur lors de l'attribution")
        },
      }
    )
  }, [associateMutation, operationFile, operationIndex, onNextWithout])

  // Dissociation
  const handleDissociate = useCallback(() => {
    dissociateMutation.mutate(
      {
        operation_file: operationFile,
        operation_index: operationIndex,
      },
      {
        onSuccess: () => {
          toast.success('Justificatif dissocié')
          setPreviewFile(null)
        },
        onError: () => {
          toast.error('Erreur lors de la dissociation')
        },
      }
    )
  }, [dissociateMutation, operationFile, operationIndex])

  // Ouvrir dans Aperçu (macOS native)
  const handleOpenNative = useCallback((filename: string) => {
    const basename = getPreviewBasename(filename)
    api.post(`/justificatifs/${encodeURIComponent(basename)}/open-native`)
      .then(() => toast.success('Ouvert dans Aperçu'))
      .catch(() => toast.error("Impossible d'ouvrir le fichier"))
  }, [])

  // Drawer resize (bord gauche)
  const onDrawerResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    drawerResizing.current = true
    const startX = e.clientX
    const startW = drawerWidth
    const onMove = (ev: MouseEvent) => {
      if (!drawerResizing.current) return
      const delta = startX - ev.clientX
      setDrawerWidth(Math.max(600, Math.min(startW + delta, 1400)))
    }
    const onUp = () => {
      drawerResizing.current = false
      localStorage.setItem('neuronx-justif-drawer-width', String(drawerWidth))
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [drawerWidth])

  // Split resize (panneau gauche / droit)
  const onSplitDown = useCallback((e: React.MouseEvent) => {
    splitDragging.current = true
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      if (!splitDragging.current) return
      const drawerEl = drawerRef.current
      if (!drawerEl) return
      const rect = drawerEl.getBoundingClientRect()
      const newX = ev.clientX - rect.left
      setSplitX(Math.max(250, Math.min(newX, drawerWidth - 250)))
    }
    const onUp = () => {
      splitDragging.current = false
      localStorage.setItem('neuronx-justif-drawer-split', String(splitXRef.current))
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [drawerWidth])

  const montant = operation ? ((operation['Débit'] ?? 0) || (operation['Crédit'] ?? 0)) : 0
  const linkedJustif = operation?.['Lien justificatif']

  const scoreColor = (total: number) => {
    if (total >= 80) return 'bg-emerald-500/20 text-emerald-400'
    if (total >= 50) return 'bg-amber-500/20 text-amber-400'
    return 'bg-zinc-500/20 text-text-muted'
  }

  const previewBasename = previewFile ? getPreviewBasename(previewFile) : null

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={cn(
          'fixed top-0 right-0 h-full bg-background border-l border-border z-50',
          'flex flex-col transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ width: drawerWidth }}
      >
        {/* Poignée resize drawer (bord gauche) */}
        <div
          className="absolute left-0 top-0 h-full w-2 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
          onMouseDown={onDrawerResizeDown}
        />

        {/* Header */}
        <div className="flex-shrink-0 p-4 border-b border-border">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-text">Attribution justificatif</h2>
              <p className="text-sm text-text-muted mt-1 truncate">
                {operation ? `${formatDate(operation.Date)} — ${operation['Libellé']} — ${formatCurrency(montant)}` : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text rounded transition-colors ml-2"
            >
              <X size={20} />
            </button>
          </div>

          {/* Justificatif déjà lié */}
          {linkedJustif && (
            <div className="mt-3 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              <Check size={16} className="text-emerald-400 flex-shrink-0" />
              <span className="text-sm text-emerald-400 truncate flex-1">
                {linkedJustif}
              </span>
              <button
                onClick={() => handleOpenNative(linkedJustif)}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
                title="Ouvrir avec Aperçu"
              >
                <ExternalLink size={14} />
                Aperçu
              </button>
              <button
                onClick={handleDissociate}
                disabled={dissociateMutation.isPending}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                <Unlink size={14} />
                Dissocier
              </button>
            </div>
          )}
        </div>

        {/* Content split */}
        <div className="flex-1 flex min-h-0">
          {/* Panneau gauche — suggestions */}
          <div
            className="flex flex-col border-r border-border flex-shrink-0"
            style={{ width: splitX }}
          >
            {/* Recherche + tri */}
            <div className="p-3 border-b border-border space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  placeholder="Rechercher un justificatif..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface border border-border rounded text-text placeholder:text-text-muted/50"
                />
              </div>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SuggestionSort)}
                className="w-full text-xs bg-surface border border-border rounded px-2 py-1 text-text"
              >
                <option value="score">Par score ↓</option>
                <option value="date">Par date ↓</option>
                <option value="montant">Par montant ↓</option>
              </select>
            </div>

            {/* Liste suggestions */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {suggestionsLoading ? (
                <div className="flex items-center justify-center h-32 text-text-muted text-sm">
                  Chargement...
                </div>
              ) : filteredSuggestions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-text-muted text-sm gap-2">
                  <FileText size={24} />
                  <span>Aucune suggestion</span>
                </div>
              ) : (
                filteredSuggestions.map((s) => (
                  <div
                    key={s.justificatif_filename}
                    className="p-2.5 bg-surface rounded-lg border border-border hover:border-primary/40 transition-colors cursor-pointer group"
                    onMouseEnter={() => handleMouseEnter(s.justificatif_filename)}
                    onMouseLeave={handleMouseLeave}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text truncate font-medium">
                          {s.justificatif_filename}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                          {s.operation_date && <span>{formatDate(s.operation_date)}</span>}
                          {s.operation_montant !== undefined && (
                            <span>{formatCurrency(Math.abs(s.operation_montant))}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {s.score && (
                          <span className={cn(
                            'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                            scoreColor(s.score.total)
                          )}>
                            {Math.round(s.score.total)}%
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAssociate(s.justificatif_filename)
                          }}
                          disabled={associateMutation.isPending}
                          className="flex items-center gap-1 text-[10px] bg-primary/15 text-primary rounded px-2 py-1 hover:bg-primary/25 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <ArrowRight size={12} />
                          Attribuer
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Reconstituer en bas */}
            {!linkedJustif && operation && (
              <div className="flex-shrink-0 p-3 border-t border-border">
                <ReconstituerButton
                  operationFile={operationFile}
                  operationIndex={operationIndex}
                  libelle={operation['Libellé'] ?? ''}
                  size="md"
                  className="w-full justify-center"
                  onGenerated={() => {
                    toast.success('Justificatif reconstitué')
                  }}
                />
              </div>
            )}
          </div>

          {/* Poignée resize split */}
          <div
            className="w-1 cursor-col-resize bg-border hover:bg-primary flex-shrink-0 transition-colors"
            onMouseDown={onSplitDown}
          />

          {/* Panneau droit — preview PDF */}
          <div className="flex-1 min-w-0 flex flex-col">
            {previewBasename ? (
              <>
                {/* Barre d'actions preview */}
                <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface/50">
                  <span className="text-xs text-text-muted truncate">{previewBasename}</span>
                  <button
                    onClick={() => handleOpenNative(previewFile!)}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors flex-shrink-0"
                    title="Ouvrir avec Aperçu"
                  >
                    <ExternalLink size={12} />
                    Ouvrir avec Aperçu
                  </button>
                </div>
                <object
                  data={`/api/justificatifs/${encodeURIComponent(previewBasename)}/preview#toolbar=1`}
                  type="application/pdf"
                  className="w-full flex-1"
                >
                  <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-3 h-full">
                    <FileText size={48} className="opacity-30" />
                    <p className="text-sm">Impossible d&apos;afficher le PDF</p>
                    <button
                      onClick={() => handleOpenNative(previewFile!)}
                      className="text-primary text-sm hover:underline flex items-center gap-1"
                    >
                      <ExternalLink size={14} />
                      Ouvrir avec Aperçu
                    </button>
                  </div>
                </object>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-3">
                <FileText size={48} className="opacity-30" />
                <p className="text-sm">Survoler un justificatif pour prévisualiser</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
