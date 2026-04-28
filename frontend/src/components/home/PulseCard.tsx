import { useCountUp } from '@/hooks/useCountUp'
import { cn } from '@/lib/utils'
import type { AlerteSeverity } from '@/types'

const RING_RADIUS = 40
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS  // ≈ 251.33

interface BaseProps {
  label: string
  delay: number  // ms — animation-delay pour l'entrée nx-fade-up
}

type RingVariantProps = BaseProps & {
  variant: 'ring'
  percent: number       // 0-100
  countUpDelay: number  // ms — typiquement délai entrée + 0
}

type ValueVariantProps = BaseProps & {
  variant: 'value'
  value: number
  prefix?: string       // ex. "J–"
  subtitle: string | null
  countUpDelay: number
}

type DotVariantProps = BaseProps & {
  variant: 'dot'
  count: number
  severity: AlerteSeverity
  countUpDelay: number
}

type Props = RingVariantProps | ValueVariantProps | DotVariantProps

const SEVERITY_LABELS: Record<AlerteSeverity, string> = {
  faible: 'faible',
  moyenne: 'moyenne',
  critique: 'critique',
}

const SEVERITY_DOT_COLOR: Record<AlerteSeverity, string> = {
  faible: 'bg-text-muted',
  moyenne: 'bg-warning',
  critique: 'bg-danger',
}

/**
 * Card pulse générique avec 3 variantes.
 *
 * - `ring` : anneau SVG qui draw de 0 → percent en 1300ms ease-out cubic
 * - `value` : valeur en grand (CountUp) + sous-titre
 * - `dot` : dot animé pulse 2s + nombre (CountUp)
 */
export function PulseCard(props: Props) {
  return (
    <div
      className="rounded-2xl border border-border bg-surface/60 backdrop-blur-sm px-5 py-4"
      style={{
        opacity: 0,
        animation: `nx-fade-up 320ms ease-out ${props.delay}ms forwards`,
      }}
    >
      <div className="text-[11px] uppercase tracking-[0.10em] text-text-muted mb-3">
        {props.label}
      </div>
      {props.variant === 'ring' && <RingVariant percent={props.percent} delay={props.countUpDelay} />}
      {props.variant === 'value' && (
        <ValueVariant
          value={props.value}
          prefix={props.prefix}
          subtitle={props.subtitle}
          delay={props.countUpDelay}
        />
      )}
      {props.variant === 'dot' && (
        <DotVariant count={props.count} severity={props.severity} delay={props.countUpDelay} />
      )}
    </div>
  )
}

function RingVariant({ percent, delay }: { percent: number; delay: number }) {
  const safePercent = Math.max(0, Math.min(100, percent))
  const target = RING_CIRCUMFERENCE * (1 - safePercent / 100)
  const value = useCountUp({ to: safePercent, duration: 1100, delay })

  return (
    <div className="flex items-center gap-4">
      <svg width={92} height={92} viewBox="0 0 92 92" className="shrink-0">
        {/* Track */}
        <circle
          cx={46}
          cy={46}
          r={RING_RADIUS}
          fill="none"
          stroke="rgba(127,119,221,0.12)"
          strokeWidth={6}
        />
        {/* Progress */}
        <circle
          cx={46}
          cy={46}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--color-primary, #7F77DD)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          transform="rotate(-90 46 46)"
          style={{
            strokeDashoffset: RING_CIRCUMFERENCE,
            // CSS var consommée par @keyframes nx-draw-ring
            ['--ring-target' as string]: target,
            animation: `nx-draw-ring 1300ms cubic-bezier(0.22, 0.9, 0.42, 1) ${delay}ms forwards`,
          }}
        />
      </svg>
      <div className="flex flex-col">
        <span className="text-[28px] font-medium leading-none tabular-nums text-text">
          {value}
          <span className="text-[18px] text-text-muted ml-0.5">%</span>
        </span>
        <span className="text-[12px] text-text-muted mt-1">complétion</span>
      </div>
    </div>
  )
}

function ValueVariant({
  value,
  prefix,
  subtitle,
  delay,
}: { value: number; prefix?: string; subtitle: string | null; delay: number }) {
  const animated = useCountUp({ to: value, duration: 600, delay })
  const hasValue = value > 0 || prefix == null

  return (
    <div>
      <div className="text-[28px] font-medium leading-none tabular-nums text-text">
        {hasValue ? (
          <>
            {prefix}
            {animated}
          </>
        ) : (
          <span className="text-text-muted text-[20px]">—</span>
        )}
      </div>
      <div className={cn('text-[12px] text-text-muted mt-2 truncate')}>
        {subtitle ?? 'Aucune échéance proche'}
      </div>
    </div>
  )
}

function DotVariant({
  count,
  severity,
  delay,
}: { count: number; severity: AlerteSeverity; delay: number }) {
  const animated = useCountUp({ to: count, duration: 600, delay })

  return (
    <div className="flex items-center gap-3">
      <span
        className={cn('inline-block w-2 h-2 rounded-full', SEVERITY_DOT_COLOR[severity])}
        style={{ animation: 'nx-dot 2s ease-in-out infinite' }}
      />
      <div>
        <div className="text-[28px] font-medium leading-none tabular-nums text-text">
          {animated}
        </div>
        <div className="text-[12px] text-text-muted mt-1 lowercase">
          {SEVERITY_LABELS[severity]}
        </div>
      </div>
    </div>
  )
}
