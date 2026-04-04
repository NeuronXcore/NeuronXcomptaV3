import type { ProgressionExercice } from '@/types'

interface ProgressionGaugeProps {
  progression: ProgressionExercice
}

const CRITERES = [
  { key: 'releves', label: 'Relevés', color: '#378ADD' },
  { key: 'categorisation', label: 'Catégorisation', color: '#7F77DD' },
  { key: 'lettrage', label: 'Lettrage', color: '#1D9E75' },
  { key: 'justificatifs', label: 'Justificatifs', color: '#5DCAA5' },
  { key: 'rapprochement', label: 'Rapprochement', color: '#EF9F27' },
  { key: 'exports', label: 'Exports', color: '#D85A30' },
]

export default function ProgressionGauge({ progression }: ProgressionGaugeProps) {
  return (
    <div className="bg-surface rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">Progression globale</h3>
        <span className="text-lg font-bold text-primary">{Math.round(progression.globale)}%</span>
      </div>

      {/* Segmented bar */}
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3">
        {CRITERES.map(c => {
          const val = progression.criteres[c.key] ?? 0
          return (
            <div
              key={c.key}
              className="flex-1 rounded-sm"
              style={{
                backgroundColor: c.color,
                opacity: Math.max(0.15, val / 100),
              }}
              title={`${c.label}: ${Math.round(val)}%`}
            />
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {CRITERES.map(c => {
          const val = progression.criteres[c.key] ?? 0
          return (
            <div key={c.key} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
              <span className="text-[10px] text-text-muted">{c.label}</span>
              <span className="text-[10px] font-medium text-text">{Math.round(val)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
