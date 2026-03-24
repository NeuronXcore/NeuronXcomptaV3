import { CheckCircle2, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PipelineStepData } from '@/hooks/usePipeline'

interface PipelineStepProps {
  step: PipelineStepData
  index: number
  isLast: boolean
  onClick: () => void
}

const statusColors: Record<PipelineStepData['status'], string> = {
  complete: 'text-success',
  partial: 'text-warning',
  low: 'text-danger',
  empty: 'text-text-muted',
}

const barColors: Record<PipelineStepData['status'], string> = {
  complete: 'bg-success',
  partial: 'bg-warning',
  low: 'bg-danger',
  empty: 'bg-border',
}

export default function PipelineStep({ step, index, isLast, onClick }: PipelineStepProps) {
  const remaining = step.total - step.ok

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 w-full text-left group hover:bg-surface-hover rounded-lg px-3 py-2.5 transition-colors"
    >
      {/* Vertical line + icon */}
      <div className="flex flex-col items-center shrink-0">
        {step.status === 'complete' ? (
          <CheckCircle2 className="w-6 h-6 text-success" />
        ) : (
          <div className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center">
            <span className="text-xs font-medium text-text-muted">{index + 1}</span>
          </div>
        )}
        {!isLast && (
          <div className={cn('w-0.5 h-8 mt-1', step.status === 'complete' ? 'bg-success/40' : 'bg-border')} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text">{step.name}</span>
          <span className={cn('text-xs font-semibold tabular-nums', statusColors[step.status])}>
            {step.ok}/{step.total}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-1.5 h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', barColors[step.status])}
            style={{ width: `${Math.min(step.percent, 100)}%` }}
          />
        </div>

        {/* Remaining text */}
        {step.status !== 'complete' && remaining > 0 && (
          <p className="text-xs text-text-muted mt-1">
            {remaining} restant{remaining > 1 ? 's' : ''}
          </p>
        )}
      </div>
    </button>
  )
}
