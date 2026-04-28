import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Clock, Paperclip, Sparkles, Tags, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NextActionData } from '@/types'

const ICON_MAP: Record<string, LucideIcon> = {
  Clock,
  Tags,
  Paperclip,
  CheckCircle2,
  Sparkles,
}

interface Props {
  data: NextActionData
}

/**
 * Card large avec border-accent primary, icône Lucide à gauche, contenu central, CTA à droite.
 *
 * Animation d'entrée : nx-slide-up 450ms à t=900.
 * Pulse infini (scale 1↔1.013, période 3.2s) qui démarre **après** l'entrée
 * via animation-delay 2600ms — l'utilisateur ne perçoit le pulse qu'après que
 * tout le reste de la chorégraphie soit en place.
 */
export function NextActionCard({ data }: Props) {
  const navigate = useNavigate()
  const Icon = ICON_MAP[data.iconName] ?? Sparkles
  const isIdle = data.kind === 'idle'

  return (
    <button
      type="button"
      onClick={() => navigate(data.ctaPath)}
      className={cn(
        'w-full flex items-center gap-5 px-6 py-5 rounded-2xl text-left transition-all',
        'bg-surface/80 backdrop-blur-sm',
        'border border-primary/30 hover:border-primary/60',
        'hover:shadow-[0_0_0_1px_rgba(127,119,221,0.15),0_8px_24px_-12px_rgba(127,119,221,0.35)]',
        'group',
      )}
      style={{
        opacity: 0,
        animation: 'nx-slide-up 450ms ease-out 900ms forwards, nx-home-pulse 3200ms ease-in-out 2600ms infinite',
      }}
    >
      <div
        className={cn(
          'shrink-0 w-12 h-12 rounded-xl flex items-center justify-center',
          isIdle ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary',
        )}
      >
        <Icon size={22} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-[0.10em] text-text-muted mb-1">
          {data.label}
        </div>
        <div className="text-[18px] font-medium text-text truncate">{data.title}</div>
        {data.subtitle && (
          <div className="text-[13px] text-text-muted mt-0.5 truncate">{data.subtitle}</div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2 text-primary text-[14px] font-medium group-hover:gap-3 transition-all">
        {data.ctaText}
        <ArrowRight size={16} />
      </div>
    </button>
  )
}
