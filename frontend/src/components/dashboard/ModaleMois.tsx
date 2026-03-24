import { useNavigate } from 'react-router-dom'
import { X, FileText, GitCompareArrows, FileBarChart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MOIS_FR } from '@/lib/utils'
import type { MonthStatus } from '@/types'

interface ModaleMoisProps {
  mois: MonthStatus | null
  year: number
  onClose: () => void
}

function getStatutBadge(mois: MonthStatus) {
  if (mois.statut === 'manquant') return { color: 'bg-gray-500/20 text-gray-400', text: '—' }
  if (mois.statut === 'complet') return { color: 'bg-green-500/20 text-green-400', text: '✓ Clôturé' }
  if (mois.taux_lettrage === 0 && mois.taux_justificatifs === 0)
    return { color: 'bg-blue-500/20 text-blue-400', text: 'Importé' }
  return { color: 'bg-orange-500/20 text-orange-400', text: 'En cours' }
}

export default function ModaleMois({ mois, year, onClose }: ModaleMoisProps) {
  const navigate = useNavigate()

  if (!mois) return null

  const badge = getStatutBadge(mois)
  const tauxGlobal = mois.nb_operations > 0
    ? Math.round(((mois.taux_lettrage + mois.taux_justificatifs) / 2) * 100)
    : 0

  function navAndClose(path: string) {
    navigate(path)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="max-w-lg w-full bg-background border border-border rounded-xl p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <button onClick={onClose} className="absolute top-4 right-4 text-text-muted hover:text-text transition-colors">
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-xl font-bold text-text">
            {MOIS_FR[mois.mois - 1]} {year}
          </h2>
          <span className={cn('text-xs px-2 py-1 rounded-full font-medium', badge.color)}>
            {badge.text}
          </span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <StatItem label="Opérations" value={String(mois.nb_operations)} />
          <StatItem label="Lettrées" value={`${mois.nb_lettrees} / ${mois.nb_operations}`} />
          <StatItem label="Justificatifs" value={`${mois.nb_justificatifs_ok} / ${mois.nb_justificatifs_total}`} />
          <StatItem label="Taux global" value={`${tauxGlobal}%`} />
        </div>

        {/* Progress bars */}
        <div className="space-y-3 mb-6">
          <ProgressBar label="Lettrage" value={mois.taux_lettrage} color="bg-blue-400" />
          <ProgressBar label="Justificatifs" value={mois.taux_justificatifs} color="bg-violet-400" />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => navAndClose(mois.filename ? `/editor?file=${mois.filename}` : '/editor')}
            className="flex items-center gap-2 w-full px-4 py-2.5 rounded-lg bg-surface hover:bg-surface-hover border border-border text-sm text-text transition-colors"
          >
            <FileText size={16} className="text-text-muted" />
            Voir les opérations
          </button>
          <button
            onClick={() => navAndClose('/rapprochement')}
            className="flex items-center gap-2 w-full px-4 py-2.5 rounded-lg bg-surface hover:bg-surface-hover border border-border text-sm text-text transition-colors"
          >
            <GitCompareArrows size={16} className="text-text-muted" />
            Rapprochement
          </button>
          <button
            onClick={() => navAndClose('/reports')}
            className="flex items-center gap-2 w-full px-4 py-2.5 rounded-lg bg-surface hover:bg-surface-hover border border-border text-sm text-text transition-colors"
          >
            <FileBarChart size={16} className="text-text-muted" />
            Générer un rapport
          </button>
        </div>
      </div>
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface rounded-lg p-3 border border-border">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className="text-lg font-bold text-text">{value}</p>
    </div>
  )
}

function ProgressBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 100)
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-text-muted">{label}</span>
        <span className="text-sm font-medium text-text">{pct}%</span>
      </div>
      <div className="h-2.5 bg-border rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
