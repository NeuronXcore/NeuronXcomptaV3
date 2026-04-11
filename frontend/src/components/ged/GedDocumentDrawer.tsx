import { useState, useEffect, useCallback, useRef } from 'react'
import {
  X, FileText, ExternalLink, Download, Save, Trash2, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import GedMetadataEditor from './GedMetadataEditor'
import JustificatifOperationLink from '@/components/shared/JustificatifOperationLink'
import { useGedUpdateDocument, useGedDeleteDocument, useGedOpenNative } from '@/hooks/useGed'
import type { GedDocument, PosteComptable } from '@/types'

interface GedDocumentDrawerProps {
  docId: string | null
  postes: PosteComptable[]
  onClose: () => void
}

const MIN_WIDTH = 400
const MAX_WIDTH = 1200
const DEFAULT_WIDTH = 700

export default function GedDocumentDrawer({ docId, postes, onClose }: GedDocumentDrawerProps) {
  const open = docId != null
  const [localDoc, setLocalDoc] = useState<GedDocument | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_WIDTH)
  const isResizing = useRef(false)

  const updateMutation = useGedUpdateDocument()
  const deleteMutation = useGedDeleteDocument()
  const openNativeMutation = useGedOpenNative()

  // Fetch doc data
  useEffect(() => {
    if (!docId) { setLocalDoc(null); return }
    fetch(`/api/ged/documents?search=`)
      .then(r => r.json())
      .then((docs: GedDocument[]) => {
        const found = docs.find(d => d.doc_id === docId)
        if (found) setLocalDoc({ ...found })
      })
      .catch(() => setLocalDoc(null))
  }, [docId])

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    setDeleteConfirm(false)
  }, [docId])

  // ── Resize logic ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const startX = e.clientX
    const startWidth = drawerWidth

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const delta = startX - e.clientX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta))
      setDrawerWidth(newWidth)
    }

    const handleMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [drawerWidth])

  const handleChange = (updates: Record<string, unknown>) => {
    if (!localDoc) return
    setLocalDoc(prev => prev ? { ...prev, ...updates } as GedDocument : null)
  }

  const handleSave = () => {
    if (!localDoc || !docId) return
    updateMutation.mutate({
      docId,
      updates: {
        poste_comptable: localDoc.poste_comptable,
        categorie: localDoc.categorie,
        sous_categorie: localDoc.sous_categorie,
        tags: localDoc.tags,
        notes: localDoc.notes,
        montant_brut: localDoc.montant_brut,
        deductible_pct_override: localDoc.deductible_pct_override,
      },
    })
  }

  const handleDelete = () => {
    if (!docId) return
    deleteMutation.mutate(docId, { onSuccess: () => onClose() })
  }

  const previewUrl = docId ? `/api/ged/documents/${encodeURIComponent(docId)}/preview` : ''
  const name = localDoc?.original_name || docId?.split('/').pop() || ''

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40 transition-opacity" onClick={onClose} />
      )}

      <div
        className={cn(
          'fixed top-0 right-0 h-full bg-background border-l border-border z-50 flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{
          width: `${drawerWidth}px`,
          maxWidth: '95vw',
          transition: isResizing.current ? 'none' : 'transform 300ms',
        }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 group hover:bg-primary/30 active:bg-primary/50 transition-colors"
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-12 rounded-full bg-border group-hover:bg-primary transition-colors" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <FileText size={18} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text truncate">{name}</p>
              <p className="text-xs text-text-muted">{localDoc?.type || ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Preview (PDF or image) */}
          {docId && (
            <div className="rounded-lg border border-border overflow-hidden bg-white">
              {name.match(/\.(jpg|jpeg|png)$/i) ? (
                <img src={previewUrl} alt={name} className="w-full h-auto max-h-[45vh] object-contain" />
              ) : (
                <iframe src={previewUrl} className="w-full h-[45vh]" title="Preview" />
              )}
            </div>
          )}

          {/* Metadata editor */}
          {localDoc && (
            <GedMetadataEditor document={localDoc} postes={postes} onChange={handleChange} />
          )}

          {/* Lien opération (justificatifs uniquement) */}
          {docId && docId.includes('justificatifs/') && (
            <JustificatifOperationLink
              justificatifFilename={docId.split('/').pop() || ''}
              isAssociated={docId.includes('/traites/')}
              className="mt-3"
            />
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => { if (docId) openNativeMutation.mutate(docId) }}
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-xs hover:bg-surface-hover transition-colors"
            >
              <ExternalLink size={14} />
              Ouvrir dans Aperçu
            </button>
            <a
              href={previewUrl}
              download
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-xs hover:bg-surface-hover transition-colors"
            >
              <Download size={14} />
              Télécharger
            </a>
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-xs hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Sauvegarder
            </button>
          </div>

          {/* Delete zone — for document_libre and custom types (not releve/justificatif/rapport) */}
          {localDoc?.type && !['releve', 'justificatif', 'rapport'].includes(localDoc.type) && (
            <div className="border-t border-border pt-4">
              {deleteConfirm ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-red-400">Supprimer ce document ?</span>
                  <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs hover:bg-red-500/30"
                  >
                    {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Confirmer'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    className="px-3 py-1.5 bg-surface-hover text-text-muted rounded-lg text-xs"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="flex items-center gap-2 text-red-400/70 hover:text-red-400 text-xs transition-colors"
                >
                  <Trash2 size={13} />
                  Supprimer ce document
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
