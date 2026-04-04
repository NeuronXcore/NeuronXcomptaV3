import MonthCard from './MonthCard'
import type { MoisOverview } from '@/types'

interface MonthsGridProps {
  mois: MoisOverview[]
  year: number
  expandedMonth: number | null
  onToggle: (m: number) => void
}

export default function MonthsGrid({ mois, year, expandedMonth, onToggle }: MonthsGridProps) {
  const now = new Date()
  const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : (year < now.getFullYear() ? 13 : 0)

  return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {mois.map(m => (
        <MonthCard
          key={m.mois}
          data={m}
          year={year}
          isCurrent={m.mois === currentMonth}
          isFuture={m.mois > currentMonth}
          isExpanded={expandedMonth === m.mois}
          onToggle={() => onToggle(m.mois)}
        />
      ))}
    </div>
  )
}
