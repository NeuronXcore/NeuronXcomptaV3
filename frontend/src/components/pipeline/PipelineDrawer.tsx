import { useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn, MOIS_FR } from '@/lib/utils'
import { usePipeline } from '@/hooks/usePipeline'
import PipelineStep from './PipelineStep'
import PipelineDetail from './PipelineDetail'
import type { PipelineData } from '@/hooks/usePipeline'

interface PipelineDrawerProps {
  open: boolean
  onClose: () => void
  year: number
  month: number
  onChangeMonth: (year: number, month: number) => void
}

const statusColors: Record<string, string> = {
  complete: 'bg-success',
  partial: 'bg-warning',
  low: 'bg-danger',
  empty: 'bg-border',
}

function progressColor(percent: number): string {
  if (percent >= 80) return 'bg-success'
  if (percent > 40) return 'bg-warning'
  return 'bg-danger'
}

export default function PipelineDrawer({ open, onClose, year, month, onChangeMonth }: PipelineDrawerProps) {
  const [level, setLevel] = useState<1 | 2>(1)
  const [selectedStep, setSelectedStep] = useState(0)
  const pipeline = usePipeline(year, month)

  const goPrev = () => {
    if (month === 1) {
      onChangeMonth(year - 1, 12)
    } else {
      onChangeMonth(year, month - 1)
    }
    setLevel(1)
  }

  const goNext = () => {
    if (month === 12) {
      onChangeMonth(year + 1, 1)
    } else {
      onChangeMonth(year, month + 1)
    }
    setLevel(1)
  }

  const openDetail = (index: number) => {
    setSelectedStep(index)
    setLevel(2)
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[400px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            {level === 2 ? (
              <button
                onClick={() => setLevel(1)}
                className="flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Retour
              </button>
            ) : (
              <h2 className="text-base font-semibold text-text">Pipeline comptable</h2>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-surface-hover transition-colors text-text-muted hover:text-text"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Month navigation */}
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={goPrev}
              className="p-1 rounded hover:bg-surface-hover transition-colors text-text-muted hover:text-text"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-text">
              {MOIS_FR[month - 1]} {year}
            </span>
            <button
              onClick={goNext}
              className="p-1 rounded hover:bg-surface-hover transition-colors text-text-muted hover:text-text"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Global progress bar */}
          {level === 1 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-text-muted">Progression globale</span>
                <span className="text-xs font-semibold text-text tabular-nums">{pipeline.globalProgress}%</span>
              </div>
              <div className="h-2 rounded-full bg-border overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', progressColor(pipeline.globalProgress))}
                  style={{ width: `${pipeline.globalProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Level 2 step title */}
          {level === 2 && pipeline.steps[selectedStep] && (
            <div className="mt-3">
              <h3 className="text-sm font-semibold text-text">
                {pipeline.steps[selectedStep].name}
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                {pipeline.steps[selectedStep].ok}/{pipeline.steps[selectedStep].total} — {pipeline.steps[selectedStep].percent}%
              </p>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {pipeline.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : level === 1 ? (
            <div className="space-y-0">
              {pipeline.steps.map((step, i) => (
                <PipelineStep
                  key={i}
                  step={step}
                  index={i}
                  isLast={i === pipeline.steps.length - 1}
                  onClick={() => openDetail(i)}
                />
              ))}
            </div>
          ) : (
            <PipelineDetail
              stepIndex={selectedStep}
              step={pipeline.steps[selectedStep]}
              pipeline={pipeline}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </>
  )
}
