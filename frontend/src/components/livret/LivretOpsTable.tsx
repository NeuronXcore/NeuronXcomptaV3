/**
 * Tableau des opérations niveau 3.
 * Colonnes : toggle expand · date · libellé · flags · montant.
 * Expand row = LivretVentilationDetail (sub_lines en arborescence).
 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { LivretOperation, LivretActiveFilters } from '@/types/livret'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import LivretFlagPills from './LivretFlagPills'
import LivretVentilationDetail from './LivretVentilationDetail'
import LivretFiltersCounter from './LivretFiltersCounter'

interface Props {
  operations: LivretOperation[]
  activeFilters: LivretActiveFilters
}

function applyFilters(ops: LivretOperation[], active: LivretActiveFilters): LivretOperation[] {
  if (active.size === 0) return ops
  return ops.filter((op) => {
    const f = op.flags
    if (active.has('a_revoir') && !f.a_revoir) return false
    if (active.has('justif_manquant') && !f.justificatif_manquant) return false
    if (active.has('mixte') && !f.is_mixte) return false
    if (active.has('locked') && !f.locked) return false
    return true
  })
}

export default function LivretOpsTable({ operations, activeFilters }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => applyFilters(operations, activeFilters), [operations, activeFilters])

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (operations.length === 0) {
    return <div className="text-sm text-text-muted italic px-2 py-3">Aucune opération.</div>
  }

  return (
    <div>
      <LivretFiltersCounter filtered={filtered.length} total={operations.length} />

      {filtered.length === 0 ? (
        <div className="text-sm text-text-muted italic px-2 py-6 text-center">
          Aucune opération ne correspond aux filtres actifs.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-hover">
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
                <th className="w-8 px-2 py-2"></th>
                <th className="w-24 px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Libellé</th>
                <th className="w-32 px-2 py-2 font-semibold">Flags</th>
                <th className="w-28 px-2 py-2 font-semibold text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((op) => {
                const key = `${op.operation_file}:${op.operation_index}:${op.ventilation_index ?? ''}`
                const hasDetail = (op.sub_lines && op.sub_lines.length > 0) || op.flags.locked || op.flags.lettre
                const isOpen = expanded.has(key)
                return (
                  <Row
                    key={key}
                    op={op}
                    isOpen={isOpen}
                    hasDetail={!!hasDetail}
                    onToggle={() => toggleExpand(key)}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Row({
  op,
  isOpen,
  hasDetail,
  onToggle,
}: {
  op: LivretOperation
  isOpen: boolean
  hasDetail: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className={cn(
          'border-t border-border transition-colors',
          hasDetail ? 'cursor-pointer hover:bg-surface-hover/60' : '',
        )}
        onClick={hasDetail ? onToggle : undefined}
      >
        <td className="px-2 py-2 align-middle">
          {hasDetail ? (
            isOpen ? (
              <ChevronDown size={14} className="text-text-muted" />
            ) : (
              <ChevronRight size={14} className="text-text-muted" />
            )
          ) : null}
        </td>
        <td className="px-2 py-2 text-text-muted tabular-nums whitespace-nowrap">
          {formatDate(op.date)}
        </td>
        <td className="px-2 py-2 text-text">
          <div className="truncate" title={op.libelle}>{op.libelle}</div>
          {op.libelle_meta && (
            <div className="text-[11px] text-text-muted italic">{op.libelle_meta}</div>
          )}
        </td>
        <td className="px-2 py-2">
          <LivretFlagPills flags={op.flags} size={10} />
        </td>
        <td className="px-2 py-2 text-right text-text tabular-nums">
          {formatCurrency(op.montant)}
          {op.montant_brut !== null && op.montant_brut !== undefined && op.taux_pro !== null && (
            <div className="text-[11px] text-text-muted">
              brut {formatCurrency(op.montant_brut)} · {Math.round(op.taux_pro)}%
            </div>
          )}
        </td>
      </tr>
      {isOpen && hasDetail && (
        <tr className="bg-background">
          <td colSpan={5} className="p-0">
            <LivretVentilationDetail operation={op} />
          </td>
        </tr>
      )}
    </>
  )
}
