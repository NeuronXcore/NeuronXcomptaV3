import { cn } from '@/lib/utils'
import { MOIS_FR } from '@/lib/utils'
import type { CheckPeriod } from '@/types'

interface MonthYearToggleProps {
  period: CheckPeriod
  month: number
  onPeriodChange: (period: CheckPeriod) => void
  onMonthChange: (month: number) => void
}

/**
 * Pill segmented control "Mois | Année" + sélecteur mois compact (visible en vue Mois).
 */
export default function MonthYearToggle({
  period,
  month,
  onPeriodChange,
  onMonthChange,
}: MonthYearToggleProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="inline-flex bg-background rounded-full p-1 border border-border">
        <button
          onClick={() => onPeriodChange('month')}
          className={cn(
            'px-4 py-1.5 text-xs font-semibold rounded-full transition-all',
            period === 'month'
              ? 'bg-primary text-white shadow-sm'
              : 'text-text-muted hover:text-text',
          )}
        >
          Mois
        </button>
        <button
          onClick={() => onPeriodChange('year')}
          className={cn(
            'px-4 py-1.5 text-xs font-semibold rounded-full transition-all',
            period === 'year'
              ? 'bg-primary text-white shadow-sm'
              : 'text-text-muted hover:text-text',
          )}
        >
          Année
        </button>
      </div>

      {period === 'month' && (
        <select
          value={month}
          onChange={(e) => onMonthChange(parseInt(e.target.value, 10))}
          className="bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {MOIS_FR[i].charAt(0).toUpperCase() + MOIS_FR[i].slice(1)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
