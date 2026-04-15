import { Lock, LockOpen, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BulkLockBarProps {
  count: number
  loading: boolean
  shifted: boolean
  allLocked: boolean  // true si toutes les ops sélectionnées sont déjà verrouillées → mode déverrouillage
  onLock: () => void
  onClose: () => void
}

export function BulkLockBar({ count, loading, shifted, allLocked, onLock, onClose }: BulkLockBarProps) {
  if (count === 0) return null

  const isUnlocking = allLocked
  const Icon = isUnlocking ? LockOpen : Lock
  const actionLabel = isUnlocking ? 'Déverrouiller' : 'Verrouiller'
  const loadingLabel = isUnlocking ? 'Déverrouillage…' : 'Verrouillage…'

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
        onClick={onLock}
        disabled={loading}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
          isUnlocking
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/25 hover:shadow-lg hover:shadow-emerald-500/20'
            : 'bg-warning/15 text-warning border border-warning/40 hover:bg-warning/25 hover:shadow-lg hover:shadow-warning/20',
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
