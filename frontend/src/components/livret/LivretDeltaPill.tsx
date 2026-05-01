/**
 * Phase 4 — pastille de delta N-1.
 *
 * Affiche `↑ +5,4 %` (vert si favorable) ou `↓ −2,1 %` (rouge si défavorable).
 * Stable (`|diff_pct| < 0.5%`) → pastille grise.
 * `value_n1 == 0` (pas de baseline) → masqué si `hideIfNoBaseline=true`,
 * sinon affiche `Nouveau`.
 */
import { ArrowDown, ArrowRight, ArrowUp, Plus } from 'lucide-react'

import type { LivretDelta } from '@/types/livret'
import { cn, formatCurrency } from '@/lib/utils'

interface Props {
  delta?: LivretDelta | null
  size?: 'sm' | 'md'
  showAbsolute?: boolean
  hideIfNoBaseline?: boolean
  className?: string
}

function formatPct(pct: number): string {
  const abs = Math.abs(pct)
  // Pour les très grands % (> 999) on bascule en "×N"
  if (abs > 999) return `×${(pct / 100 + 1).toFixed(0)}`
  const sign = pct > 0 ? '+' : ''
  // virgule décimale FR + 1 décimale si < 100, sinon arrondi
  const formatted = abs < 100 ? abs.toFixed(1).replace('.', ',') : Math.round(abs).toString()
  return `${sign}${pct < 0 ? '−' : ''}${formatted} %`.replace('+−', '−')
}

export default function LivretDeltaPill({
  delta,
  size = 'sm',
  showAbsolute = false,
  hideIfNoBaseline = false,
  className,
}: Props) {
  if (!delta) return null

  // Pas de baseline (value_n1 == 0)
  if (delta.value_n1 === 0) {
    if (hideIfNoBaseline) return null
    if (delta.value_diff === 0) return null
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border font-medium tabular-nums whitespace-nowrap',
          size === 'sm'
            ? 'px-1.5 py-0.5 text-[10px]'
            : 'px-2 py-0.5 text-xs',
          'bg-success/10 text-success border-success/30',
          className,
        )}
        title={`Nouveau · valeur N : ${formatCurrency(delta.value_diff)}`}
      >
        <Plus size={size === 'sm' ? 9 : 11} /> Nouveau
      </span>
    )
  }

  const isStable = delta.direction === 'stable'
  const Icon = isStable ? ArrowRight : delta.direction === 'up' ? ArrowUp : ArrowDown

  const colorClass = isStable
    ? 'bg-text-muted/15 text-text-muted border-text-muted/30'
    : delta.is_favorable
      ? 'bg-success/15 text-success border-success/30'
      : 'bg-danger/15 text-danger border-danger/30'

  const pctLabel = delta.value_diff_pct !== null ? formatPct(delta.value_diff_pct) : ''
  const absSign = delta.value_diff > 0 ? '+' : ''
  const absLabel = `${absSign}${formatCurrency(delta.value_diff)}`

  const tooltip = `vs N-1 : ${formatCurrency(delta.value_n1)} (diff ${absLabel})`

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium tabular-nums whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        colorClass,
        className,
      )}
      title={tooltip}
    >
      <Icon size={size === 'sm' ? 9 : 11} />
      {pctLabel || '—'}
      {showAbsolute && delta.value_diff !== 0 && (
        <span className="opacity-70">· {absLabel}</span>
      )}
    </span>
  )
}
