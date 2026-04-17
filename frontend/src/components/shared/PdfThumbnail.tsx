import { useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Vignette PNG réutilisable pour les PDF justificatifs / docs GED.
 *
 * Utilise les endpoints thumbnail du backend (cache PNG 200px) au lieu d'un
 * `<object>` ou d'un `<iframe>` pointant vers `/preview` — le plugin PDF du
 * navigateur se décharge silencieusement en grille, ce qui force un hard refresh.
 * Une `<img>` native + IntersectionObserver scale bien à 50+ instances.
 *
 * Props:
 * - `docId` : chemin relatif GED (`data/ged/...`) → `/api/ged/documents/{id}/thumbnail`
 * - `justificatifFilename` : basename justificatif → `/api/justificatifs/{name}/thumbnail`
 *   (endpoint qui résout automatiquement `en_attente/` ou `traites/`)
 * - `cacheBuster` : suffix optionnel `?v=…` pour invalider le cache browser
 * - `lazy` : active l'IntersectionObserver (par défaut `true`)
 */
interface PdfThumbnailProps {
  docId?: string
  justificatifFilename?: string
  sandboxFilename?: string
  alt?: string
  className?: string
  iconSize?: number
  cacheBuster?: string
  lazy?: boolean
  onClick?: () => void
}

type Status = 'idle' | 'loading' | 'loaded' | 'error'

export default function PdfThumbnail({
  docId,
  justificatifFilename,
  sandboxFilename,
  alt,
  className,
  iconSize = 20,
  cacheBuster,
  lazy = true,
  onClick,
}: PdfThumbnailProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!lazy)
  const [status, setStatus] = useState<Status>('idle')

  // Construction URL — sandbox isolé de justificatifs/GED (cache séparé).
  let url: string | null = null
  if (docId) {
    url = `/api/ged/documents/${encodeURIComponent(docId)}/thumbnail`
  } else if (justificatifFilename) {
    url = `/api/justificatifs/${encodeURIComponent(justificatifFilename)}/thumbnail`
  } else if (sandboxFilename) {
    url = `/api/sandbox/${encodeURIComponent(sandboxFilename)}/thumbnail`
  }
  if (url && cacheBuster) {
    url += (url.includes('?') ? '&' : '?') + `v=${encodeURIComponent(cacheBuster)}`
  }

  // IntersectionObserver pour lazy-load dans les scrollers internes
  // (le loading="lazy" natif ne détecte pas les scrolls non-viewport).
  useEffect(() => {
    if (!lazy || visible) return
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
  }, [lazy, visible])

  const showImage = url && visible && status !== 'error'
  const showPlaceholder = !showImage

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={cn(
        'relative overflow-hidden bg-surface border border-border',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {showImage && (
        <img
          src={url!}
          alt={alt || 'Aperçu document'}
          loading="lazy"
          className="w-full h-full object-cover"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      )}
      {showPlaceholder && (
        <span className="absolute inset-0 flex items-center justify-center text-text-muted/50">
          <FileText size={iconSize} />
        </span>
      )}
    </div>
  )
}
