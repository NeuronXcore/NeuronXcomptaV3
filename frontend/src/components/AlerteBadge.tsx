import { FileX, Tag, AlertTriangle, Copy, Brain, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AlerteType } from '@/types'
import type { LucideIcon } from 'lucide-react'

const ALERTE_CONFIG: Record<AlerteType, { icon: LucideIcon; color: string; bg: string; label: string }> = {
  justificatif_manquant: { icon: FileX, color: 'text-orange-400', bg: 'bg-orange-400/15', label: 'Justif.' },
  a_categoriser: { icon: Tag, color: 'text-yellow-400', bg: 'bg-yellow-400/15', label: 'Catégo.' },
  montant_a_verifier: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-400/15', label: 'Montant' },
  doublon_suspect: { icon: Copy, color: 'text-purple-400', bg: 'bg-purple-400/15', label: 'Doublon' },
  confiance_faible: { icon: Brain, color: 'text-blue-400', bg: 'bg-blue-400/15', label: 'ML < 60%' },
}

interface AlerteBadgeProps {
  type: AlerteType
  size?: 'sm' | 'md'
  onResolve?: () => void
}

export default function AlerteBadge({ type, size = 'sm', onResolve }: AlerteBadgeProps) {
  const config = ALERTE_CONFIG[type]
  if (!config) return null

  const Icon = config.icon
  const iconSize = size === 'sm' ? 12 : 16
  const textClass = size === 'sm' ? 'text-[10px]' : 'text-xs'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
        config.bg,
        config.color,
        textClass,
      )}
    >
      <Icon size={iconSize} />
      {config.label}
      {onResolve && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onResolve()
          }}
          className="ml-0.5 hover:opacity-70"
        >
          <X size={iconSize} />
        </button>
      )}
    </span>
  )
}
