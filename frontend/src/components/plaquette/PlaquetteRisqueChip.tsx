import { useState } from 'react'
import { AlertCircle, AlertOctagon, AlertTriangle, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RisqueFiscalEvaluation, RisqueNiveau } from '@/types'

interface PlaquetteRisqueChipProps {
  risque?: RisqueFiscalEvaluation | null
  onClick?: () => void
  readOnly?: boolean
  compact?: boolean  // si true, masque le badge "M" + tooltip simplifié
}

const NIVEAU_CONFIG: Record<
  RisqueNiveau,
  {
    label: string
    short: string
    Icon: typeof AlertCircle
    classes: string
  }
> = {
  critique: {
    label: 'Critique',
    short: 'Crit.',
    Icon: AlertOctagon,
    classes: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
  eleve: {
    label: 'Élevé',
    short: 'Élevé',
    Icon: AlertTriangle,
    classes: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  modere: {
    label: 'Modéré',
    short: 'Mod.',
    Icon: AlertCircle,
    classes: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  faible: {
    label: 'Faible',
    short: 'Faible',
    Icon: ShieldCheck,
    classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
}

/**
 * Pastille de risque fiscal cliquable. Affiche le niveau + un badge `M` si override manuel.
 * Au hover, affiche un tooltip riche avec drivers + pièces disponibles + CTA modifier.
 *
 * Session 39 P2.
 */
export function PlaquetteRisqueChip({
  risque,
  onClick,
  readOnly = false,
  compact = false,
}: PlaquetteRisqueChipProps) {
  const [hovered, setHovered] = useState(false)

  if (!risque) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-text-muted italic border border-border/40"
        title="Risque non évalué — actualiser la plaquette"
      >
        —
      </span>
    )
  }

  const cfg = NIVEAU_CONFIG[risque.niveau]
  const { Icon } = cfg
  const isOverridden = !risque.auto_calcule

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={readOnly}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border h-[22px]',
          cfg.classes,
          !readOnly && onClick && 'cursor-pointer hover:brightness-110',
          readOnly && 'cursor-default',
        )}
      >
        <Icon size={10} strokeWidth={2.5} />
        <span>{compact ? cfg.short : cfg.label}</span>
        {isOverridden && (
          <span
            className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-purple-500/30 text-purple-300 text-[8px] font-bold"
            title="Niveau forcé manuellement"
          >
            M
          </span>
        )}
      </button>

      {/* Tooltip riche */}
      {hovered && !compact && (
        <div
          role="tooltip"
          className="absolute z-50 top-full left-0 mt-1 w-[280px] rounded-md border border-border bg-background shadow-xl p-2.5 pointer-events-none"
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border', cfg.classes)}>
              <Icon size={10} />
              {cfg.label}
            </span>
            <span className="text-[10px] text-text-muted tabular-nums">
              score {risque.score >= 0 ? '+' : ''}{risque.score}
            </span>
          </div>
          {isOverridden && risque.overridden_motif && (
            <div className="mb-1.5 rounded bg-purple-500/10 px-2 py-1 text-[10px] text-purple-300 border border-purple-500/30">
              <strong>Override manuel :</strong>{' '}
              <em>{risque.overridden_motif}</em>
            </div>
          )}
          {risque.drivers.length > 0 && (
            <div className="mb-1.5">
              <div className="text-[10px] font-semibold text-text-muted mb-0.5">
                Drivers ({risque.drivers.length})
              </div>
              <ul className="space-y-0.5">
                {risque.drivers.map((d) => (
                  <li key={d.code} className="text-[10px] flex items-start gap-1">
                    <span className={cn(
                      'font-bold tabular-nums',
                      d.delta_score >= 0 ? 'text-warning' : 'text-emerald-400',
                    )}>
                      {d.delta_score >= 0 ? '+' : '−'}
                    </span>
                    <span className="text-text">
                      {d.label}
                      {d.detail && (
                        <span className="text-text-muted"> ({d.detail})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {risque.pieces_disponibles.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-text-muted mb-0.5">
                Pièces disponibles
              </div>
              <ul className="space-y-0.5">
                {risque.pieces_disponibles.map((p, i) => (
                  <li key={i} className="text-[10px] text-text-muted">• {p}</li>
                ))}
              </ul>
            </div>
          )}
          {!readOnly && onClick && (
            <div className="mt-2 pt-1.5 border-t border-border text-[10px] text-primary">
              Cliquer pour modifier le niveau →
            </div>
          )}
        </div>
      )}
    </span>
  )
}
