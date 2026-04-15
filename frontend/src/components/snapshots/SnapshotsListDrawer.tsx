import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, X, Trash2, Eye, FileText, Calendar, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn, MOIS_FR } from '@/lib/utils'
import { useSnapshots, useDeleteSnapshot, type Snapshot } from '@/hooks/useSnapshots'

interface Props {
  open: boolean
  onClose: () => void
  onView: (snapshot: Snapshot) => void
}

export function SnapshotsListDrawer({ open, onClose, onView }: Props) {
  const { data: snapshots = [], isLoading } = useSnapshots()
  const deleteMut = useDeleteSnapshot()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const navigate = useNavigate()

  if (!open) return null

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteMut.mutateAsync(id)
      toast.success(`Snapshot « ${name} » supprimé`)
      setConfirmDeleteId(null)
    } catch {
      toast.error('Échec de la suppression')
    }
  }

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch {
      return iso
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[520px] max-w-[95vw] bg-background border-l border-border z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-warning/15 text-warning flex items-center justify-center">
              <Camera size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">Mes snapshots</p>
              <p className="text-[11px] text-text-muted">{snapshots.length} snapshot{snapshots.length > 1 ? 's' : ''} sauvegardé{snapshots.length > 1 ? 's' : ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text rounded-md hover:bg-surface">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-text-muted">
              <Loader2 size={20} className="animate-spin mr-2" /> Chargement…
            </div>
          ) : snapshots.length === 0 ? (
            <div className="text-center py-16 text-text-muted text-sm space-y-2">
              <Camera size={32} className="mx-auto opacity-30" />
              <p>Aucun snapshot pour l'instant.</p>
              <p className="text-xs">Sélectionnez des opérations dans l'éditeur, puis cliquez sur « Snapshot ».</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {snapshots.map(snap => (
                <div
                  key={snap.id}
                  className="group bg-surface border border-border rounded-lg p-3.5 hover:border-warning/60 transition-colors cursor-pointer"
                  onClick={() => onView(snap)}
                >
                  <div className="flex items-start gap-3">
                    {snap.color && (
                      <div
                        className="w-3 h-3 rounded-full mt-1.5 shrink-0 ring-1 ring-border"
                        style={{ backgroundColor: snap.color }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-text truncate">{snap.name}</p>
                      </div>
                      {snap.description && (
                        <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{snap.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-[11px] text-text-muted">
                        <span className="flex items-center gap-1">
                          <FileText size={12} /> {snap.ops_refs.length} op{snap.ops_refs.length > 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar size={12} /> {formatDate(snap.created_at)}
                        </span>
                        {snap.context_year && (
                          <span className="text-text-muted/70">
                            ({snap.context_month ? MOIS_FR[snap.context_month - 1] + ' ' : ''}{snap.context_year})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); onView(snap) }}
                        className="p-1.5 text-text-muted hover:text-warning hover:bg-warning/10 rounded transition-colors"
                        title="Voir le snapshot"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(snap.id) }}
                        className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Confirmation suppression inline */}
                  {confirmDeleteId === snap.id && (
                    <div className="mt-3 pt-3 border-t border-danger/30 flex items-center justify-between gap-2 bg-danger/5 -mx-3.5 -mb-3.5 px-3.5 py-2.5 rounded-b-lg">
                      <span className="text-xs text-danger font-medium">Supprimer ce snapshot ?</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }}
                          className="px-2.5 py-1 text-xs text-text-muted hover:text-text rounded"
                        >
                          Annuler
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(snap.id, snap.name) }}
                          disabled={deleteMut.isPending}
                          className="px-2.5 py-1 text-xs bg-danger text-white rounded hover:bg-danger/90 disabled:opacity-50"
                        >
                          {deleteMut.isPending ? <Loader2 size={11} className="animate-spin" /> : 'Supprimer'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
