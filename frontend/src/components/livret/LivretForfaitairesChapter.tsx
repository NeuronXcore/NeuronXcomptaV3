/**
 * Chapitre 04 — Charges forfaitaires (mode groupé).
 * Affiche une carte « Décomposition » par type de forfait (blanchissage / repas /
 * véhicule) en plus des sous-cat classiques (LivretSubcategorySection).
 */
import { Car, Shirt, UtensilsCrossed, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

import type {
  LivretActiveFilters,
  LivretForfaitairesChapter as LivretForfaitairesChapterType,
  LivretForfaitDecomposition,
} from '@/types/livret'
import { formatCurrency, formatDate } from '@/lib/utils'

import LivretChapterShell from './LivretChapterShell'
import LivretSubcategorySection from './LivretSubcategorySection'

const ICONS: Record<string, typeof Shirt> = {
  blanchissage: Shirt,
  repas: UtensilsCrossed,
  vehicule: Car,
}
const COLORS: Record<string, string> = {
  blanchissage: 'text-violet-400 bg-violet-500/10',
  repas: 'text-orange-400 bg-orange-500/10',
  vehicule: 'text-sky-400 bg-sky-500/10',
}
const LABELS: Record<string, string> = {
  blanchissage: 'Blanchissage',
  repas: 'Repas pro',
  vehicule: 'Véhicule (quote-part)',
}

interface Props {
  chapter: LivretForfaitairesChapterType
  activeFilters: LivretActiveFilters
}

export default function LivretForfaitairesChapter({ chapter, activeFilters }: Props) {
  const hasContent = chapter.subcategories.length > 0 || chapter.decompositions.length > 0

  return (
    <LivretChapterShell
      number={chapter.number}
      title={chapter.title}
      tag={chapter.tag}
      totalYtd={chapter.total_ytd}
      totalProjectedAnnual={chapter.total_projected_annual}
      deltaN1={chapter.delta_n1}
    >
      {!hasContent ? (
        <div className="text-sm text-text-muted italic px-2 py-8 text-center space-y-3">
          <p>Aucune charge forfaitaire générée pour cet exercice.</p>
          <Link
            to="/charges-forfaitaires"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
          >
            <Sparkles size={14} /> Générer un forfait →
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {chapter.decompositions.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {chapter.decompositions.map((d) => (
                <DecompositionCard key={d.type_forfait} deco={d} />
              ))}
            </div>
          )}
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

function DecompositionCard({ deco }: { deco: LivretForfaitDecomposition }) {
  const Icon = ICONS[deco.type_forfait] ?? Sparkles
  const color = COLORS[deco.type_forfait] ?? 'text-text-muted bg-surface-hover'
  const label = LABELS[deco.type_forfait] ?? deco.type_forfait

  return (
    <div className="rounded-xl border border-border bg-surface-hover/40 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${color}`}>
            <Icon size={14} />
          </span>
          <h3 className="font-semibold text-text">{label}</h3>
        </div>
        {deco.montant > 0 && (
          <span className="text-sm font-semibold text-text tabular-nums">
            {formatCurrency(deco.montant)}
          </span>
        )}
      </div>

      <div className="text-xs text-text-muted space-y-1">
        {deco.date_ecriture && <div>OD au {formatDate(deco.date_ecriture)}</div>}
        {deco.jours !== null && deco.jours !== undefined && (
          <div>{deco.jours} jours travaillés</div>
        )}
        {deco.type_forfait === 'blanchissage' && deco.articles && deco.articles.length > 0 && (
          <div>
            {deco.articles.length} article{deco.articles.length > 1 ? 's' : ''} —{' '}
            {deco.articles.map((a, i) => (
              <span key={i}>
                {String((a as { type?: string }).type ?? '')}
                {i < deco.articles!.length - 1 ? ' · ' : ''}
              </span>
            ))}
          </div>
        )}
        {deco.type_forfait === 'repas' &&
          deco.forfait_jour !== null &&
          deco.forfait_jour !== undefined && (
            <div>
              Forfait/jour : {deco.forfait_jour.toFixed(2)} € (plafond{' '}
              {deco.plafond_repas_restaurant?.toFixed(2)} − seuil{' '}
              {deco.seuil_repas_maison?.toFixed(2)})
            </div>
          )}
        {deco.type_forfait === 'vehicule' && deco.ratio_pro_pct !== null && (
          <div>
            Quote-part pro : <span className="font-medium text-text">{deco.ratio_pro_pct}%</span>
            {deco.distance_km && ` · ${deco.distance_km} km/jour`}
          </div>
        )}
        {deco.reference_legale && (
          <div className="italic">{deco.reference_legale}</div>
        )}
      </div>

      {deco.pdf_filename && (
        <div className="text-[11px] text-primary/80 truncate" title={deco.pdf_filename}>
          📄 {deco.pdf_filename}
        </div>
      )}
    </div>
  )
}
