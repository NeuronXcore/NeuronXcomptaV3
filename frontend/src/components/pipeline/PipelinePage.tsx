import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, Check, AlertTriangle, Circle } from 'lucide-react'
import PageHeader from '../shared/PageHeader'
import LoadingSpinner from '../shared/LoadingSpinner'
import PipelineStepCard from './PipelineStepCard'
import { usePipeline } from '../../hooks/usePipeline'
import { MOIS_FR, cn } from '../../lib/utils'
import type { PipelineStepStatus } from '../../types'

const MOIS_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

function BadgeIcon({ status }: { status: PipelineStepStatus }) {
  if (status === 'complete') return <Check size={12} />
  if (status === 'in_progress') return <AlertTriangle size={12} />
  return <Circle size={10} />
}

export default function PipelinePage() {
  const navigate = useNavigate()
  const { year, setYear, month, setMonth, availableYears, steps, globalProgress, monthBadges, isLoading, currentFile } = usePipeline()
  const [expandedStep, setExpandedStep] = useState<string | null>(null)

  // Auto-expand first non-complete step
  useEffect(() => {
    if (steps.length > 0 && expandedStep === null) {
      const firstIncomplete = steps.find((s) => s.status !== 'complete')
      if (firstIncomplete) {
        setExpandedStep(firstIncomplete.id)
      }
    }
  }, [steps, expandedStep])

  // Reset expanded step when month/year changes
  useEffect(() => {
    setExpandedStep(null)
  }, [year, month])

  if (isLoading) {
    return (
      <>
        <PageHeader title="Pipeline Comptable" description="Suivi mensuel du traitement comptable" />
        <LoadingSpinner text="Chargement du pipeline..." />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Pipeline Comptable"
        description="Suivi mensuel du traitement comptable"
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">Exercice</span>
            {availableYears.map((y) => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={cn(
                  'px-4 py-1.5 rounded-md text-sm font-semibold transition-colors',
                  y === year
                    ? 'bg-primary text-white'
                    : 'bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-hover'
                )}
              >
                {y}
              </button>
            ))}
          </div>
        }
      />

      {/* Month badges grid */}
      <div className="grid grid-cols-12 gap-1.5 mb-6">
        {monthBadges.map((badge) => {
          const isSelected = badge.month === month
          return (
            <button
              key={badge.month}
              onClick={() => setMonth(badge.month)}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg text-xs font-medium transition-all cursor-pointer',
                'border',
                isSelected
                  ? 'border-primary bg-primary/15 ring-1 ring-primary'
                  : 'border-border bg-surface hover:bg-surface-hover',
                badge.status === 'complete' ? 'text-emerald-400' :
                badge.status === 'in_progress' ? 'text-amber-400' : 'text-gray-500'
              )}
            >
              <BadgeIcon status={badge.status} />
              <span className={cn(
                'text-[11px]',
                isSelected ? 'text-text font-semibold' : 'text-text-muted'
              )}>
                {MOIS_SHORT[badge.month - 1]}
              </span>
              <span className="text-[10px]">{badge.progress}%</span>
            </button>
          )
        })}
      </div>

      {/* Global progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-text-muted">
            {MOIS_FR[month - 1]} {year} — Progression
          </span>
          <span className={cn(
            'text-sm font-semibold',
            globalProgress === 100 ? 'text-emerald-400' :
            globalProgress > 50 ? 'text-amber-400' : 'text-gray-400'
          )}>
            {globalProgress}%
          </span>
        </div>
        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              globalProgress === 100 ? 'bg-emerald-500' :
              globalProgress > 50 ? 'bg-amber-500' : 'bg-gray-500'
            )}
            style={{ width: `${globalProgress}%` }}
          />
        </div>
      </div>

      {/* Empty state */}
      {!currentFile && availableYears.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border rounded-lg">
          <Upload size={48} className="mx-auto text-text-muted mb-4" />
          <h3 className="text-lg font-medium text-text mb-2">Aucun relevé importé</h3>
          <p className="text-text-muted text-sm mb-6">
            Commencez par importer un relevé bancaire pour démarrer le pipeline comptable.
          </p>
          <button
            onClick={() => navigate('/import')}
            className="bg-primary hover:bg-primary/80 text-white px-6 py-2.5 rounded-md text-sm font-medium transition-colors"
          >
            Importer un relevé
          </button>
        </div>
      ) : (
        /* Pipeline steps */
        <div className="space-y-3">
          {steps.map((step, index) => (
            <PipelineStepCard
              key={step.id}
              step={step}
              isFirst={index === 0}
              isLast={index === steps.length - 1}
              isExpanded={expandedStep === step.id}
              onToggle={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}
