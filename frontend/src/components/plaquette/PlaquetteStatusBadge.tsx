import { CheckCircle2, FileEdit, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PlaquetteCheckStatus } from '@/types'

interface PlaquetteStatusBadgeProps {
  status: PlaquetteCheckStatus
  declaredAt?: string | null
  declarationRef?: string | null
  className?: string
}

const STATUS_CONFIG: Record<
  PlaquetteCheckStatus,
  {
    label: string
    Icon: typeof FileEdit
    classes: string
  }
> = {
  en_cours: {
    label: 'En cours',
    Icon: FileEdit,
    classes: 'bg-warning/15 text-warning border-warning/30',
  },
  validation_finale: {
    label: 'Validation finale',
    Icon: CheckCircle2,
    classes: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  },
  declare: {
    label: 'Déclarée',
    Icon: Lock,
    classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
}

/**
 * Pill colorée affichant le statut du cycle de vie plaquette.
 * Pour le statut `declare`, affiche aussi la date courte (DD/MM/YYYY).
 * Tooltip riche au survol : declared_at + declaration_ref.
 *
 * Session 39 P1.
 */
export function PlaquetteStatusBadge({
  status,
  declaredAt,
  declarationRef,
  className,
}: PlaquetteStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]
  const { Icon } = cfg

  // Pour 'declare' : suffix avec date courte
  const declaredDateShort = declaredAt
    ? new Date(declaredAt).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : null

  const label =
    status === 'declare' && declaredDateShort
      ? `${cfg.label} · ${declaredDateShort}`
      : cfg.label

  const tooltip =
    status === 'declare'
      ? [
          declaredAt ? `Déclarée le ${declaredDateShort}` : null,
          declarationRef ? `Réf : ${declarationRef}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null

  return (
    <span
      title={tooltip || undefined}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
        cfg.classes,
        className,
      )}
    >
      <Icon size={12} strokeWidth={2.5} />
      <span className="tabular-nums">{label}</span>
    </span>
  )
}
