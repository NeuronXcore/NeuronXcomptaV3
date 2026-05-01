/**
 * Section sous-catégorie : header (titre + total + meta) + LivretOpsTable.
 */
import type { LivretSubcategory, LivretActiveFilters } from '@/types/livret'
import { formatCurrency } from '@/lib/utils'
import LivretOpsTable from './LivretOpsTable'
import LivretDeltaPill from './LivretDeltaPill'

interface Props {
  subcategory: LivretSubcategory
  activeFilters: LivretActiveFilters
}

export default function LivretSubcategorySection({ subcategory, activeFilters }: Props) {
  const meta: string[] = []
  meta.push(
    `${subcategory.nb_operations} opération${subcategory.nb_operations > 1 ? 's' : ''}`,
  )
  if (subcategory.nb_mixte > 0) meta.push(`${subcategory.nb_mixte} mixte${subcategory.nb_mixte > 1 ? 's' : ''}`)
  if (subcategory.nb_a_revoir > 0) meta.push(`${subcategory.nb_a_revoir} à revoir`)
  if (subcategory.nb_justif_manquant > 0)
    meta.push(`${subcategory.nb_justif_manquant} sans justificatif`)

  const isOrphan = !!subcategory.is_orphan_from_n1

  return (
    <div className="mb-6 last:mb-0">
      <div className="flex items-baseline justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text">{subcategory.name}</h3>
          {isOrphan && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] bg-warning/15 text-warning border border-warning/30"
              title="Sous-cat présente en N-1 mais sans aucune opération en N"
            >
              absent en N
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="text-base font-semibold text-text tabular-nums flex items-center gap-2 justify-end">
            {formatCurrency(subcategory.total_ytd)}
            {subcategory.delta_n1 && (
              <LivretDeltaPill delta={subcategory.delta_n1} size="sm" hideIfNoBaseline={false} />
            )}
          </div>
          {subcategory.total_projected_annual !== null &&
            subcategory.total_projected_annual !== undefined && (
              <div className="text-[11px] text-primary tabular-nums">
                projeté {formatCurrency(subcategory.total_projected_annual)}
              </div>
            )}
        </div>
      </div>
      {!isOrphan && (
        <p className="text-xs text-text-muted px-1 -mt-1 mb-2">{meta.join(' · ')}</p>
      )}
      {!isOrphan ? (
        <LivretOpsTable operations={subcategory.operations} activeFilters={activeFilters} />
      ) : (
        <div className="px-1 text-xs text-text-muted italic">
          Aucune opération en {/* l'année N résolue côté caller */}cette année — comparaison N-1 conservée pour visibilité.
        </div>
      )}
    </div>
  )
}
