/**
 * Chips locaux : Tout · À revoir · Justif manquant · Mixte · Verrouillé.
 * Filtres locaux (state dans LivretPage) — n'affectent que les tables d'ops.
 */
import { cn } from '@/lib/utils'
import type { LivretFilterKey, LivretActiveFilters } from '@/types/livret'

interface ChipSpec {
  key: LivretFilterKey
  label: string
  colorClass: string
}

const CHIPS: ChipSpec[] = [
  { key: 'a_revoir', label: 'À revoir', colorClass: 'border-warning/40 text-warning bg-warning/10' },
  { key: 'justif_manquant', label: 'Justif manquant', colorClass: 'border-danger/40 text-danger bg-danger/10' },
  { key: 'mixte', label: 'Mixte', colorClass: 'border-primary/40 text-primary bg-primary/10' },
  { key: 'locked', label: 'Verrouillé', colorClass: 'border-text-muted/40 text-text-muted bg-text-muted/10' },
]

interface Props {
  active: LivretActiveFilters
  onToggle: (key: LivretFilterKey) => void
  onClear: () => void
}

export default function LivretFilterChips({ active, onToggle, onClear }: Props) {
  const isAll = active.size === 0
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={onClear}
        className={cn(
          'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
          isAll
            ? 'bg-text text-background border-text'
            : 'bg-surface text-text-muted border-border hover:border-text-muted',
        )}
      >
        Tout
      </button>
      {CHIPS.map((c) => {
        const isActive = active.has(c.key)
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onToggle(c.key)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
              isActive ? c.colorClass : 'bg-surface text-text-muted border-border hover:border-text-muted',
            )}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )
}
