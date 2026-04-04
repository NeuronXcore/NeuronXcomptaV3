import { cn } from '@/lib/utils'

// V1 statique — données hardcodées
// TODO: brancher sur les barèmes fiscaux JSON quand le module simulation sera intégré

interface Deadline {
  label: string
  amount: string
  dueDate: Date
  paid: boolean
}

function getDeadlines(): Deadline[] {
  const year = new Date().getFullYear()
  return [
    { label: 'URSSAF T1', amount: '~3 200', dueDate: new Date(year, 1, 5), paid: new Date() > new Date(year, 1, 5) },
    { label: 'URSSAF T2', amount: '~3 200', dueDate: new Date(year, 4, 5), paid: new Date() > new Date(year, 4, 5) },
    { label: 'URSSAF T3', amount: '~3 200', dueDate: new Date(year, 7, 5), paid: new Date() > new Date(year, 7, 5) },
    { label: 'URSSAF T4', amount: '~3 200', dueDate: new Date(year, 10, 5), paid: false },
    { label: 'CARMF', amount: '~5 800', dueDate: new Date(year, 3, 30), paid: new Date() > new Date(year, 3, 30) },
    { label: 'ODM', amount: '~550', dueDate: new Date(year, 2, 31), paid: new Date() > new Date(year, 2, 31) },
  ]
}

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default function FiscalDeadlines() {
  const deadlines = getDeadlines()

  return (
    <div className="flex flex-wrap gap-2">
      {deadlines.map(d => {
        const days = daysUntil(d.dueDate)
        const chipColor = d.paid
          ? 'bg-emerald-500/10 border-emerald-500/20'
          : days <= 7
            ? 'bg-red-500/10 border-red-500/20'
            : days <= 30
              ? 'bg-amber-500/10 border-amber-500/20'
              : 'bg-surface border-border'

        const textColor = d.paid
          ? 'text-emerald-400 line-through'
          : days <= 7
            ? 'text-red-400'
            : days <= 30
              ? 'text-amber-400'
              : 'text-text-muted'

        return (
          <div
            key={d.label}
            className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs', chipColor)}
          >
            <span className={cn('font-medium', textColor)}>{d.label}</span>
            <span className="text-text-muted">{d.amount} €</span>
            <span className={cn('text-[10px] font-bold', textColor)}>
              {d.paid ? 'Payé' : days > 0 ? `J-${days}` : `J+${Math.abs(days)}`}
            </span>
          </div>
        )
      })}
    </div>
  )
}
