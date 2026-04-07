import { useState } from 'react'
import {
  X, Star, RefreshCw, Download, Trash2, ExternalLink, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToggleReportFavorite, useRegenerateReport, useGedOpenNative, useGedDeleteDocument } from '@/hooks/useGed'
import type { GedDocument } from '@/types'

interface GedReportDrawerProps {
  document: GedDocument
  onClose: () => void
}

export default function GedReportDrawer({ document: doc, onClose }: GedReportDrawerProps) {
  const rm = doc.rapport_meta
  const [editTitle, setEditTitle] = useState(rm?.title || '')
  const [editDesc, setEditDesc] = useState(rm?.description || '')
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const toggleFav = useToggleReportFavorite()
  const regenerate = useRegenerateReport()
  const openNative = useGedOpenNative()
  const deleteMut = useGedDeleteDocument()

  const filename = doc.doc_id.split('/').pop() || ''
  const previewUrl = `/api/reports/preview/${encodeURIComponent(filename)}`
  const downloadUrl = `/api/reports/download/${encodeURIComponent(filename)}`

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[800px] max-w-full bg-background border-l border-border z-50 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            {rm?.favorite && <Star size={16} className="fill-warning text-warning shrink-0" />}
            <h3 className="text-sm font-semibold text-text truncate">{rm?.title || filename}</h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleFav.mutate(doc.doc_id)}
              className={cn(
                'p-1.5 rounded-md text-text-muted hover:text-warning transition-colors',
                rm?.favorite && 'text-warning'
              )}
              title="Favori"
            >
              <Star size={16} className={rm?.favorite ? 'fill-current' : ''} />
            </button>
            <button
              onClick={() => regenerate.mutate(doc.doc_id)}
              className="p-1.5 rounded-md text-text-muted hover:text-primary"
              title="Re-générer"
              disabled={regenerate.isPending}
            >
              {regenerate.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>
            <button
              onClick={() => openNative.mutate(doc.doc_id)}
              className="p-1.5 rounded-md text-text-muted hover:text-text"
              title="Ouvrir dans Aperçu"
            >
              <ExternalLink size={16} />
            </button>
            <a
              href={downloadUrl}
              download
              className="p-1.5 rounded-md text-text-muted hover:text-text"
              title="Télécharger"
            >
              <Download size={16} />
            </a>
            <button onClick={onClose} className="p-1.5 rounded-md text-text-muted hover:text-text">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* PDF Preview */}
        <div className="flex-1 overflow-hidden">
          <object
            data={previewUrl}
            type="application/pdf"
            className="w-full h-full"
          >
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Ouvrir le rapport
              </a>
            </div>
          </object>
        </div>

        {/* Metadata */}
        <div className="border-t border-border p-4 space-y-3 max-h-[200px] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-text-muted">Format</span>
              <p className="text-text font-medium uppercase">{rm?.format || '—'}</p>
            </div>
            <div>
              <span className="text-text-muted">Généré le</span>
              <p className="text-text">{rm?.generated_at ? new Date(rm.generated_at).toLocaleDateString('fr-FR') : '—'}</p>
            </div>
            {doc.categorie && (
              <div>
                <span className="text-text-muted">Catégorie</span>
                <p className="text-text">{doc.categorie}</p>
              </div>
            )}
            {doc.period && (
              <div>
                <span className="text-text-muted">Période</span>
                <p className="text-text">
                  {doc.period.month ? `${doc.period.month}/${doc.period.year}` : doc.period.year}
                </p>
              </div>
            )}
          </div>

          {/* Delete */}
          <div className="flex justify-end">
            {!deleteConfirm ? (
              <button
                onClick={() => setDeleteConfirm(true)}
                className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1"
              >
                <Trash2 size={12} /> Supprimer
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Confirmer ?</span>
                <button
                  onClick={() => { deleteMut.mutate(doc.doc_id); onClose() }}
                  className="text-xs text-red-500 font-medium"
                >
                  Oui
                </button>
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="text-xs text-text-muted"
                >
                  Non
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
