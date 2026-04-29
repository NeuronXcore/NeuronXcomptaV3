import { ExternalLink, FileText, X, Maximize2 } from 'lucide-react'
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
  /** Si fourni, affiche un bouton « Voir en plein écran » qui passe la main
   *  à un `JustifPreviewLightbox` géré par le parent. */
  onOpenLightbox?: () => void
  onClose: () => void
  /** Override le z-index par défaut (40). Utile quand le drawer parent est à
   *  z-60/70 (ex. JustifToOpDrawer) — passer un z-index intermédiaire qui
   *  reste sous le drawer parent mais au-dessus de son backdrop. */
  zIndex?: number
  /**
   * Mode standalone : ancre `right-0` au lieu de `right-{mainDrawerWidth}px`
   * et affiche un backdrop noir (utilisé quand on ouvre le sub-drawer depuis
   * un endroit qui n'a pas de drawer principal — ex. cellule paperclip du
   * registre Amortissements). En mode standalone, `mainDrawerOpen` est
   * ignoré (le sub-drawer apparaît dès que `filename` non-null).
   */
  standalone?: boolean
}

/**
 * Sous-drawer de preview PDF grand format, positionné à la gauche d'un drawer
 * principal (ScanRenameDrawer, OcrEditDrawer, ...) ou en mode standalone
 * (cellule paperclip du registre Amortissements).
 *
 * Slide depuis la droite → vient se coller à gauche du main drawer. Le PDF
 * s'affiche en grand via `<object type="application/pdf">` avec toolbar native.
 *
 * Design constraints :
 * - Si le main drawer est fermé ET pas en mode standalone, on ne rend PAS du
 *   tout (return null) pour éviter qu'un état "fermé" avec `translate-x-full`
 *   ne produise un drawer vide visible décalé.
 * - z-40 (sous le main drawer z-50). Quand le sub est "fermé" via
 *   `translate-x-full`, il slide SOUS le main drawer qui le masque.
 */
export default function PreviewSubDrawer({
  filename,
  mainDrawerOpen,
  mainDrawerWidth = 680,
  width = 600,
  onOpenNative,
  onOpenLightbox,
  onClose,
  zIndex,
  standalone = false,
}: Props) {
  if (!standalone && !mainDrawerOpen) return null

  const isOpen = !!filename
  const previewUrl = filename
    ? `/api/justificatifs/${encodeURIComponent(filename)}/preview#toolbar=1`
    : ''

  // En mode standalone : ancre `right-0`, pas d'offset main drawer.
  const rightOffset = standalone ? 0 : mainDrawerWidth
  const computedZ = zIndex ?? (standalone ? 50 : 40)

  return (
    <>
      {/* Backdrop standalone uniquement (en mode with-main, le main drawer
          a déjà son propre backdrop). */}
      {standalone && isOpen && (
        <div
          className="fixed inset-0 bg-black/55 backdrop-blur-sm"
          style={{ zIndex: computedZ - 1 }}
          onClick={onClose}
        />
      )}
      <div
        className={cn(
          'fixed top-0 h-full bg-background border-l border-r border-border shadow-2xl',
          'transition-transform duration-300 flex flex-col',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{
          right: `${rightOffset}px`,
          width: `${width}px`,
          maxWidth: standalone ? '95vw' : `calc(95vw - ${mainDrawerWidth}px)`,
          zIndex: computedZ,
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
          {onOpenLightbox && filename && (
            <button
              onClick={onOpenLightbox}
              className="p-1.5 text-text-muted hover:text-text rounded-md hover:bg-surface-hover transition-colors shrink-0"
              title="Voir en plein écran"
              type="button"
            >
              <Maximize2 size={14} />
            </button>
          )}
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
    </>
  )
}
