import { cn } from '@/lib/utils'
import type { JustificatifScoreDetail } from '@/types'

interface ScorePillsProps {
  detail: JustificatifScoreDetail
  total: number
  deltaJours?: number | null
  className?: string
}

function pillColor(v: number | null): string {
  if (v == null) return 'bg-zinc-500/15 text-text-muted'
  if (v >= 0.8) return 'bg-emerald-500/15 text-emerald-400'
  if (v >= 0.5) return 'bg-amber-500/15 text-amber-400'
  return 'bg-red-500/15 text-red-400'
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

/**
 * Affiche 3-4 pills de score détaillé + pill total.
 *
 * - montant : pill avec % (ou "✗" si 0)
 * - date : pill avec % (et delta jours si fourni)
 * - fournisseur : pill avec %
 * - catégorie : pill avec % — MASQUÉE si `detail.categorie === null`
 *   (le poids de ce critère est redistribué côté backend)
 * - total : pill compact à droite, couleur dominante
 */
export default function ScorePills({
  detail,
  total,
  deltaJours,
  className,
}: ScorePillsProps) {
  const { montant, date, fournisseur, categorie } = detail

  return (
    <div className={cn('flex flex-wrap items-center gap-1 text-[10px]', className)}>
      {/* Montant */}
      <span
        className={cn(
          'px-1.5 py-0.5 rounded-full font-medium tabular-nums',
          pillColor(montant),
        )}
        title={`Score montant : ${pct(montant)}`}
      >
        M {pct(montant)}
      </span>

      {/* Date (avec delta jours optionnel) */}
      <span
        className={cn(
          'px-1.5 py-0.5 rounded-full font-medium tabular-nums',
          pillColor(date),
        )}
        title={`Score date : ${pct(date)}${deltaJours != null ? ` (Δ${deltaJours}j)` : ''}`}
      >
        D {pct(date)}
        {deltaJours != null && (
          <span className="ml-0.5 opacity-75">
            ({deltaJours > 0 ? '+' : ''}
            {deltaJours}j)
          </span>
        )}
      </span>

      {/* Fournisseur */}
      <span
        className={cn(
          'px-1.5 py-0.5 rounded-full font-medium tabular-nums',
          pillColor(fournisseur),
        )}
        title={`Score fournisseur : ${pct(fournisseur)}`}
      >
        F {pct(fournisseur)}
      </span>

      {/* Catégorie — masquée si non inférable */}
      {categorie != null && (
        <span
          className={cn(
            'px-1.5 py-0.5 rounded-full font-medium tabular-nums',
            pillColor(categorie),
          )}
          title={`Score catégorie : ${pct(categorie)}`}
        >
          C {pct(categorie)}
        </span>
      )}

      {/* Total — séparateur puis pill dominante */}
      <span className="text-text-muted/30 mx-0.5">·</span>
      <span
        className={cn(
          'px-1.5 py-0.5 rounded-full font-semibold tabular-nums',
          pillColor(total),
        )}
        title={`Score total : ${pct(total)}`}
      >
        {pct(total)}
      </span>
    </div>
  )
}
