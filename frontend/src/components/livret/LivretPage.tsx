/**
 * Page principale du Livret comptable vivant — route `/livret`.
 *
 * Compose :
 *  - Toolbar (sticky) : titre, sélecteur année, live dot, boutons stubbed Phase 3
 *  - SubBar : "Au {date} · X mois écoulés · Y à projeter" + toggle compare stubbed Phase 4
 *  - FilterChips : Tout · À revoir · Justif manquant · Mixte · Verrouillé (state local)
 *  - Toc : grid 9 chapitres (Phase 1 = 01/02/03 actifs, autres stubbed)
 *  - Chapitres 01 (Synthèse) · 02 (Recettes) · 03 (Charges pro)
 *
 * La page consomme `useLivret(year)` (refetch 60s + onWindowFocus) et
 * `useLivretMetadata(year)` (poll 30s) pour le live indicator.
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useLivret, useLivretMetadata } from '@/hooks/useLivret'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import type { LivretActiveFilters, LivretFilterKey, LivretSynthese } from '@/types/livret'

import LivretToolbar from './LivretToolbar'
import LivretSubBar from './LivretSubBar'
import LivretFilterChips from './LivretFilterChips'
import LivretToc from './LivretToc'
import LivretSyntheseChapter from './LivretSyntheseChapter'
import LivretRecettesChapter from './LivretRecettesChapter'
import LivretChargesProChapter from './LivretChargesProChapter'
import LivretForfaitairesChapter from './LivretForfaitairesChapter'
import LivretSocialesChapter from './LivretSocialesChapter'
import LivretAmortissementsChapter from './LivretAmortissementsChapter'
import LivretProvisionsChapter from './LivretProvisionsChapter'
import LivretBncChapter from './LivretBncChapter'
import LivretAnnexesChapter from './LivretAnnexesChapter'
import type {
  LivretAmortissementsChapter as LivretAmortissementsChapterType,
  LivretAnnexeChapter as LivretAnnexeChapterType,
  LivretBncChapter as LivretBncChapterType,
  LivretForfaitairesChapter as LivretForfaitairesChapterType,
  LivretProvisionsChapter as LivretProvisionsChapterType,
} from '@/types/livret'

export default function LivretPage() {
  const selectedYear = useFiscalYearStore((s) => s.selectedYear)
  const setYear = useFiscalYearStore((s) => s.setYear)
  const params = useParams<{ year?: string }>()

  // Sync URL :year → store (one-shot au mount / au changement d'URL)
  useEffect(() => {
    if (!params.year) return
    const parsed = Number(params.year)
    if (Number.isFinite(parsed) && parsed !== selectedYear) {
      setYear(parsed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.year])

  const livretQuery = useLivret(selectedYear)
  const metadataQuery = useLivretMetadata(selectedYear)

  // Filtres locaux — n'affectent que les tables d'ops dans les chapitres détaillés.
  const [activeFilters, setActiveFilters] = useState<LivretActiveFilters>(new Set())

  const toggleFilter = (key: LivretFilterKey) => {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const clearFilters = () => setActiveFilters(new Set())

  const livret = livretQuery.data
  const metadata = livret?.metadata ?? metadataQuery.data
  const isFetching = livretQuery.isFetching || metadataQuery.isFetching

  const activeChapterNumbers = useMemo(() => {
    const set = new Set<string>()
    if (livret) Object.keys(livret.chapters).forEach((k) => set.add(k))
    return set
  }, [livret])

  return (
    <div>
      <LivretToolbar metadata={metadata} isFetching={isFetching} />

      <div className="px-1 py-4 space-y-4">
        {metadata && <LivretSubBar metadata={metadata} />}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <LivretFilterChips
            active={activeFilters}
            onToggle={toggleFilter}
            onClear={clearFilters}
          />
          {livret?.metadata.data_sources && (
            <DataSourcesPill sources={livret.metadata.data_sources} />
          )}
        </div>

        {/* Phase 4 — banners contextuels comparaison N-1 */}
        {metadata?.compare_mode && metadata.has_n1_data === false && (
          <CompareBannerNoN1 year={metadata.year} />
        )}
        {metadata?.compare_mode === 'annee_pleine' && metadata.is_year_partial && (
          <CompareBannerYearPartial year={metadata.year} />
        )}

        {livretQuery.isLoading && !livret ? (
          <LoadingSpinner text="Composition du livret en cours…" />
        ) : livretQuery.isError ? (
          <ErrorBlock />
        ) : livret ? (
          <>
            <LivretToc toc={livret.toc} activeChapters={activeChapterNumbers} />

            {/* Chapitre 01 — Synthèse exécutive */}
            {livret.chapters['01'] && (
              <LivretSyntheseChapter chapter={livret.chapters['01'] as LivretSynthese} />
            )}

            {/* Chapitre 02 — Recettes (mode groupé) */}
            {livret.chapters['02'] && (
              <LivretRecettesChapter
                chapter={livret.chapters['02']}
                activeFilters={activeFilters}
              />
            )}

            {/* Chapitre 03 — Charges pro (mode éclaté) */}
            {livret.chapters['03'] && (
              <LivretChargesProChapter
                chapter={livret.chapters['03']}
                activeFilters={activeFilters}
              />
            )}

            {/* Chapitre 04 — Charges forfaitaires */}
            {livret.chapters['04'] && (
              <LivretForfaitairesChapter
                chapter={livret.chapters['04'] as LivretForfaitairesChapterType}
                activeFilters={activeFilters}
              />
            )}

            {/* Chapitre 05 — Cotisations sociales */}
            {livret.chapters['05'] && (
              <LivretSocialesChapter
                chapter={livret.chapters['05']}
                activeFilters={activeFilters}
              />
            )}

            {/* Chapitre 06 — Amortissements */}
            {livret.chapters['06'] && (
              <LivretAmortissementsChapter
                chapter={livret.chapters['06'] as LivretAmortissementsChapterType}
              />
            )}

            {/* Chapitre 07 — Provisions & coussin */}
            {livret.chapters['07'] && (
              <LivretProvisionsChapter
                chapter={livret.chapters['07'] as LivretProvisionsChapterType}
                activeFilters={activeFilters}
              />
            )}

            {/* Chapitre 08 — BNC fiscal */}
            {livret.chapters['08'] && (
              <LivretBncChapter chapter={livret.chapters['08'] as LivretBncChapterType} />
            )}

            {/* Chapitre 09 — Annexes */}
            {livret.chapters['09'] && (
              <LivretAnnexesChapter chapter={livret.chapters['09'] as LivretAnnexeChapterType} />
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

function DataSourcesPill({ sources }: { sources: Record<string, boolean> }) {
  const present = Object.entries(sources).filter(([, v]) => v).map(([k]) => k)
  const total = Object.keys(sources).length
  if (total === 0) return null
  return (
    <div className="text-[11px] text-text-muted">
      Sources : <span className="font-medium text-text">{present.length}/{total}</span>{' '}
      {present.length > 0 && <span className="ml-1">({present.join(', ')})</span>}
    </div>
  )
}

function CompareBannerNoN1({ year }: { year: number }) {
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
      <p className="text-warning font-medium">
        ⚠ Pas de comparaison disponible — l'exercice {year - 1} n'a aucune donnée enregistrée.
      </p>
      <p className="text-text-muted text-xs mt-1">
        Le mode comparaison reste actif mais les deltas ne s'afficheront pas.
      </p>
    </div>
  )
}

function CompareBannerYearPartial({ year }: { year: number }) {
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
      <p className="text-warning font-medium">
        ⚠ Comparaison incomplète — exercice {year} non clôturé, les chiffres N sont partiels
        face à l'année complète {year - 1}.
      </p>
      <p className="text-text-muted text-xs mt-1">
        Pour une comparaison à période identique, basculer en mode <b>YTD comparable</b>.
      </p>
    </div>
  )
}

function ErrorBlock() {
  return (
    <div className="rounded-xl border border-danger/40 bg-danger/5 p-6 text-center">
      <AlertTriangle className="mx-auto text-danger mb-2" size={28} />
      <h3 className="font-semibold text-text">Impossible de composer le livret</h3>
      <p className="text-sm text-text-muted mt-1">
        Vérifiez la connectivité au backend ou rafraîchissez la page.
      </p>
    </div>
  )
}

