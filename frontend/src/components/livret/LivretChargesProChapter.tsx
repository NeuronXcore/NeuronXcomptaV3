/**
 * Chapitre 03 — Charges professionnelles, mode éclaté.
 * Chaque sous-ligne de ventilation est une LivretOperation distincte dans sa vraie sous-cat.
 * Les ops perso, immobilisations, dotations et forfaits sont exclus.
 */
import type { LivretChapter, LivretActiveFilters } from '@/types/livret'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import LivretChapterShell from './LivretChapterShell'
import LivretSubcategorySection from './LivretSubcategorySection'
import LivretChart from './charts/LivretChart'

interface Props {
  chapter: LivretChapter
  activeFilters: LivretActiveFilters
}

export default function LivretChargesProChapter({ chapter, activeFilters }: Props) {
  const year = useFiscalYearStore((s) => s.selectedYear)
  const charts = chapter.charts ?? []

  return (
    <LivretChapterShell
      number={chapter.number}
      title={chapter.title}
      tag={chapter.tag}
      totalYtd={chapter.total_ytd}
      totalProjectedAnnual={chapter.total_projected_annual}
      deltaN1={chapter.delta_n1}
    >
      {/* Phase 5 — chart en tête (donut catégories) avec drill-down vers CategoryDetailDrawer */}
      {charts.map((c) => (
        <LivretChart key={c.id} config={c} year={year} chapterNumber={chapter.number} />
      ))}
      {chapter.subcategories.length === 0 ? (
        <div className="text-sm text-text-muted italic px-2 py-8 text-center">
          Aucune charge professionnelle pour cet exercice.
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
