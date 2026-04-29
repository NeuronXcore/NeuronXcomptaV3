import { useEffect } from 'react'
import { FileText, X, ExternalLink } from 'lucide-react'

/**
 * Lightbox plein écran pour preview PDF justificatif.
 *
 * Composant partagé extrait de `PendingScansWidget` (Session 35) — réutilisé
 * par le drawer `ImmobilisationDrawer` et la cellule paperclip du registre
 * Amortissements. Modal z-60 backdrop noir 80% + blur, card centrale
 * `90vw × 90vh max 1100px`, clic backdrop = close, Esc = close.
 *
 * Le bouton « Ouvrir dans un onglet » externe utilise `target="_blank"`
 * vers `/api/justificatifs/{filename}/preview` — sur macOS, l'utilisateur
 * peut ensuite faire « Ouvrir avec → Aperçu » depuis le navigateur.
 *
 * `filename === null` = fermé (le composant ne rend rien).
 */
export interface JustifPreviewLightboxProps {
  filename: string | null
  onClose: () => void
  /**
   * Override le comportement du bouton « Ouvrir dans un onglet ». Si non
   * fourni, ouvre `target="_blank"` vers le PDF preview natif. Les appelants
   * qui veulent par exemple chaîner avec un POST `/open-native` peuvent
   * passer leur propre handler.
   */
  onOpenExternal?: () => void
}

export default function JustifPreviewLightbox({
  filename,
  onClose,
  onOpenExternal,
}: JustifPreviewLightboxProps) {
  // Esc pour fermer (en mode capture pour stopper la propagation vers
  // d'éventuels parents qui auraient leur propre handler Esc — voir
  // ImmobilisationDrawer / PreviewSubDrawer).
  useEffect(() => {
    if (!filename) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [filename, onClose])

  if (!filename) return null

  // PDF stream — endpoint backend résout auto en_attente/ vs traites/
  const previewUrl = `/api/justificatifs/${encodeURIComponent(filename)}/preview`

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-lg shadow-2xl flex flex-col w-[90vw] max-w-[1100px] h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={16} className="text-text-muted shrink-0" />
            <span className="text-sm font-medium text-text truncate" title={filename}>
              {filename}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onOpenExternal ? (
              <button
                onClick={onOpenExternal}
                className="p-1.5 text-text-muted hover:text-text rounded-md hover:bg-surface-hover transition-colors"
                title="Ouvrir dans Aperçu"
                type="button"
              >
                <ExternalLink size={14} />
              </button>
            ) : (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 text-text-muted hover:text-text rounded-md hover:bg-surface-hover transition-colors"
                title="Ouvrir dans un nouvel onglet"
              >
                <ExternalLink size={14} />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-text-muted hover:text-text rounded-md hover:bg-surface-hover transition-colors"
              title="Fermer (Esc)"
              type="button"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 bg-black/50">
          <object
            data={previewUrl}
            type="application/pdf"
            className="w-full h-full"
            aria-label={`Aperçu de ${filename}`}
          >
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Le navigateur ne peut pas afficher ce PDF.{' '}
              <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline">
                Ouvrir dans un onglet
              </a>
            </div>
          </object>
        </div>
      </div>
    </div>
  )
}
