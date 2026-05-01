/**
 * Sous-barre sous la toolbar : "Au {date} · X mois écoulés · Y à projeter"
 * + toggle comparaison N-1 (Phase 4) actif (Sans / YTD comparable / Année pleine).
 */
import { GitCompareArrows, LineChart } from 'lucide-react'

import { useLivretStore } from '@/stores/useLivretStore'
import type { CompareUiMode, LivretMetadata } from '@/types/livret'
import { cn, formatDate } from '@/lib/utils'

interface Props {
  metadata: LivretMetadata
}

const COMPARE_OPTIONS: Array<{ value: CompareUiMode; label: string; tooltip: string }> = [
  { value: 'none', label: 'Sans', tooltip: 'Aucune comparaison N-1' },
  {
    value: 'ytd_comparable',
    label: 'YTD comparable',
    tooltip: 'Compare la période [01/01/N → as_of] avec [01/01/(N-1) → même date N-1]',
  },
  {
    value: 'annee_pleine',
    label: 'Année pleine',
    tooltip: 'Compare l\'exercice complet N avec l\'exercice complet (N-1)',
  },
]

export default function LivretSubBar({ metadata }: Props) {
  const compareMode = useLivretStore((s) => s.compareMode)
  const setCompareMode = useLivretStore((s) => s.setCompareMode)
  const showN1 = useLivretStore((s) => s.showN1OnCadence)
  const setShowN1 = useLivretStore((s) => s.setShowN1OnCadence)

  const isClosedYear = metadata.months_elapsed === 12 && metadata.months_remaining === 0
  const isFutureYear = metadata.months_elapsed === 0 && metadata.months_remaining === 12

  return (
    <div className="flex items-center justify-between text-sm text-text-muted py-2 border-b border-border flex-wrap gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span>
          Au <span className="font-medium text-text">{formatDate(metadata.as_of_date)}</span>
        </span>
        {isClosedYear ? (
          <span className="px-2 py-0.5 rounded-full bg-surface-hover text-xs">
            Exercice clôturé · 12 mois clos
          </span>
        ) : isFutureYear ? (
          <span className="px-2 py-0.5 rounded-full bg-surface-hover text-xs">
            Exercice à venir
          </span>
        ) : (
          <span>
            <span className="font-medium text-text">{metadata.months_elapsed}</span> mois écoulés ·{' '}
            <span className="font-medium text-text">{metadata.months_remaining}</span> à projeter
          </span>
        )}
        {compareMode !== 'none' && metadata.as_of_date_n1 && (
          <span className="text-xs text-text-muted italic">
            vs N-1 au {formatDate(metadata.as_of_date_n1)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {/* Toggle N-1 sur cadence — uniquement si compareMode actif ET has_n1_data */}
        {compareMode !== 'none' && metadata.has_n1_data && (
          <label
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border transition-colors',
              showN1
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-surface text-text-muted border-border hover:border-text-muted',
            )}
            title="Affiche la ligne N-1 sur la cadence mensuelle"
          >
            <input
              type="checkbox"
              checked={showN1}
              onChange={(e) => setShowN1(e.target.checked)}
              className="sr-only"
            />
            <LineChart size={11} />
            <span>N-1 sur cadence</span>
          </label>
        )}

        {/* Segmented control 3 états */}
        <div
          role="group"
          aria-label="Mode de comparaison N-1"
          className="inline-flex items-center bg-surface border border-border rounded-full p-0.5"
        >
          <span className="inline-flex items-center gap-1 pl-2.5 pr-1 text-xs text-text-muted">
            <GitCompareArrows size={11} />
            <span className="hidden md:inline">Comparer N-1</span>
          </span>
          {COMPARE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCompareMode(opt.value)}
              title={opt.tooltip}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                compareMode === opt.value
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
