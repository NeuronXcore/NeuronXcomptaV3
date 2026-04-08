import { ChevronDown, ChevronRight, Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import type { PipelineStep, PipelineStepStatus } from '../../types'

function StepIcon({ status, number }: { status: PipelineStepStatus; number: number }) {
  if (status === 'complete') return <Check className="w-5 h-5" />
  return <span className="text-sm font-bold">{number}</span>
}

const circleClasses: Record<PipelineStepStatus, string> = {
  not_started: 'bg-gray-700 text-gray-400',
  in_progress: 'bg-amber-900/50 text-amber-400 border border-amber-500',
  complete: 'bg-emerald-900/50 text-emerald-400 border border-emerald-500',
}

const barClasses: Record<PipelineStepStatus, string> = {
  not_started: 'bg-gray-600',
  in_progress: 'bg-amber-500',
  complete: 'bg-emerald-500',
}

const metricVariantClasses = {
  default: 'text-text',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
}

const lineClasses: Record<PipelineStepStatus, string> = {
  not_started: 'border-gray-700',
  in_progress: 'border-amber-500/50',
  complete: 'border-emerald-500/50',
}

interface PipelineStepCardProps {
  step: PipelineStep
  isFirst: boolean
  isLast: boolean
  isExpanded: boolean
  onToggle: () => void
}

export default function PipelineStepCard({ step, isLast, isExpanded, onToggle }: PipelineStepCardProps) {
  const navigate = useNavigate()

  return (
    <div className="relative">
      {/* Vertical connection line */}
      {!isLast && (
        <div
          className={cn(
            'absolute left-[19px] top-[40px] bottom-0 border-l-2',
            lineClasses[step.status]
          )}
        />
      )}

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {/* Header - clickable */}
        <button
          onClick={onToggle}
          className="w-full flex items-center gap-4 px-4 py-3 hover:bg-surface-hover transition-colors text-left"
        >
          {/* Step circle */}
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
              circleClasses[step.status]
            )}
          >
            <StepIcon status={step.status} number={step.number} />
          </div>

          {/* Title */}
          <span className="flex-1 text-sm font-medium text-text">{step.title}</span>

          {/* Mini progress bar */}
          <div className="w-[120px] h-1.5 bg-gray-700 rounded-full overflow-hidden shrink-0">
            <div
              className={cn('h-full rounded-full transition-all duration-500', barClasses[step.status])}
              style={{ width: `${step.progress}%` }}
            />
          </div>

          {/* Progress text */}
          <span className={cn(
            'text-xs font-medium w-10 text-right shrink-0',
            step.status === 'complete' ? 'text-emerald-400' :
            step.status === 'in_progress' ? 'text-amber-400' : 'text-gray-500'
          )}>
            {step.progress}%
          </span>

          {/* Chevron */}
          {isExpanded
            ? <ChevronDown size={16} className="text-text-muted shrink-0" />
            : <ChevronRight size={16} className="text-text-muted shrink-0" />
          }
        </button>

        {/* Expandable content */}
        <div
          className={cn(
            'overflow-hidden transition-all duration-200',
            isExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          <div className="px-4 pb-4 pt-1 ml-14 border-t border-border">
            {/* Description */}
            <p className="text-text-muted text-sm mb-4">{step.description}</p>

            {/* Metrics */}
            <div className="flex flex-wrap gap-3 mb-4">
              {step.metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="bg-background rounded-md px-3 py-2 min-w-[120px]"
                >
                  <p className="text-[11px] text-text-muted uppercase tracking-wide">{metric.label}</p>
                  <p className={cn('text-lg font-semibold', metricVariantClasses[metric.variant ?? 'default'])}>
                    {metric.value}
                    {metric.total !== undefined && (
                      <span className="text-text-muted text-sm font-normal"> / {metric.total}</span>
                    )}
                  </p>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(step.actionRoute)}
                className="bg-primary hover:bg-primary/80 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                {step.actionLabel}
              </button>
              {step.secondaryActions?.map((action) => (
                <button
                  key={action.route}
                  onClick={() => navigate(action.route)}
                  className="bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
