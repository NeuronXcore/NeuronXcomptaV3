import { AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useLiasseScpDrawerStore } from '@/stores/liasseScpDrawerStore'
import { formatCurrency, cn } from '@/lib/utils'
import type { BncMetrics } from '@/types'

interface BncBannerProps {
  bnc: BncMetrics | undefined
  /** Désactive le bandeau si filtre mois/quarter actif (CA liasse n'est applicable qu'en année complète) */
  disabled?: boolean
}

export default function BncBanner({ bnc, disabled }: BncBannerProps) {
  const { selectedYear } = useFiscalYearStore()
  const openLiasseDrawer = useLiasseScpDrawerStore((s) => s.open)

  if (!bnc || disabled) return null

  const isDefinitif = bnc.base_recettes === 'liasse' && bnc.ca_liasse !== null
  const deltaAbs = isDefinitif && bnc.ca_liasse !== null
    ? bnc.ca_liasse - bnc.recettes_pro_bancaires
    : 0
  const deltaPct = isDefinitif && bnc.recettes_pro_bancaires
    ? (deltaAbs / bnc.recettes_pro_bancaires) * 100
    : 0

  const handleOpen = () => {
    openLiasseDrawer({ initialYear: selectedYear, yearSource: 'fiscal_store' })
  }

  if (isDefinitif) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-success/30 bg-gradient-to-r from-success/10 via-success/5 to-transparent p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-success/20 shrink-0">
              <CheckCircle2 size={20} className="text-success" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">
                BNC définitif — base liasse fiscale SCP · {formatCurrency(bnc.ca_liasse!)}
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                Écart avec bancaire : <span className={cn('font-mono', Math.abs(deltaPct) > 10 ? 'text-danger' : Math.abs(deltaPct) >= 5 ? 'text-warning' : 'text-text-muted')}>
                  {deltaAbs >= 0 ? '+' : ''}{formatCurrency(deltaAbs)} ({deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)} %)
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={handleOpen}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-success hover:bg-success/10 transition-colors"
          >
            Modifier
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-warning/30 bg-gradient-to-r from-warning/10 via-warning/5 to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-warning/20 shrink-0">
            <AlertTriangle size={20} className="text-warning" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text">
              BNC provisoire — base bancaire pour {selectedYear}
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              Base définitive dès saisie du CA sur la liasse fiscale SCP ({formatCurrency(bnc.recettes_pro_bancaires)} en recettes bancaires pour l'instant).
            </p>
          </div>
        </div>
        <button
          onClick={handleOpen}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-warning/90 text-white hover:bg-warning transition-colors"
        >
          Saisir le CA
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  )
}
