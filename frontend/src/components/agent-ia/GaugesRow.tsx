import { cn } from '@/lib/utils'
import { Target, ShieldCheck, BookOpen, Cog, Activity } from 'lucide-react'
import type { ReactNode } from 'react'

interface CircularGaugeProps {
  value: number
  max?: number
  label: string
  suffix?: string
  icon: ReactNode
  description?: string
}

function CircularGauge({ value, max, label, suffix = '%', icon, description }: CircularGaugeProps) {
  const size = 90
  const strokeWidth = 8
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  // Percentage for the arc
  const pct = max ? Math.min((value / max) * 100, 100) : Math.min(value, 100)
  const offset = circumference - (pct / 100) * circumference

  // Color based on percentage
  const color = pct >= 70 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'
  const bgColor = pct >= 70 ? 'stroke-emerald-400/20' : pct >= 40 ? 'stroke-amber-400/20' : 'stroke-red-400/20'

  const displayValue = max ? value : `${Math.round(value)}`

  return (
    <div className="bg-surface rounded-xl border border-border p-4 flex flex-col items-center gap-2 hover:border-primary/30 transition-colors">
      <div className="relative flex items-center justify-center">
        <svg width={size} height={size} className="-rotate-90">
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={bgColor}
            strokeWidth={strokeWidth}
          />
          {/* Colored arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={cn('transition-all duration-700 ease-out', color)}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-lg font-bold', color)}>
            {displayValue}
          </span>
          {suffix && <span className="text-[10px] text-text-muted">{suffix}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-text-muted">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      {description && (
        <span className="text-[10px] text-text-muted/60">{description}</span>
      )}
    </div>
  )
}

interface GaugesRowProps {
  precision: number
  confidence: number
  examplesCount: number
  rulesCount: number
  opsProcessed: number
  lastTraining?: string
}

export default function GaugesRow({
  precision,
  confidence,
  examplesCount,
  rulesCount,
  opsProcessed,
}: GaugesRowProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <CircularGauge
        value={precision}
        label="Précision"
        icon={<Target size={14} />}
        description="Accuracy test"
      />
      <CircularGauge
        value={confidence}
        label="Confiance"
        icon={<ShieldCheck size={14} />}
        description="Taux de succès"
      />
      <CircularGauge
        value={examplesCount}
        max={200}
        label="Exemples"
        suffix=""
        icon={<BookOpen size={14} />}
        description={`/ 200 objectif`}
      />
      <CircularGauge
        value={rulesCount}
        max={200}
        label="Règles"
        suffix=""
        icon={<Cog size={14} />}
        description="Exact matches"
      />
      <CircularGauge
        value={opsProcessed}
        max={1000}
        label="Ops traitées"
        suffix=""
        icon={<Activity size={14} />}
        description="Opérations classées"
      />
    </div>
  )
}
