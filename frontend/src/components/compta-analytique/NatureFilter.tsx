import { cn } from '@/lib/utils'
import { Briefcase, User, Layers } from 'lucide-react'

export type NatureFilter = 'pro' | 'perso' | 'all'

interface NatureFilterProps {
  value: NatureFilter
  onChange: (value: NatureFilter) => void
  className?: string
  /** Texte contextuel à droite du segmented control (ex. "le tableau et les graphes filtrent en conséquence") */
  hint?: string
}

const OPTIONS: Array<{ value: NatureFilter; label: string; icon: typeof Briefcase; color: string }> = [
  { value: 'pro', label: 'Pro', icon: Briefcase, color: '#7F77DD' },
  { value: 'perso', label: 'Perso', icon: User, color: '#B4B2A9' },
  { value: 'all', label: 'Tout', icon: Layers, color: '#94a3b8' },
]

export default function NatureFilter({ value, onChange, className, hint }: NatureFilterProps) {
  return (
    <div className={cn('flex items-center justify-between flex-wrap gap-3', className)}>
      <div className="flex bg-surface rounded-lg border border-border overflow-hidden">
        {OPTIONS.map((opt) => {
          const active = value === opt.value
          const Icon = opt.icon
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors border-r border-border last:border-r-0',
                active ? 'bg-primary text-white' : 'text-text-muted hover:text-text hover:bg-surface-hover',
              )}
              style={active ? { background: opt.color } : {}}
            >
              <Icon size={12} />
              {opt.label}
            </button>
          )
        })}
      </div>
      {hint && <p className="text-[10px] text-text-muted/70">{hint}</p>}
    </div>
  )
}
