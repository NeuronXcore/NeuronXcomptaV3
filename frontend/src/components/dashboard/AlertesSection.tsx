import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MOIS_FR } from '@/lib/utils'
import type { AlerteDashboard } from '@/types'

interface AlertesSectionProps {
  alertes: AlerteDashboard[]
  year: number
}

const ACTION_MAP: Record<string, string> = {
  releve_manquant: '/import',
  export_manquant: '/export',
  justificatifs_manquants: '/rapprochement',
  categorisation_incomplete: '/editor',
  lettrage_incomplet: '/editor',
}

export default function AlertesSection({ alertes, year }: AlertesSectionProps) {
  const navigate = useNavigate()

  if (alertes.length === 0) return null

  const critiques = alertes.filter(a => a.impact >= 80).length
  const moderees = alertes.filter(a => a.impact < 80).length

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className="flex items-center gap-3 mb-3">
        <AlertTriangle size={16} className="text-red-400" />
        <h3 className="text-sm font-semibold text-text">Alertes</h3>
        {critiques > 0 && (
          <span className="text-[10px] font-bold bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full">
            {critiques} critique{critiques > 1 ? 's' : ''}
          </span>
        )}
        {moderees > 0 && (
          <span className="text-[10px] font-bold bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full">
            {moderees} modérée{moderees > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {alertes.map((a, i) => {
          const barColor = a.impact >= 80 ? 'bg-red-500' : a.impact >= 40 ? 'bg-amber-500' : 'bg-blue-500'
          const route = ACTION_MAP[a.type] || '/editor'

          return (
            <div
              key={`${a.type}-${a.mois}-${i}`}
              className="flex items-center gap-3 bg-background rounded-lg overflow-hidden"
            >
              <div className={cn('w-1 self-stretch shrink-0', barColor)} />
              <div className="flex-1 py-2.5 pr-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text">{a.message}</span>
                  <span className="text-[10px] text-text-muted bg-surface px-1.5 py-0.5 rounded">
                    impact {a.impact}
                  </span>
                </div>
                <p className="text-[10px] text-text-muted mt-0.5">{a.detail}</p>
              </div>
              <button
                onClick={() => navigate(route)}
                className="shrink-0 p-2 text-text-muted hover:text-primary transition-colors"
              >
                <ArrowRight size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
