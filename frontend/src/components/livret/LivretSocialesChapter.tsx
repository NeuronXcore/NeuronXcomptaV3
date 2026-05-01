/**
 * Chapitre 05 — Cotisations sociales (URSSAF / CARMF / OdM).
 * Mode groupé. Pour les ops URSSAF, le `LivretOpsTable` expand affichera la
 * décomposition Part déductible / CSG-CRDS non déductible via les sub_lines.
 */
import type { LivretActiveFilters, LivretChapter } from '@/types/livret'

import LivretChapterShell from './LivretChapterShell'
import LivretSubcategorySection from './LivretSubcategorySection'

interface Props {
  chapter: LivretChapter
  activeFilters: LivretActiveFilters
}

export default function LivretSocialesChapter({ chapter, activeFilters }: Props) {
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
          Aucune cotisation sociale détectée pour cet exercice.
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-text-muted italic">
            URSSAF : la part CSG non déductible + CRDS est exposée en sous-ligne quand calculée
            (cf. badge « CSG non déductible » sur la row). Cette part est exclue du BNC.
          </p>
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
