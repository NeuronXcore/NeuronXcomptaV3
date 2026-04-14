import { useEffect } from 'react'
import { FileText, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  /** Doc ID GED (chemin relatif), ouvre le sub-drawer si non-null. */
  docId: string | null
  /** Nom de fichier affiché dans le header. */
  displayName: string
  /** Si le document est une image (jpg/png), on rend un <img> fullscreen
   *  au lieu d'un <object type="application/pdf">. */
  isImage?: boolean
  mainDrawerOpen: boolean
  /** Largeur du drawer principal en px (pour positionner à right:{n}px). */
  mainDrawerWidth: number
  /** Largeur du sub-drawer en px. Default 600. */
  width?: number
  onClose: () => void
}

/**
 * Sous-drawer de preview PDF / image grand format pour la GED, positionné à
 * la gauche du GedDocumentDrawer principal.
 *
 * Même pattern que `components/ocr/PreviewSubDrawer.tsx` — voir ce fichier
 * pour les commentaires de design (z-40 sous le main drawer z-50, return null
 * si main fermé, key={docId} pour forcer le remount du plugin PDF).
 */
export default function GedPreviewSubDrawer({
  docId,
  displayName,
  isImage,
  mainDrawerOpen,
  mainDrawerWidth,
  width = 600,
  onClose,
}: Props) {
  // Esc ferme uniquement le sub-drawer (stopPropagation pour ne pas remonter au main)
  useEffect(() => {
    if (!docId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [docId, onClose])

  if (!mainDrawerOpen) return null

  const isOpen = !!docId
  const previewUrl = docId
    ? `/api/ged/documents/${encodeURIComponent(docId)}/preview${isImage ? '' : '#toolbar=1'}`
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
          title={displayName}
        >
          {displayName}
        </span>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text"
          title="Fermer (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content : PDF ou image grand format */}
      <div className="flex-1 min-h-0 p-3">
        {docId && (
          <div className="w-full h-full rounded-md overflow-hidden border border-border bg-surface flex items-center justify-center">
            {isImage ? (
              <img
                key={docId}
                src={previewUrl}
                alt={displayName}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <object
                key={docId}
                data={previewUrl}
                type="application/pdf"
                className="w-full h-full"
              >
                <div className="flex items-center justify-center h-full text-text-muted text-xs">
                  Impossible d'afficher le PDF
                </div>
              </object>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
