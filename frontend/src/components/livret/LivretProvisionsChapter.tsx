/**
 * Chapitre 07 — Provisions & coussin (mode éclaté).
 * 3 sous-cat side-by-side avec gauge cumul vs cible (cible projetée annuelle).
 */
import { Pencil, PiggyBank } from 'lucide-react'
import { Link } from 'react-router-dom'

import type {
  LivretActiveFilters,
  LivretProvisionGauge,
  LivretProvisionsChapter as LivretProvisionsChapterType,
} from '@/types/livret'
import { cn, formatCurrency } from '@/lib/utils'

import LivretChapterShell from './LivretChapterShell'
import LivretSubcategorySection from './LivretSubcategorySection'

interface Props {
  chapter: LivretProvisionsChapterType
  activeFilters: LivretActiveFilters
}

export default function LivretProvisionsChapter({ chapter, activeFilters }: Props) {
  const isEmpty = chapter.subcategories.every((s) => s.nb_operations === 0)

  return (
    <LivretChapterShell
      number={chapter.number}
      title={chapter.title}
      tag={chapter.tag}
      totalYtd={chapter.total_ytd}
      deltaN1={chapter.delta_n1}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        {chapter.gauges.map((g) => (
          <GaugeCard key={g.name} gauge={g} />
        ))}
      </div>

      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-hover/30 p-6 text-center space-y-3">
          <p className="text-sm text-text-muted">
            Aucun transfert taggé en provision pour cet exercice.
          </p>
          <p className="text-xs text-text-muted italic">
            Pour alimenter ce chapitre, taggez vos transferts vers le compte épargne fiscal en
            sous-catégorie <code className="px-1 bg-surface rounded">Provision IR</code>,{' '}
            <code className="px-1 bg-surface rounded">Provision Charges sociales</code> ou{' '}
            <code className="px-1 bg-surface rounded">Coussin</code> depuis l'Éditeur.
          </p>
          <Link
            to="/editor"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
          >
            <Pencil size={14} /> Ouvrir l'Éditeur →
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {chapter.subcategories.map((sub) => (
            <LivretSubcategorySection
              key={sub.name}
              subcategory={sub}
              activeFilters={activeFilters}
            />
          ))}
        </div>
      )}
    </LivretChapterShell>
  )
}

function GaugeCard({ gauge }: { gauge: LivretProvisionGauge }) {
  const ratioPct = Math.min(150, Math.round(gauge.ratio * 100))
  const isOver = gauge.ratio >= 1
  const isOnTrack = gauge.ratio >= 0.7
  const barColor = isOver ? 'bg-success' : isOnTrack ? 'bg-primary' : 'bg-warning'
  const textColor = isOver ? 'text-success' : isOnTrack ? 'text-primary' : 'text-warning'

  return (
    <div className="rounded-xl border border-border bg-surface-hover/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <PiggyBank size={14} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text">{gauge.name}</h3>
      </div>
      <div>
        <div className="text-2xl font-bold text-text tabular-nums">
          {formatCurrency(gauge.cumul_ytd)}
        </div>
        <div className="text-xs text-text-muted">
          sur cible <span className="tabular-nums">{formatCurrency(gauge.cible_estimee)}</span>
        </div>
      </div>

      {gauge.cible_estimee > 0 ? (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-surface overflow-hidden">
            <div
              className={cn('h-full transition-all', barColor)}
              style={{ width: `${Math.min(100, ratioPct)}%` }}
            />
          </div>
          <div className={cn('text-xs font-medium tabular-nums', textColor)}>
            {ratioPct}% provisionné
          </div>
        </div>
      ) : (
        <div className="text-xs text-text-muted italic">Cible non disponible (BNC à projeter)</div>
      )}
    </div>
  )
}
