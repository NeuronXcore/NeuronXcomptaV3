import { useState, useEffect } from 'react'
import { Camera, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { useCreateSnapshot, type SnapshotOpRef } from '@/hooks/useSnapshots'

interface SnapshotCreateModalProps {
  open: boolean
  onClose: () => void
  ops_refs: SnapshotOpRef[]
  /** Nom suggéré (pré-rempli, modifiable). Ex: "Nov 2025 — Véhicule (14 ops)". */
  suggestedName?: string
  context_year?: number | null
  context_month?: number | null
  context_filters?: Record<string, unknown> | null
  onCreated?: (id: string) => void
}

const COLORS = [
  { name: 'Violet', value: '#7c3aed' },
  { name: 'Bleu', value: '#3b82f6' },
  { name: 'Vert', value: '#10b981' },
  { name: 'Orange', value: '#f59e0b' },
  { name: 'Rose', value: '#ec4899' },
  { name: 'Rouge', value: '#ef4444' },
]

export function SnapshotCreateModal({
  open,
  onClose,
  ops_refs,
  suggestedName = '',
  context_year,
  context_month,
  context_filters,
  onCreated,
}: SnapshotCreateModalProps) {
  const [name, setName] = useState(suggestedName)
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>(COLORS[0].value)
  const createMut = useCreateSnapshot()

  useEffect(() => {
    if (open) {
      setName(suggestedName)
      setDescription('')
      setColor(COLORS[0].value)
    }
  }, [open, suggestedName])

  if (!open) return null

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Le nom est requis')
      return
    }
    if (ops_refs.length === 0) {
      toast.error('Aucune opération sélectionnée')
      return
    }
    try {
      const created = await createMut.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        ops_refs,
        context_year: context_year ?? null,
        context_month: context_month ?? null,
        context_filters: context_filters ?? null,
      })
      toast.success(`Snapshot « ${created.name} » créé`)
      onCreated?.(created.id)
      onClose()
    } catch {
      toast.error('Échec de la création du snapshot')
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[440px] max-w-[95vw] bg-background border border-border rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-warning/15 text-warning flex items-center justify-center">
              <Camera size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">Créer un snapshot</p>
              <p className="text-[11px] text-text-muted">{ops_refs.length} opération{ops_refs.length > 1 ? 's' : ''} sélectionnée{ops_refs.length > 1 ? 's' : ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text rounded-md hover:bg-surface">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Nom *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex. À vérifier avec comptable, Litige Amazon…"
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Description (optionnel)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Notes pour retrouver ce snapshot plus tard…"
              rows={2}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Couleur</label>
            <div className="flex gap-2">
              {COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  className={cn(
                    'w-7 h-7 rounded-full transition-all border-2',
                    color === c.value ? 'ring-2 ring-offset-2 ring-offset-background ring-text scale-110' : 'border-transparent hover:scale-105'
                  )}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2 bg-surface/30">
          <button
            onClick={onClose}
            disabled={createMut.isPending}
            className="px-3 py-1.5 text-sm text-text-muted hover:text-text rounded-md hover:bg-surface"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMut.isPending || !name.trim()}
            className="px-4 py-1.5 text-sm font-semibold bg-warning text-background rounded-md hover:bg-warning/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {createMut.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Création…</>
            ) : (
              <><Camera size={14} /> Créer</>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
