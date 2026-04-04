import { cn } from '@/lib/utils'
import type { ActiviteRecente } from '@/types'

interface ActivityFeedProps {
  activites: ActiviteRecente[]
}

const TYPE_COLORS: Record<string, string> = {
  import: '#1D9E75',
  export: '#1D9E75',
  rapprochement: '#7F77DD',
  ocr: '#EF9F27',
  categorisation: '#85B7EB',
  cloture: '#1D9E75',
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "À l'instant"
  if (mins < 60) return `Il y a ${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Il y a ${hours}h`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Hier'
  if (days < 7) return `Il y a ${days}j`
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export default function ActivityFeed({ activites }: ActivityFeedProps) {
  if (activites.length === 0) return null

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-text mb-3">Activité récente</h3>
      <div className="space-y-0">
        {activites.map((a, i) => (
          <div
            key={`${a.timestamp}-${i}`}
            className={cn('flex items-start gap-3 py-2.5', i < activites.length - 1 && 'border-b border-border')}
          >
            <div
              className="w-2 h-2 rounded-full mt-1.5 shrink-0"
              style={{ backgroundColor: TYPE_COLORS[a.type] || '#666' }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text truncate">{a.message}</p>
              <p className="text-[10px] text-text-muted mt-0.5">{relativeTime(a.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
