import { cn } from '@/lib/utils'
import { MOIS_FR } from '@/lib/utils'
import type { MonthStatus } from '@/types'

interface CalendrierAnnuelProps {
  cloture: MonthStatus[]
  selectedYear: number
  availableYears: number[]
  onYearChange: (year: number) => void
  onSelectMonth: (mois: MonthStatus) => void
  isLoading: boolean
}

const currentYear = new Date().getFullYear()
const currentMonth = new Date().getMonth() + 1

function getStatutStyle(mois: MonthStatus) {
  if (mois.statut === 'manquant') return { bg: '', badge: 'bg-gray-500/20 text-gray-400', text: '—' }
  const taux = Math.round(((mois.taux_lettrage + mois.taux_justificatifs) / 2) * 100)
  if (mois.statut === 'complet' || taux === 100)
    return { bg: 'border-green-500/40 bg-green-500/5', badge: 'bg-green-500/20 text-green-400', text: '✓' }
  if (taux > 0)
    return { bg: 'border-orange-500/30 bg-orange-500/5', badge: 'bg-orange-500/20 text-orange-400', text: `${taux}%` }
  return { bg: 'border-blue-500/30 bg-blue-500/5', badge: 'bg-blue-500/20 text-blue-400', text: 'Importé' }
}

export default function CalendrierAnnuel({
  cloture,
  selectedYear,
  availableYears,
  onYearChange,
  onSelectMonth,
  isLoading,
}: CalendrierAnnuelProps) {
  // Build display years: all available years + current year, deduplicated and sorted
  const displayYears = Array.from(new Set([...availableYears, currentYear])).sort()

  if (isLoading) {
    return (
      <div className="bg-surface rounded-xl border border-border p-5">
        <div className="flex items-center justify-center gap-2 mb-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 w-16 bg-surface-hover rounded-full animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-24 bg-surface-hover rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      {/* Year badge selector */}
      <div className="flex items-center justify-center gap-2 mb-5 flex-wrap">
        {displayYears.map((year) => {
          const isSelected = year === selectedYear
          const isCurrent = year === currentYear
          const hasData = availableYears.includes(year)

          return (
            <button
              key={year}
              onClick={() => onYearChange(year)}
              className={cn(
                'relative px-4 py-1.5 rounded-full text-sm font-medium transition-all',
                isSelected
                  ? 'bg-primary text-white shadow-lg shadow-primary/25'
                  : hasData
                    ? 'bg-surface-hover text-text hover:bg-primary/20 hover:text-primary'
                    : 'bg-surface-hover/50 text-text-muted hover:bg-surface-hover',
              )}
            >
              {year}
              {isCurrent && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-surface" />
              )}
            </button>
          )
        })}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-4 gap-3">
        {(cloture ?? []).map((mois) => {
          const style = getStatutStyle(mois)
          const isFuture = selectedYear === currentYear && mois.mois > currentMonth
          const isManquant = mois.statut === 'manquant'
          const isClickable = !isManquant && !isFuture
          const lettragePct = Math.round(mois.taux_lettrage * 100)
          const justifPct = Math.round(mois.taux_justificatifs * 100)

          return (
            <div
              key={mois.mois}
              onClick={() => isClickable && onSelectMonth(mois)}
              className={cn(
                'rounded-lg border p-2.5 transition-all',
                isFuture && 'opacity-30 cursor-not-allowed border-border',
                isManquant && !isFuture && 'opacity-40 border-border',
                isClickable && 'cursor-pointer hover:scale-[1.03] hover:shadow-lg',
                !isClickable && !isFuture && !isManquant && 'border-border',
                mois.has_releve ? style.bg : 'border-border',
              )}
            >
              {/* Header — month name + badge */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-text">
                  {MOIS_FR[mois.mois - 1].slice(0, 3)}
                </span>
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-semibold', style.badge)}>
                  {style.text}
                </span>
              </div>

              {/* Combined progress bar — only if has_releve */}
              {mois.has_releve && (
                <div className="space-y-1">
                  {/* Dual stacked bar */}
                  <div className="h-1.5 bg-border/60 rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-blue-400 transition-all"
                      style={{ width: `${lettragePct / 2}%` }}
                      title={`Lettrage ${lettragePct}%`}
                    />
                    <div
                      className="h-full bg-violet-400 transition-all"
                      style={{ width: `${justifPct / 2}%` }}
                      title={`Justificatifs ${justifPct}%`}
                    />
                  </div>
                  {/* Legend dots */}
                  <div className="flex items-center gap-2 text-[9px] text-text-muted">
                    <span className="flex items-center gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                      L {lettragePct}%
                    </span>
                    <span className="flex items-center gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
                      J {justifPct}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
