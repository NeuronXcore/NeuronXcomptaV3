import { ExternalLink, FileText, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  filename: string | null
  mainDrawerOpen: boolean
  /** Largeur du drawer principal en pixels (pour positionner ce sub-drawer
   *  juste à sa gauche via right-{mainDrawerWidth}px).
   *  Default 680 (ScanRenameDrawer). OcrEditDrawer utilise 720. */
  mainDrawerWidth?: number
  /** Largeur du sub-drawer en pixels. Default 600. */
  width?: number
  /** Si fourni, affiche un bouton « Ouvrir avec Aperçu » dans le header. */
  onOpenNative?: (filename: string) => void
  onClose: () => void
}

/**
 * Sous-drawer de preview PDF grand format, positionné à la gauche d'un drawer
 * principal (ScanRenameDrawer, OcrEditDrawer, ...).
 *
 * Slide depuis la droite → vient se coller à gauche du main drawer. Le PDF
 * s'affiche en grand via `<object type="application/pdf">` avec toolbar native.
 *
 * Design constraints :
 * - Si le main drawer est fermé, on ne rend PAS du tout (return null) pour
 *   éviter qu'un état "fermé" avec `translate-x-full` ne produise un drawer
 *   vide visible décalé (positionné à `right-{mainDrawerWidth}px`).
 * - z-40 (sous le main drawer z-50). Quand le sub est "fermé" via
 *   `translate-x-full`, il slide SOUS le main drawer qui le masque.
 */
export default function PreviewSubDrawer({
  filename,
  mainDrawerOpen,
  mainDrawerWidth = 680,
  width = 600,
  onOpenNative,
  onClose,
}: Props) {
  if (!mainDrawerOpen) return null

  const isOpen = !!filename
  const previewUrl = filename
    ? `/api/justificatifs/${encodeURIComponent(filename)}/preview#toolbar=1`
    : ''

  return (
    <div
      className={cn(
        'fixed top-0 h-full bg-background border-l border-r border-border shadow-2xl',
        'z-40 transition-transform duration-300 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
      style={{
        right: `${mainDrawerWidth}px`,
        width: `${width}px`,
        maxWidth: `calc(95vw - ${mainDrawerWidth}px)`,
      }}
    >
      {/* Header compact */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <FileText size={16} className="text-primary shrink-0" />
        <span
          className="text-xs font-mono text-text truncate flex-1"
          title={filename ?? ''}
        >
          {filename}
        </span>
        {onOpenNative && filename && (
          <button
            onClick={() => onOpenNative(filename)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-primary/20 hover:bg-primary/30 text-text transition-colors shrink-0"
            title="Ouvrir avec Aperçu (macOS)"
          >
            <ExternalLink size={12} />
            Ouvrir avec Aperçu
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text"
          title="Fermer (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      {/* PDF fullscreen via <object> natif — toolbar PDF (zoom, scroll, print) */}
      <div className="flex-1 min-h-0 p-3">
        {filename ? (
          <div className="w-full h-full rounded-md overflow-hidden border border-border bg-surface">
            <object
              key={filename}
              data={previewUrl}
              type="application/pdf"
              className="w-full h-full"
            >
              <div className="flex items-center justify-center h-full text-text-muted text-xs">
                Impossible d'afficher le PDF
              </div>
            </object>
          </div>
        ) : null}
      </div>
    </div>
  )
}
