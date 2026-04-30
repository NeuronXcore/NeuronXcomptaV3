import { AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RappelLevel } from '@/types'

interface RappelLevelIconProps {
  level: RappelLevel
  size?: number
  className?: string
}

/**
 * Icône cerclée par niveau de criticité.
 *
 * - critical → AlertCircle dans cercle danger.
 * - warning  → AlertTriangle dans cercle warning.
 * - info     → Info dans cercle primary.
 *
 * Utilise les variables CSS sémantiques (`bg-danger/15 text-danger`, etc.) avec
 * support des opacités Tailwind 4. Pas de hex hardcodés.
 */
export default function RappelLevelIcon({ level, size = 28, className }: RappelLevelIconProps) {
  if (level === 'critical') {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-danger/15 text-danger shrink-0',
          className,
        )}
        style={{ width: size, height: size }}
      >
        <AlertCircle size={Math.round(size * 0.55)} />
      </div>
    )
  }
  if (level === 'warning') {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-warning/15 text-warning shrink-0',
          className,
        )}
        style={{ width: size, height: size }}
      >
        <AlertTriangle size={Math.round(size * 0.55)} />
      </div>
    )
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-primary/15 text-primary shrink-0',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Info size={Math.round(size * 0.55)} />
    </div>
  )
}
