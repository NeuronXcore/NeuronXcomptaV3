/**
 * Chapitre 02 — Recettes professionnelles, mode groupé.
 * L'opération mère est affichée une fois ; les sous-lignes ventilées sont
 * présentées en arborescence via LivretVentilationDetail.
 */
import type { LivretChapter, LivretActiveFilters } from '@/types/livret'
import LivretChapterShell from './LivretChapterShell'
import LivretSubcategorySection from './LivretSubcategorySection'

interface Props {
  chapter: LivretChapter
  activeFilters: LivretActiveFilters
}

export default function LivretRecettesChapter({ chapter, activeFilters }: Props) {
  return (
    <LivretChapterShell
      number={chapter.number}
      title={chapter.title}
      tag={chapter.tag}
      totalYtd={chapter.total_ytd}
      totalProjectedAnnual={chapter.total_projected_annual}
      deltaN1={chapter.delta_n1}
    >
      {chapter.subcategories.length === 0 ? (
        <div className="text-sm text-text-muted italic px-2 py-8 text-center">
          Aucune recette enregistrée pour cet exercice.
        </div>
      ) : (
        chapter.subcategories.map((sub) => (
          <LivretSubcategorySection
            key={sub.name}
            subcategory={sub}
            activeFilters={activeFilters}
          />
        ))
      )}
    </LivretChapterShell>
  )
}
