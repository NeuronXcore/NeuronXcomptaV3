import { CheckCircle2, Circle, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BulkLettreBarProps {
  count: number
  loading: boolean
  shifted: boolean
  /**
   * true si toutes les ops sélectionnées sont déjà lettrées → mode délettrage
   * (le bouton bascule de « Pointer » à « Dépointer »).
   */
  allLettrees: boolean
  onLettre: () => void
  onClose: () => void
}

/**
 * Barre flottante d'action bulk-lettrage. Pattern miroir de BulkLockBar avec
 * palette emerald (cohérent avec la pastille verte de la colonne Pointée).
 * Mode toggle : si toutes les ops sélectionnées sont déjà lettrées, le bouton
 * bascule en « Dépointer ». Sinon → « Pointer ».
 */
export function BulkLettreBar({ count, loading, shifted, allLettrees, onLettre, onClose }: BulkLettreBarProps) {
  if (count === 0) return null

  const isUnlettering = allLettrees
  const Icon = isUnlettering ? Circle : CheckCircle2
  const actionLabel = isUnlettering ? 'Dépointer' : 'Pointer'
  const loadingLabel = isUnlettering ? 'Dépointage…' : 'Pointage…'

  return (
    <div
      className={cn(
        'fixed left-1/2 -translate-x-1/2 z-30 flex items-center gap-4',
        'bg-surface border border-border rounded-2xl shadow-2xl px-4 py-3',
        'animate-in slide-in-from-bottom-4',
        shifted ? 'bottom-24' : 'bottom-6',
      )}
    >
      <span className="text-sm text-text font-medium">
        {count} opération{count > 1 ? 's' : ''} sélectionnée{count > 1 ? 's' : ''}
      </span>
      <button
        onClick={onLettre}
        disabled={loading}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
          isUnlettering
            ? 'bg-surface-hover text-text-muted border border-border hover:bg-surface-hover/80 hover:text-text'
            : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/25 hover:shadow-lg hover:shadow-emerald-500/20',
          'hover:scale-[1.02]',
          'disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100',
        )}
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {loadingLabel}
          </>
        ) : (
          <>
            <Icon size={16} />
            {actionLabel} ({count})
          </>
        )}
      </button>
      <button
        onClick={onClose}
        disabled={loading}
        className="p-1.5 text-text-muted hover:text-text transition-colors disabled:opacity-50"
        title="Annuler la sélection"
      >
        <X size={16} />
      </button>
    </div>
  )
}
