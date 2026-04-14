import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  X, FileText, ExternalLink, Download, Save, Trash2, Loader2, Receipt, Pencil,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import GedMetadataEditor from './GedMetadataEditor'
import JustificatifOperationLink from '@/components/shared/JustificatifOperationLink'
import OcrEditDrawer from '@/components/ocr/OcrEditDrawer'
import { useGedUpdateDocument, useGedDeleteDocument, useGedOpenNative } from '@/hooks/useGed'
import { useOcrHistory } from '@/hooks/useOcr'
import { useDeleteJustificatif } from '@/hooks/useJustificatifs'
import { showDeleteConfirmToast, showDeleteSuccessToast } from '@/lib/deleteJustificatifToast'
import type { GedDocument, PosteComptable, OCRHistoryItem } from '@/types'

interface GedDocumentDrawerProps {
  docId: string | null
  postes: PosteComptable[]
  onClose: () => void
}

const MIN_WIDTH = 400
const MAX_WIDTH = 1200
const DEFAULT_WIDTH = 700

export default function GedDocumentDrawer({ docId, postes, onClose }: GedDocumentDrawerProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const open = docId != null
  const [localDoc, setLocalDoc] = useState<GedDocument | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_WIDTH)
  const [showOcrEdit, setShowOcrEdit] = useState(false)
  const isResizing = useRef(false)

  const updateMutation = useGedUpdateDocument()
  const deleteMutation = useGedDeleteDocument()
  const deleteJustifMutation = useDeleteJustificatif()
  const openNativeMutation = useGedOpenNative()
  const { data: ocrHistory } = useOcrHistory(2000)

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
  const basename = docId?.split('/').pop() ?? ''
  const isJustificatif = localDoc?.type === 'justificatif'

  // Item OCR pour OcrEditDrawer (fallback synthétique si pas trouvé dans l'historique)
  const ocrItem: OCRHistoryItem | null = useMemo(() => {
    if (!basename || !isJustificatif) return null
    const found = ocrHistory?.find(i => i.filename === basename)
    if (found) return found
    return {
      filename: basename,
      processed_at: '',
      status: 'manual',
      processing_time_ms: 0,
      dates_found: localDoc?.date_document ? [localDoc.date_document] : [],
      amounts_found: localDoc?.montant != null ? [localDoc.montant] : [],
      supplier: localDoc?.fournisseur ?? '',
      confidence: 0,
      best_date: localDoc?.date_document ?? null,
      best_amount: localDoc?.montant ?? null,
      category_hint: localDoc?.categorie ?? null,
      sous_categorie_hint: localDoc?.sous_categorie ?? null,
    }
  }, [basename, isJustificatif, ocrHistory, localDoc])

  const handleDeleteJustificatif = () => {
    if (!docId) return
    const filename = docId.split('/').pop() ?? ''
    const opLibelle = localDoc?.operation_ref
      ? `opération #${localDoc.operation_ref.index}`
      : null
    showDeleteConfirmToast(filename, opLibelle, () => {
      deleteJustifMutation.mutate(filename, {
        onSuccess: (result) => {
          showDeleteSuccessToast(result)
          onClose()
        },
        onError: (err: Error) => toast.error(`Erreur : ${err.message}`),
      })
    })
  }

  const handleOcrEditClose = () => {
    setShowOcrEdit(false)
    // Le filename peut avoir changé suite à un rename canonique → le doc_id actuel
    // est potentiellement obsolète. On invalide + on ferme le drawer parent.
    queryClient.invalidateQueries({ queryKey: ['ged-documents'] })
    queryClient.invalidateQueries({ queryKey: ['ged-tree'] })
    queryClient.invalidateQueries({ queryKey: ['ged-stats'] })
    queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
    onClose()
  }

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
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <FileText size={18} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text truncate">{name}</p>
              <p className="text-xs text-text-muted">{localDoc?.type || ''}</p>
            </div>
          </div>
          {isJustificatif && (
            <button
              onClick={() => setShowOcrEdit(true)}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium bg-[#FAEEDA] text-[#854F0B] border border-[#FAC775] hover:bg-[#FAC775]/40 transition-colors shrink-0"
              title="Corriger supplier / date / montant / catégorie"
            >
              <Pencil size={12} />
              Mal nommé ? Éditer OCR
            </button>
          )}
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text transition-colors shrink-0">
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
              showEditorLink
              className="mt-3"
            />
          )}

          {/* Lien module source (charges forfaitaires) */}
          {(localDoc?.source_module === 'charges-forfaitaires' || localDoc?.doc_id?.includes('blanchissage_')) && (
            <button
              onClick={() => { navigate('/charges-forfaitaires'); onClose() }}
              className="flex items-center gap-2 mt-3 px-3 py-2 bg-primary/10 text-primary rounded-lg text-sm hover:bg-primary/20 transition-colors w-full"
            >
              <Receipt size={16} />
              Voir dans Charges forfaitaires
            </button>
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
            {isJustificatif && (
              <button
                onClick={() => setShowOcrEdit(true)}
                className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-xs hover:bg-surface-hover transition-colors"
              >
                <Pencil size={14} />
                Éditer données OCR
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-xs hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Sauvegarder
            </button>
          </div>

          {/* Delete zone — justificatif : toast centré + nettoyage complet */}
          {isJustificatif ? (
            <div className="border-t border-border pt-4">
              <button
                onClick={handleDeleteJustificatif}
                disabled={deleteJustifMutation.isPending}
                className="flex items-center gap-2 text-red-400/80 hover:text-red-400 text-xs transition-colors disabled:opacity-50"
              >
                {deleteJustifMutation.isPending
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Trash2 size={13} />
                }
                Supprimer le justificatif
              </button>
              <p className="text-[11px] text-text-muted mt-1">
                Supprime le PDF, le cache OCR, la thumbnail et délie les opérations associées.
              </p>
            </div>
          ) : (localDoc?.type && !['releve', 'rapport'].includes(localDoc.type)) ? (
            /* Anciens types (document_libre + custom) — confirmation inline préservée */
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
          ) : null}
        </div>
      </div>

      {/* OcrEditDrawer en overlay (justificatif uniquement) */}
      <OcrEditDrawer
        open={showOcrEdit}
        item={ocrItem}
        onClose={handleOcrEditClose}
      />
    </>
  )
}
