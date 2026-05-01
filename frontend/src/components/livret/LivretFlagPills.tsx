/**
 * Pastilles 6×6 pour les flags d'une opération du livret.
 * Vert = lettré OK · Ambre = à revoir · Rouge = justif manquant · Gris = verrouillé · Violet = mixte.
 */
import { AlertTriangle, FileQuestion, Lock, PercentCircle, CheckCircle2 } from 'lucide-react'
import type { LivretFlag } from '@/types/livret'
import { cn } from '@/lib/utils'

interface Props {
  flags: LivretFlag
  size?: number
  className?: string
}

interface PillSpec {
  show: boolean
  Icon: typeof AlertTriangle
  color: string
  bg: string
  label: string
}

export default function LivretFlagPills({ flags, size = 12, className }: Props) {
  const pills: PillSpec[] = [
    {
      show: flags.lettre,
      Icon: CheckCircle2,
      color: 'text-success',
      bg: 'bg-success/15',
      label: 'Lettrée',
    },
    {
      show: flags.a_revoir,
      Icon: AlertTriangle,
      color: 'text-warning',
      bg: 'bg-warning/15',
      label: 'À revoir',
    },
    {
      show: flags.justificatif_manquant,
      Icon: FileQuestion,
      color: 'text-danger',
      bg: 'bg-danger/15',
      label: 'Justificatif manquant',
    },
    {
      show: flags.locked,
      Icon: Lock,
      color: 'text-text-muted',
      bg: 'bg-surface-hover',
      label: 'Verrouillée',
    },
    {
      show: flags.is_mixte,
      Icon: PercentCircle,
      color: 'text-primary',
      bg: 'bg-primary/15',
      label: 'Usage mixte',
    },
  ]

  const visible = pills.filter((p) => p.show)
  if (visible.length === 0) return null

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {visible.map(({ Icon, color, bg, label }) => (
        <span
          key={label}
          title={label}
          className={cn('inline-flex items-center justify-center rounded-full', bg)}
          style={{ width: size + 6, height: size + 6 }}
        >
          <Icon size={size} className={color} />
        </span>
      ))}
    </div>
  )
}
