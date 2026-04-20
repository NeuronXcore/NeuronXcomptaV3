import { useMemo } from 'react'
import { Briefcase, User } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import type { BncMetrics, PersoMetrics, CategorySummary } from '@/types'

interface VentilationDepensesCardProps {
  bnc: BncMetrics | undefined
  perso: PersoMetrics | undefined
  categorySummary: CategorySummary[]
  /** Libellé contextuel (ex. "2026", "T2 2026", "Mars 2026") */
  periodLabel?: string
}

const PRO_COLOR = '#7F77DD'
const PERSO_COLOR = '#B4B2A9'

export default function VentilationDepensesCard({
  bnc,
  perso,
  categorySummary,
  periodLabel,
}: VentilationDepensesCardProps) {
  const proDebit = bnc?.charges_pro ?? 0
  const persoDebit = perso?.total_debit ?? 0
  const total = proDebit + persoDebit

  const proPct = total > 0 ? (proDebit / total) * 100 : 0
  const persoPct = total > 0 ? (persoDebit / total) * 100 : 0

  const proNbOps = bnc?.nb_ops_pro ?? 0
  const persoNbOps = perso?.nb_ops ?? 0

  // Top catégories par nature
  const { topPro, topPerso } = useMemo(() => {
    const proCats = categorySummary
      .filter((c) => c.nature === 'pro' && c['Débit'] > 0)
      .sort((a, b) => b['Débit'] - a['Débit'])
      .slice(0, 3)
      .map((c) => c['Catégorie'])
    const persoCats = categorySummary
      .filter((c) => c.nature === 'perso' && c['Débit'] > 0)
      .sort((a, b) => b['Débit'] - a['Débit'])
      .slice(0, 3)
      .map((c) => c['Catégorie'])
    return { topPro: proCats, topPerso: persoCats }
  }, [categorySummary])

  if (total === 0) return null

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Ventilation des dépenses</h2>
        {periodLabel && <span className="text-xs text-text-muted">{periodLabel}</span>}
      </div>

      {/* Barre empilée horizontale */}
      <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-hover mb-4">
        <div
          className="transition-all"
          style={{ width: `${proPct}%`, background: PRO_COLOR }}
          title={`Pro : ${proPct.toFixed(1)}%`}
        />
        <div
          className="transition-all"
          style={{ width: `${persoPct}%`, background: PERSO_COLOR }}
          title={`Perso : ${persoPct.toFixed(1)}%`}
        />
      </div>

      {/* Grid 2 colonnes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Pro */}
        <div className="rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: PRO_COLOR }}
              />
              <div className="flex items-center gap-1.5">
                <Briefcase size={12} className="text-text-muted" />
                <span className="text-sm font-medium text-text">Pro déductible</span>
              </div>
            </div>
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded"
              style={{ background: '#EEEDFE', color: '#3C3489' }}
            >
              dans le BNC
            </span>
          </div>
          <div className="text-xl font-semibold text-text tabular-nums mb-1">
            {formatCurrency(proDebit)}
          </div>
          <p className="text-xs text-text-muted">
            {proPct.toFixed(1)}% · {proNbOps} ops
          </p>
          {topPro.length > 0 && (
            <p className="text-[11px] text-text-muted/80 mt-1.5 line-clamp-1">
              {topPro.join(' · ')}
            </p>
          )}
        </div>

        {/* Perso */}
        <div className="rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: PERSO_COLOR }}
              />
              <div className="flex items-center gap-1.5">
                <User size={12} className="text-text-muted" />
                <span className="text-sm font-medium text-text">Perso</span>
              </div>
            </div>
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded text-text-muted"
              style={{ background: 'rgba(148,163,184,0.15)' }}
            >
              hors BNC
            </span>
          </div>
          <div className={cn('text-xl font-semibold tabular-nums mb-1', persoDebit > 0 ? 'text-text' : 'text-text-muted/60')}>
            {formatCurrency(persoDebit)}
          </div>
          <p className="text-xs text-text-muted">
            {persoPct.toFixed(1)}% · {persoNbOps} ops
          </p>
          {topPerso.length > 0 && (
            <p className="text-[11px] text-text-muted/80 mt-1.5 line-clamp-1">
              {topPerso.join(' · ')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
