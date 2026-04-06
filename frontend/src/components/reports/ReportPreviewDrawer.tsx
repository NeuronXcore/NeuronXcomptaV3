import { useState, useEffect } from 'react'
import { X, Download, RefreshCw, Trash2, Pencil, FileText, Loader2, Save, ExternalLink } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { useRegenerateReport, useDeleteReport, useUpdateReport, useOpenReportNative } from '@/hooks/useReports'
import type { ReportMetadata } from '@/types'

interface ReportPreviewDrawerProps {
  report: ReportMetadata | null
  isOpen: boolean
  onClose: () => void
}

export default function ReportPreviewDrawer({ report, isOpen, onClose }: ReportPreviewDrawerProps) {
  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const regenerateMutation = useRegenerateReport()
  const deleteMutation = useDeleteReport()
  const updateMutation = useUpdateReport()
  const openNativeMutation = useOpenReportNative()

  useEffect(() => {
    if (report) {
      setEditTitle(report.title)
      setEditDesc(report.description || '')
      setEditMode(false)
      setDeleteConfirm(false)
    }
  }, [report?.filename])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!report) return null

  const previewUrl = `/api/reports/preview/${encodeURIComponent(report.filename)}`
  const isPdf = report.format === 'pdf'

  const handleSaveEdit = () => {
    updateMutation.mutate(
      { filename: report.filename, data: { title: editTitle, description: editDesc || undefined } },
      { onSuccess: () => setEditMode(false) }
    )
  }

  const handleDelete = () => {
    deleteMutation.mutate(report.filename, { onSuccess: () => onClose() })
  }

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}

      <div className={cn(
        'fixed top-0 right-0 h-full w-[800px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <FileText size={18} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text truncate">{report.title}</p>
              <p className="text-xs text-text-muted">{report.format.toUpperCase()} · {report.file_size_human}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setEditMode(!editMode)} className="p-1.5 text-text-muted hover:text-text transition-colors">
              <Pencil size={15} />
            </button>
            <button onClick={onClose} className="p-1.5 text-text-muted hover:text-text transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Edit mode */}
          {editMode && (
            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <div>
                <label className="text-[10px] text-text-muted block mb-1">Titre</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted block mb-1">Description</label>
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  rows={2}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditMode(false)} className="px-3 py-1.5 text-xs text-text-muted hover:text-text">
                  Annuler
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs hover:bg-primary/90 disabled:opacity-50"
                >
                  {updateMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Enregistrer
                </button>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="bg-surface rounded-lg border border-border p-4 space-y-2 text-xs">
            <div className="flex items-center gap-3 text-text-muted">
              <span>Format: <span className="text-text font-medium">{report.format.toUpperCase()}</span></span>
              <span>·</span>
              <span>Généré le {new Date(report.generated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="flex items-center gap-3 text-text-muted">
              <span>{report.nb_operations} opérations</span>
              <span>·</span>
              <span>Débit: <span className="text-red-400">{formatCurrency(report.total_debit)}</span></span>
              <span>·</span>
              <span>Crédit: <span className="text-emerald-400">{formatCurrency(report.total_credit)}</span></span>
            </div>
            {report.description && (
              <p className="text-text-muted pt-1">{report.description}</p>
            )}
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-border overflow-hidden bg-white">
            {isPdf ? (
              <iframe src={previewUrl} className="w-full h-[50vh]" title="Preview" />
            ) : (
              <div className="p-4 text-center text-text-muted">
                <p className="text-sm mb-3">Aperçu non disponible pour {report.format.toUpperCase()}</p>
                <button
                  onClick={() => window.open(`/api/reports/download/${report.filename}`)}
                  className="flex items-center gap-2 mx-auto px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90"
                >
                  <Download size={14} /> Télécharger
                </button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => openNativeMutation.mutate(report.filename)}
              disabled={openNativeMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-xs hover:bg-surface-hover transition-colors disabled:opacity-50"
            >
              <ExternalLink size={14} />
              {isPdf ? 'Ouvrir dans Aperçu' : report.format === 'csv' ? 'Ouvrir dans Numbers' : 'Ouvrir dans Excel'}
            </button>
            <button
              onClick={() => window.open(`/api/reports/download/${report.filename}`)}
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-xs hover:bg-surface-hover transition-colors"
            >
              <Download size={14} /> Télécharger
            </button>
            <button
              onClick={() => regenerateMutation.mutate(report.filename)}
              disabled={regenerateMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-xs hover:bg-surface-hover transition-colors disabled:opacity-50"
            >
              {regenerateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Re-générer
            </button>

            {deleteConfirm ? (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-red-400">Supprimer ?</span>
                <button onClick={handleDelete} disabled={deleteMutation.isPending}
                  className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs hover:bg-red-500/30">
                  {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Confirmer'}
                </button>
                <button onClick={() => setDeleteConfirm(false)}
                  className="px-3 py-1.5 bg-surface-hover text-text-muted rounded-lg text-xs">
                  Annuler
                </button>
              </div>
            ) : (
              <button onClick={() => setDeleteConfirm(true)}
                className="flex items-center gap-2 ml-auto text-red-400/70 hover:text-red-400 text-xs transition-colors">
                <Trash2 size={13} /> Supprimer
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
