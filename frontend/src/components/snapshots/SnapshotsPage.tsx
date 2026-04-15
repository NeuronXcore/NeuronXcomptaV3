import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Trash2, Eye, FileText, Calendar, Loader2, AlertTriangle, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/shared/PageHeader'
import { cn, MOIS_FR, formatCurrency } from '@/lib/utils'
import {
  useSnapshots,
  useDeleteSnapshot,
  useSnapshotOperations,
  type Snapshot,
} from '@/hooks/useSnapshots'
import { SnapshotViewerDrawer } from '@/components/snapshots/SnapshotViewerDrawer'

export default function SnapshotsPage() {
  const { data: snapshots = [], isLoading } = useSnapshots()
  const deleteMut = useDeleteSnapshot()
  const navigate = useNavigate()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch {
      return iso
    }
  }

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteMut.mutateAsync(id)
      toast.success(`Snapshot « ${name} » supprimé`)
      setConfirmDeleteId(null)
    } catch {
      toast.error('Échec de la suppression')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Snapshots"
        description="Sélections d'opérations sauvegardées et réutilisables"
        actions={
          <button
            onClick={() => navigate('/editor')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-warning/15 text-warning border border-warning/40 rounded-lg hover:bg-warning/25 transition-colors"
          >
            <Plus size={15} /> Créer dans l'éditeur
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-32 text-text-muted">
            <Loader2 size={20} className="animate-spin mr-2" /> Chargement…
          </div>
        ) : snapshots.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-16 text-center text-text-muted">
            <Camera size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg mb-2">Aucun snapshot pour l'instant</p>
            <p className="text-sm mb-6">Sélectionnez des opérations dans l'éditeur, puis cliquez sur « Snapshot ».</p>
            <button
              onClick={() => navigate('/editor')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-warning text-background rounded-lg hover:bg-warning/90"
            >
              <Camera size={16} /> Aller à l'éditeur
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {snapshots.map(snap => (
              <SnapshotCard
                key={snap.id}
                snapshot={snap}
                confirmingDelete={confirmDeleteId === snap.id}
                onView={() => setViewerId(snap.id)}
                onAskDelete={() => setConfirmDeleteId(snap.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                onConfirmDelete={() => handleDelete(snap.id, snap.name)}
                deleting={deleteMut.isPending}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>

      <SnapshotViewerDrawer
        open={viewerId !== null}
        snapshotId={viewerId}
        onClose={() => setViewerId(null)}
      />
    </div>
  )
}

interface CardProps {
  snapshot: Snapshot
  confirmingDelete: boolean
  onView: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  deleting: boolean
  formatDate: (iso: string) => string
}

function SnapshotCard({
  snapshot: snap,
  confirmingDelete,
  onView,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  deleting,
  formatDate,
}: CardProps) {
  // Charger les ops uniquement si on veut les stats — pour l'instant lazy
  const { data: resolved } = useSnapshotOperations(snap.id)
  const ops = resolved?.operations ?? []
  const broken = resolved ? resolved.expected_count - resolved.resolved_count : 0
  const totalDebit = ops.reduce((s, op) => s + (op['Débit'] || 0), 0)
  const totalCredit = ops.reduce((s, op) => s + (op['Crédit'] || 0), 0)
  const solde = totalCredit - totalDebit

  return (
    <div
      className="group bg-surface border border-border rounded-xl p-4 hover:border-warning/60 transition-colors cursor-pointer flex flex-col"
      onClick={onView}
      style={snap.color ? { borderTopWidth: '3px', borderTopColor: snap.color } : undefined}
    >
      <div className="flex items-start gap-2.5 mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ring-1 ring-border"
          style={{ backgroundColor: snap.color ? `${snap.color}25` : undefined, color: snap.color || undefined }}
        >
          <Camera size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text truncate">{snap.name}</p>
          {snap.description && (
            <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2">{snap.description}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 py-3 border-y border-border/50 mb-3">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-muted">Ops</p>
          <p className="text-sm font-bold text-text tabular-nums">
            {resolved ? resolved.resolved_count : '…'}
            {broken > 0 && (
              <span className="text-warning text-[10px] ml-1" title={`${broken} référence(s) cassée(s)`}>
                <AlertTriangle size={10} className="inline" /> {broken}
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-muted">Débits</p>
          <p className="text-sm font-bold text-danger tabular-nums truncate">{formatCurrency(totalDebit)}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-text-muted">Solde</p>
          <p className={cn('text-sm font-bold tabular-nums truncate', solde >= 0 ? 'text-success' : 'text-danger')}>
            {formatCurrency(solde)}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span className="flex items-center gap-1">
          <Calendar size={11} /> {formatDate(snap.created_at)}
        </span>
        {snap.context_year && (
          <span>
            {snap.context_month ? MOIS_FR[snap.context_month - 1] + ' ' : ''}{snap.context_year}
          </span>
        )}
      </div>

      {confirmingDelete ? (
        <div className="mt-3 pt-3 border-t border-danger/30 flex items-center justify-between gap-2">
          <span className="text-xs text-danger font-medium">Supprimer ?</span>
          <div className="flex gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); onCancelDelete() }}
              className="px-2.5 py-1 text-xs text-text-muted hover:text-text rounded"
            >
              Annuler
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onConfirmDelete() }}
              disabled={deleting}
              className="px-2.5 py-1 text-xs bg-danger text-white rounded hover:bg-danger/90 disabled:opacity-50"
            >
              {deleting ? <Loader2 size={11} className="animate-spin" /> : 'Supprimer'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onView() }}
            className="p-1.5 text-text-muted hover:text-warning hover:bg-warning/10 rounded"
            title="Voir"
          >
            <Eye size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAskDelete() }}
            className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded"
            title="Supprimer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
