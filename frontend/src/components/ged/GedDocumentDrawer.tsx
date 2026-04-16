import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  X, FileText, ExternalLink, Download, Save, Trash2, Loader2, Receipt, Pencil, Expand, Link2, LockOpen, Unlink,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import GedMetadataEditor from './GedMetadataEditor'
import JustificatifOperationLink from '@/components/shared/JustificatifOperationLink'
import OcrEditDrawer from '@/components/ocr/OcrEditDrawer'
import JustifToOpDrawer from '@/components/justificatifs/JustifToOpDrawer'
import GedPreviewSubDrawer from './GedPreviewSubDrawer'
import { useGedUpdateDocument, useGedDeleteDocument, useGedOpenNative } from '@/hooks/useGed'
import { useOcrHistory } from '@/hooks/useOcr'
import { useDeleteJustificatif, useDissociate } from '@/hooks/useJustificatifs'
import { useToggleLock } from '@/hooks/useToggleLock'
import { UnlockConfirmModal } from '@/components/UnlockConfirmModal'
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
  const [showPreview, setShowPreview] = useState(false)
  const [justifToOpOpen, setJustifToOpOpen] = useState(false)
  const isResizing = useRef(false)

  const updateMutation = useGedUpdateDocument()
  const deleteMutation = useGedDeleteDocument()
  const deleteJustifMutation = useDeleteJustificatif()
  const dissociateMutation = useDissociate()
  const toggleLockMutation = useToggleLock()
  // Modale confirmation de déverrouillage (mêmes gardes que LockCell)
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false)
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
    setShowPreview(false)
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
  const isImage = /\.(jpe?g|png)$/i.test(name)

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

  const handleDissociate = () => {
    const ref = localDoc?.operation_ref
    if (!ref) return
    dissociateMutation.mutate(
      { operation_file: ref.file, operation_index: ref.index },
      {
        onSuccess: () => {
          toast.success('Justificatif dissocié de l\'opération')
          queryClient.invalidateQueries({ queryKey: ['ged-documents'] })
          queryClient.invalidateQueries({ queryKey: ['ged-stats'] })
          queryClient.invalidateQueries({ queryKey: ['ged-tree'] })
          onClose()
        },
        onError: (err: unknown) => {
          const status = (err as { response?: { status?: number } })?.response?.status
          if (status === 423) {
            toast.error('Opération verrouillée — déverrouillez d\'abord')
          } else {
            toast.error('Erreur lors de la dissociation')
          }
        },
      }
    )
  }

  const handleUnlockConfirm = () => {
    const ref = localDoc?.operation_ref
    if (!ref) { setUnlockConfirmOpen(false); return }
    toggleLockMutation.mutate(
      { filename: ref.file, index: ref.index, locked: false },
      {
        onSuccess: () => {
          toast.success('Opération déverrouillée')
          setUnlockConfirmOpen(false)
          queryClient.invalidateQueries({ queryKey: ['ged-documents'] })
        },
        onError: () => {
          toast.error('Erreur lors du déverrouillage')
          setUnlockConfirmOpen(false)
        },
      }
    )
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
          {/* Preview thumbnail — clic pour ouvrir le sub-drawer grand format */}
          {docId && (
            <div
              className="relative group cursor-pointer rounded-lg border border-border bg-white hover:border-primary/50 transition-colors overflow-hidden flex items-center justify-center"
              onClick={() => setShowPreview(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowPreview(true) } }}
              title="Cliquer pour agrandir"
            >
              <img
                src={isImage ? previewUrl : `/api/ged/documents/${encodeURIComponent(docId)}/thumbnail`}
                alt={name}
                className="w-auto h-auto max-w-full max-h-[45vh] object-contain block"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
              {/* Overlay "Agrandir" au hover */}
              <div className="absolute inset-0 flex items-end justify-end p-3 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/40 to-transparent pointer-events-none">
                <span className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-white/95 text-black rounded-md shadow-lg">
                  <Expand size={12} />
                  Agrandir
                </span>
              </div>
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
            {isJustificatif && localDoc?.statut_justificatif === 'en_attente' && basename && (
              <button
                onClick={() => setJustifToOpOpen(true)}
                className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/40 text-primary rounded-lg text-xs hover:bg-primary/20 transition-colors"
                title="Rechercher l'opération bancaire correspondante"
              >
                <Link2 size={14} />
                Associer à une opération
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

          {/* Actions justificatif : dissocier / déverrouiller / supprimer */}
          {isJustificatif ? (
            <div className="border-t border-border pt-4 space-y-3">
              {/* Ligne 1 : Dissocier + Déverrouiller (visibles uniquement si op liée / verrouillée) */}
              {(localDoc?.operation_ref || localDoc?.op_locked) && (
                <div className="flex flex-wrap items-center gap-2">
                  {localDoc?.operation_ref && (
                    <button
                      onClick={handleDissociate}
                      disabled={dissociateMutation.isPending || !!localDoc?.op_locked}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={
                        localDoc?.op_locked
                          ? 'Opération verrouillée — déverrouillez d\'abord pour dissocier'
                          : 'Dissocier ce justificatif de son opération'
                      }
                    >
                      {dissociateMutation.isPending
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Unlink size={12} />
                      }
                      Dissocier de l'opération
                    </button>
                  )}
                  {localDoc?.op_locked && (
                    <button
                      onClick={() => setUnlockConfirmOpen(true)}
                      disabled={toggleLockMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-warning/15 text-warning border border-warning/40 hover:bg-warning/25 transition-colors disabled:opacity-40"
                      title="Déverrouiller l'opération pour pouvoir la modifier"
                    >
                      {toggleLockMutation.isPending
                        ? <Loader2 size={12} className="animate-spin" />
                        : <LockOpen size={12} />
                      }
                      Déverrouiller l'opération
                    </button>
                  )}
                </div>
              )}

              {/* Ligne 2 : Supprimer (toujours disponible) */}
              <div>
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

      {/* Sous-drawer preview grand format à gauche du main drawer */}
      <GedPreviewSubDrawer
        docId={showPreview ? docId : null}
        displayName={name}
        isImage={isImage}
        mainDrawerOpen={open}
        mainDrawerWidth={drawerWidth}
        onClose={() => setShowPreview(false)}
      />

      {/* Drawer association justificatif → opération (z-60/z-70 au-dessus du main z-40/z-50) */}
      <JustifToOpDrawer
        open={justifToOpOpen}
        onClose={() => {
          setJustifToOpOpen(false)
          // Rafraîchir le doc affiché et les vues GED (le statut peut être passé à 'traite')
          queryClient.invalidateQueries({ queryKey: ['ged-documents'] })
          queryClient.invalidateQueries({ queryKey: ['ged-stats'] })
          queryClient.invalidateQueries({ queryKey: ['ged-tree'] })
        }}
        initialFilename={basename || undefined}
      />

      {/* Modale confirmation de déverrouillage — z-index supérieur au drawer (z-50) */}
      <UnlockConfirmModal
        open={unlockConfirmOpen}
        onConfirm={handleUnlockConfirm}
        onCancel={() => setUnlockConfirmOpen(false)}
        loading={toggleLockMutation.isPending}
        zIndex={80}
      />
    </>
  )
}
