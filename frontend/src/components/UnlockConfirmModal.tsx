import { Lock } from 'lucide-react'

interface Props {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
  /** Override le z-index par défaut (60). Utile quand ouvert depuis un drawer qui est lui-même à z-50+. */
  zIndex?: number
}

export function UnlockConfirmModal({ open, onConfirm, onCancel, loading, zIndex }: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50"
      style={{ zIndex: zIndex ?? 60 }}
      onClick={onCancel}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl p-6 w-[380px] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-warning/15 flex items-center justify-center">
            <Lock className="w-5 h-5 text-warning" />
          </div>
          <h3 className="text-text font-semibold text-base">Déverrouiller l'association ?</h3>
        </div>

        <p className="text-text-muted text-sm leading-relaxed">
          Cette opération est verrouillée. La déverrouiller permettra au rapprochement
          automatique de modifier ou supprimer son justificatif associé.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-text-muted hover:bg-surface-hover transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-warning text-white hover:bg-warning/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Déverrouillage…' : 'Déverrouiller'}
          </button>
        </div>
      </div>
    </div>
  )
}
