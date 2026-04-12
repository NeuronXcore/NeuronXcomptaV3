import { useEffect } from 'react'
import { X, Download, ExternalLink } from 'lucide-react'

interface PdfPreviewDrawerProps {
  open: boolean
  onClose: () => void
  filename: string
  title: string
  subtitle?: string
}

export default function PdfPreviewDrawer({ open, onClose, filename, title, subtitle }: PdfPreviewDrawerProps) {
  // Esc to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const previewUrl = `/api/reports/preview/${encodeURIComponent(filename)}`

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full z-50 flex flex-col bg-surface border-l border-border shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: 'min(700px, 90vw)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-text truncate">{title}</h3>
            {subtitle && (
              <p className="text-xs text-text-muted truncate mt-0.5">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-background transition-colors"
              title="Ouvrir dans un nouvel onglet"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <a
              href={previewUrl}
              download={filename}
              className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-background transition-colors"
              title="Télécharger"
            >
              <Download className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-background transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* PDF viewer */}
        <div className="flex-1 min-h-0 p-3">
          {open && (
            <object
              key={filename}
              data={previewUrl}
              type="application/pdf"
              className="w-full h-full rounded-lg border border-border bg-background"
            >
              <div className="flex items-center justify-center h-full text-text-muted text-sm">
                Aperçu non disponible
              </div>
            </object>
          )}
        </div>
      </div>
    </>
  )
}
