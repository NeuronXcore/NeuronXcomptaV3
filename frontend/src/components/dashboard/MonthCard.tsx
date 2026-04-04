import { useNavigate } from 'react-router-dom'
import { cn, formatCurrency } from '@/lib/utils'
import { Upload, Download, GitCompareArrows, Pencil } from 'lucide-react'
import type { MoisOverview } from '@/types'

interface MonthCardProps {
  data: MoisOverview
  year: number
  isCurrent: boolean
  isFuture: boolean
  isExpanded: boolean
  onToggle: () => void
}

const BADGES = [
  { key: 'releve', label: 'Rel.', get: (d: MoisOverview) => d.has_releve ? 1.0 : 0.0, bool: true },
  { key: 'cat', label: 'Cat.', get: (d: MoisOverview) => d.taux_categorisation },
  { key: 'let', label: 'Let.', get: (d: MoisOverview) => d.taux_lettrage },
  { key: 'jus', label: 'Jus.', get: (d: MoisOverview) => d.taux_justificatifs },
  { key: 'rap', label: 'Rap.', get: (d: MoisOverview) => d.taux_rapprochement },
  { key: 'exp', label: 'Exp.', get: (d: MoisOverview) => d.has_export ? 1.0 : 0.0, bool: true },
]

function badgeColor(val: number, hasData: boolean): string {
  if (!hasData) return 'bg-surface text-text-muted/40'
  if (val >= 1.0) return 'bg-green-500/15 text-green-400'
  if (val >= 0.7) return 'bg-yellow-500/15 text-yellow-400'
  return 'bg-red-500/15 text-red-400'
}

export default function MonthCard({ data, year, isCurrent, isFuture, isExpanded, onToggle }: MonthCardProps) {
  const navigate = useNavigate()
  const hasData = data.has_releve

  // Overall month %
  const vals = BADGES.map(b => b.get(data))
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length * 100

  const isPastIncomplete = !isFuture && !isCurrent && hasData && avg < 100

  return (
    <div
      className={cn(
        'bg-surface rounded-lg border transition-all cursor-pointer',
        isCurrent && 'border-[#7F77DD] border-[1.5px]',
        isPastIncomplete && !isCurrent && 'border-l-[3px] border-l-red-500 border-border',
        !isCurrent && !isPastIncomplete && 'border-border',
        isFuture && 'opacity-40',
      )}
      onClick={onToggle}
    >
      {/* Header */}
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-text">{data.label}</span>
          <span className={cn(
            'text-[10px] font-bold',
            avg >= 100 ? 'text-green-400' : avg >= 50 ? 'text-yellow-400' : 'text-text-muted'
          )}>
            {hasData ? `${Math.round(avg)}%` : isFuture ? '' : '—'}
          </span>
        </div>

        {/* Badges */}
        <div className="flex gap-1">
          {BADGES.map(b => (
            <span
              key={b.key}
              className={cn(
                'flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium',
                badgeColor(b.get(data), hasData)
              )}
            >
              <span className={cn(
                'w-[5px] h-[5px] rounded-full',
                b.get(data) >= 1.0 && hasData ? 'bg-green-400' :
                b.get(data) >= 0.7 && hasData ? 'bg-yellow-400' :
                hasData ? 'bg-red-400' : 'bg-text-muted/30'
              )} />
              {b.label}
            </span>
          ))}
        </div>

        {/* Ops count */}
        {hasData && (
          <p className="text-[10px] text-text-muted mt-1.5">{data.nb_operations} ops</p>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && hasData && (
        <div className="border-t border-border px-3 py-2.5 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div>
              <p className="text-text-muted">Recettes</p>
              <p className="text-emerald-400 font-medium">{formatCurrency(data.total_credit)}</p>
            </div>
            <div>
              <p className="text-text-muted">Dépenses</p>
              <p className="text-red-400 font-medium">{formatCurrency(data.total_debit)}</p>
            </div>
            <div>
              <p className="text-text-muted">Solde</p>
              <p className={cn('font-medium', data.total_credit - data.total_debit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {formatCurrency(data.total_credit - data.total_debit)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {!data.has_releve && (
              <button onClick={e => { e.stopPropagation(); navigate('/import') }}
                className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-[10px] rounded hover:bg-primary/20">
                <Upload size={10} /> Importer
              </button>
            )}
            {data.taux_justificatifs < 1.0 && (
              <button onClick={e => { e.stopPropagation(); navigate('/rapprochement') }}
                className="flex items-center gap-1 px-2 py-1 bg-amber-500/10 text-amber-400 text-[10px] rounded hover:bg-amber-500/20">
                <GitCompareArrows size={10} /> Rapprocher
              </button>
            )}
            {!data.has_export && data.taux_lettrage >= 1.0 && data.taux_justificatifs >= 1.0 && (
              <button onClick={e => { e.stopPropagation(); navigate('/export') }}
                className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] rounded hover:bg-emerald-500/20">
                <Download size={10} /> Exporter
              </button>
            )}
            {data.filename && (
              <button onClick={e => { e.stopPropagation(); navigate(`/editor?file=${data.filename}`) }}
                className="flex items-center gap-1 px-2 py-1 bg-surface-hover text-text-muted text-[10px] rounded hover:text-text">
                <Pencil size={10} /> Éditer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
