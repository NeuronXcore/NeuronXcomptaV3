import { useNavigate } from 'react-router-dom'
import { Camera, X, Loader2, ExternalLink, AlertTriangle, Calendar, Edit2 } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { cn, formatCurrency, formatDate, MOIS_FR } from '@/lib/utils'
import { useSnapshotOperations, useUpdateSnapshot } from '@/hooks/useSnapshots'

interface Props {
  open: boolean
  snapshotId: string | null
  onClose: () => void
}

export function SnapshotViewerDrawer({ open, snapshotId, onClose }: Props) {
  const { data, isLoading } = useSnapshotOperations(snapshotId)
  const updateMut = useUpdateSnapshot()
  const navigate = useNavigate()
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  if (!open || !snapshotId) return null

  const snap = data?.snapshot
  const ops = data?.operations ?? []
  const broken = data ? data.expected_count - data.resolved_count : 0

  const totalDebit = ops.reduce((s, op) => s + (op['Débit'] || 0), 0)
  const totalCredit = ops.reduce((s, op) => s + (op['Crédit'] || 0), 0)
  const solde = totalCredit - totalDebit

  const handleNavigateToOp = (op: any) => {
    if (!op._sourceFile) return
    navigate(`/editor?file=${encodeURIComponent(op._sourceFile)}&highlight=${op._index}`)
    onClose()
  }

  const handleSaveName = async () => {
    if (!snap || !nameInput.trim() || nameInput.trim() === snap.name) {
      setEditingName(false)
      return
    }
    try {
      await updateMut.mutateAsync({ id: snap.id, payload: { name: nameInput.trim() } })
      toast.success('Nom mis à jour')
      setEditingName(false)
    } catch {
      toast.error('Échec de la mise à jour')
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[760px] max-w-[95vw] bg-background border-l border-border z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ring-2 ring-border"
              style={{ backgroundColor: snap?.color ? `${snap.color}30` : undefined, color: snap?.color || undefined }}
            >
              <Camera size={20} />
            </div>
            <div className="min-w-0 flex-1">
              {editingName && snap ? (
                <input
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveName()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  autoFocus
                  className="bg-surface border border-primary rounded px-2 py-1 text-sm font-semibold text-text w-full focus:outline-none"
                />
              ) : (
                <div className="flex items-center gap-2 group">
                  <p className="text-sm font-semibold text-text truncate">{snap?.name ?? '...'}</p>
                  {snap && (
                    <button
                      onClick={() => { setNameInput(snap.name); setEditingName(true) }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-text transition-opacity"
                      title="Renommer"
                    >
                      <Edit2 size={12} />
                    </button>
                  )}
                </div>
              )}
              {snap?.description && (
                <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{snap.description}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text rounded-md hover:bg-surface ml-3">
            <X size={18} />
          </button>
        </div>

        {/* Stats */}
        {snap && data && (
          <div className="px-5 py-3 border-b border-border bg-surface/30">
            <div className="grid grid-cols-4 gap-3">
              <div>
                <p className="text-[10px] text-text-muted uppercase tracking-wider">Opérations</p>
                <p className="text-lg font-bold text-text tabular-nums">{data.resolved_count}</p>
                {broken > 0 && (
                  <p className="text-[10px] text-warning flex items-center gap-1 mt-0.5">
                    <AlertTriangle size={10} /> {broken} ref{broken > 1 ? 's' : ''} cassée{broken > 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] text-text-muted uppercase tracking-wider">Débits</p>
                <p className="text-lg font-bold text-danger tabular-nums">{formatCurrency(totalDebit)}</p>
              </div>
              <div>
                <p className="text-[10px] text-text-muted uppercase tracking-wider">Crédits</p>
                <p className="text-lg font-bold text-success tabular-nums">{formatCurrency(totalCredit)}</p>
              </div>
              <div>
                <p className="text-[10px] text-text-muted uppercase tracking-wider">Solde</p>
                <p className={cn('text-lg font-bold tabular-nums', solde >= 0 ? 'text-success' : 'text-danger')}>
                  {formatCurrency(solde)}
                </p>
              </div>
            </div>
            {snap.context_year && (
              <p className="text-[11px] text-text-muted mt-2 flex items-center gap-1">
                <Calendar size={11} />
                Contexte création : {snap.context_month ? MOIS_FR[snap.context_month - 1] + ' ' : ''}{snap.context_year}
              </p>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-text-muted">
              <Loader2 size={20} className="animate-spin mr-2" /> Chargement…
            </div>
          ) : ops.length === 0 ? (
            <div className="text-center py-16 text-text-muted text-sm">
              Aucune opération à afficher.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface z-10 shadow-sm">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted uppercase">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted uppercase">Libellé</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-text-muted uppercase">Débit</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-text-muted uppercase">Crédit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted uppercase">Catégorie</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {ops.map((op, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-surface/40 transition-colors">
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-text">{formatDate(op.Date)}</td>
                    <td className="px-3 py-2 text-xs text-text truncate max-w-[280px]">{op['Libellé']}</td>
                    <td className="px-3 py-2 text-xs text-right text-danger tabular-nums whitespace-nowrap">
                      {(op['Débit'] || 0) > 0 ? formatCurrency(op['Débit'] || 0) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-right text-success tabular-nums whitespace-nowrap">
                      {(op['Crédit'] || 0) > 0 ? formatCurrency(op['Crédit'] || 0) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted">
                      {op['Catégorie'] || '—'}
                      {op['Sous-catégorie'] && <span className="text-text-muted/60"> · {op['Sous-catégorie']}</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => handleNavigateToOp(op)}
                        className="p-1 text-text-muted hover:text-primary hover:bg-primary/10 rounded transition-colors"
                        title="Ouvrir dans l'éditeur"
                      >
                        <ExternalLink size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
