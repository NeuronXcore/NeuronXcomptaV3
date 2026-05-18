import { useMemo } from 'react'
import { AlertCircle, AlertOctagon, AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { useRecomputeRisque } from '@/hooks/usePlaquetteCheck'
import type { PlaquetteCheck, PlaquetteItem, RisqueNiveau } from '@/types'

interface PlaquetteRisqueDrawerSummaryProps {
  check: PlaquetteCheck
  readOnly?: boolean
}

const NIVEAU_META: Record<RisqueNiveau, { label: string; Icon: typeof AlertCircle; colorClass: string }> = {
  critique: { label: 'Critique', Icon: AlertOctagon, colorClass: 'text-red-400' },
  eleve: { label: 'Élevé', Icon: AlertTriangle, colorClass: 'text-orange-400' },
  modere: { label: 'Modéré', Icon: AlertCircle, colorClass: 'text-amber-400' },
  faible: { label: 'Faible', Icon: ShieldCheck, colorClass: 'text-emerald-400' },
}

function _globalLevelFromScore(score: number | null | undefined): { niveau: RisqueNiveau; colorClass: string } {
  if (score === null || score === undefined) return { niveau: 'faible', colorClass: 'text-text-muted' }
  if (score >= 2.5) return { niveau: 'critique', colorClass: 'text-red-400' }
  if (score >= 1.5) return { niveau: 'eleve', colorClass: 'text-orange-400' }
  if (score >= 0.5) return { niveau: 'modere', colorClass: 'text-amber-400' }
  return { niveau: 'faible', colorClass: 'text-emerald-400' }
}

/**
 * Summary risque fiscal — affiché dans l'onglet Comparatif, au-dessus du tableau.
 *
 * - Score global gros (X.X / 3.0)
 * - Badge niveau dominant
 * - 4 mini-compteurs (Critique / Élevé / Modéré / Faible)
 * - Bouton outline "Recalculer" (désactivé si readOnly)
 *
 * Session 39 P2.
 */
export function PlaquetteRisqueDrawerSummary({
  check,
  readOnly = false,
}: PlaquetteRisqueDrawerSummaryProps) {
  const recompute = useRecomputeRisque(check.year)

  const niveauCounts = useMemo(() => {
    const counts: Record<RisqueNiveau, number> = { critique: 0, eleve: 0, modere: 0, faible: 0 }
    ;(check.items || []).forEach((it: PlaquetteItem) => {
      const niv = it.risque_fiscal?.niveau
      if (niv) counts[niv] = (counts[niv] ?? 0) + 1
    })
    return counts
  }, [check.items])

  const score = check.risque_score_global ?? null
  const { niveau: globalNiveau, colorClass: globalColorClass } = _globalLevelFromScore(score)
  const GlobalIcon = NIVEAU_META[globalNiveau].Icon
  const nbEvaluated = Object.values(niveauCounts).reduce((s, n) => s + n, 0)

  const handleRecompute = async () => {
    try {
      const result = await recompute.mutateAsync()
      toast.success(
        `Recalcul terminé · ${result.nb_items_evaluated} items évalués · score ${result.risque_score_global ?? '—'}`,
      )
    } catch (e) {
      toast.error(`Recalcul échoué : ${(e as Error).message}`)
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface/40 p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Score global gros */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <GlobalIcon size={20} className={globalColorClass} />
            <div>
              <div className={cn('text-xl font-bold tabular-nums', globalColorClass)}>
                {score !== null ? `${score.toFixed(1)} / 3.0` : '—'}
              </div>
              <div className="text-[10px] text-text-muted uppercase tracking-wide">
                Risque global · {NIVEAU_META[globalNiveau].label}
              </div>
            </div>
          </div>
        </div>

        {/* 4 mini-compteurs */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['critique', 'eleve', 'modere', 'faible'] as RisqueNiveau[]).map((niv) => {
            const meta = NIVEAU_META[niv]
            const NivIcon = meta.Icon
            const count = niveauCounts[niv]
            return (
              <div
                key={niv}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-[11px]',
                  count > 0 ? 'bg-surface' : 'bg-surface/40 opacity-50',
                )}
              >
                <NivIcon size={11} className={meta.colorClass} />
                <span className="tabular-nums font-medium text-text">{count}</span>
                <span className="text-text-muted">{meta.label}</span>
              </div>
            )
          })}
        </div>

        {/* Bouton recalculer */}
        <button
          type="button"
          onClick={handleRecompute}
          disabled={recompute.isPending || readOnly}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
            'border-border text-text-muted hover:bg-surface hover:text-text',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          title={readOnly ? 'Exercice gelé — recalcul indisponible' : 'Forcer le recalcul de tous les items'}
        >
          <RefreshCw
            size={12}
            className={recompute.isPending ? 'animate-spin' : ''}
          />
          {recompute.isPending ? 'Recalcul…' : 'Recalculer'}
        </button>
      </div>
      {nbEvaluated < check.items.length && (
        <p className="mt-2 text-[10px] text-text-muted italic">
          {nbEvaluated} / {check.items.length} items évalués
          {nbEvaluated === 0 && ' — cliquer Recalculer pour démarrer'}
        </p>
      )}
    </div>
  )
}
