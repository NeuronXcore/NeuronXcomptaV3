import { useNavigate } from 'react-router-dom'
import { TrendingUp, TrendingDown, Calculator, Landmark, Brain, Minus } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import { useMLHealthKPI } from '@/hooks/useApi'
import type { DashboardKPIs, DeltaN1 } from '@/types'

interface KpiCardsProps {
  kpis: DashboardKPIs
  delta: DeltaN1 | null
}

function DeltaBadge({ value, invert = false }: { value: number; invert?: boolean }) {
  if (value === 0) return null
  const isPositive = value > 0
  const isGood = invert ? !isPositive : isPositive
  return (
    <span className={cn(
      'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
      isGood ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
    )}>
      {isPositive ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data.map(Math.abs), 1)
  const h = 28
  return (
    <div className="flex items-end gap-0.5 h-7">
      {data.map((v, i) => {
        const absH = Math.max(2, (Math.abs(v) / max) * h)
        return (
          <div
            key={i}
            className={cn('w-1.5 rounded-sm', v >= 0 ? 'bg-primary/60' : 'bg-red-400/60')}
            style={{ height: `${absH}px` }}
          />
        )
      })}
    </div>
  )
}

export default function KpiCards({ kpis, delta }: KpiCardsProps) {
  const navigate = useNavigate()
  const { data: health } = useMLHealthKPI()
  const chargesSociales = Math.round(kpis.bnc_estime * 0.39)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      {/* Recettes */}
      <div className="bg-surface rounded-lg p-4 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <TrendingUp size={16} className="text-emerald-400" />
          </div>
          <span className="text-xs text-text-muted">Recettes</span>
          {delta && <DeltaBadge value={delta.delta_recettes_pct} />}
        </div>
        <p className="text-xl font-bold text-text">{formatCurrency(kpis.total_recettes)}</p>
      </div>

      {/* Charges */}
      <div className="bg-surface rounded-lg p-4 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
            <TrendingDown size={16} className="text-red-400" />
          </div>
          <span className="text-xs text-text-muted">Charges totales</span>
          {delta && <DeltaBadge value={delta.delta_charges_pct} invert />}
        </div>
        <p className="text-xl font-bold text-text">{formatCurrency(kpis.total_charges)}</p>
      </div>

      {/* BNC */}
      <div className="bg-surface rounded-lg p-4 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Calculator size={16} className="text-primary" />
          </div>
          <span className="text-xs text-text-muted">BNC estimé</span>
          {delta && <DeltaBadge value={delta.delta_bnc_pct} />}
        </div>
        <div className="flex items-end justify-between">
          <p className={cn('text-xl font-bold', kpis.bnc_estime >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {formatCurrency(kpis.bnc_estime)}
          </p>
          <Sparkline data={kpis.bnc_mensuel} />
        </div>
      </div>

      {/* Charges sociales */}
      <div className="bg-surface rounded-lg p-4 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Landmark size={16} className="text-amber-400" />
          </div>
          <span className="text-xs text-text-muted">Charges sociales prov.</span>
        </div>
        <p className="text-xl font-bold text-text">{formatCurrency(chargesSociales)}</p>
        <p className="text-[10px] text-text-muted mt-1">URSSAF + CARMF + ODM (~39%)</p>
      </div>

      {/* Agent IA */}
      <div
        className="bg-surface rounded-lg p-4 border border-border cursor-pointer hover:ring-2 hover:ring-primary/40 transition-all"
        onClick={() => navigate('/agent-ai')}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Brain size={16} className="text-purple-400" />
          </div>
          <span className="text-xs text-text-muted">Agent IA</span>
          {health?.correction_trend === 'improving' && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center gap-0.5">
              <TrendingDown size={8} /> amél.
            </span>
          )}
          {health?.correction_trend === 'degrading' && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 flex items-center gap-0.5">
              <TrendingUp size={8} /> dégr.
            </span>
          )}
          {health?.correction_trend === 'stable' && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-500/15 text-text-muted flex items-center gap-0.5">
              <Minus size={8} /> stable
            </span>
          )}
        </div>
        <p className="text-xl font-bold text-text">
          {health ? `${Math.round(health.coverage_rate * 100)}%` : '—'}
        </p>
        <p className="text-[10px] text-text-muted mt-1">
          {health ? `Corrections : ${Math.round(health.correction_rate * 100)}%` : 'Couverture IA'}
        </p>
        {health?.alert && (
          <p className="text-[10px] text-red-400 mt-1 truncate">{health.alert}</p>
        )}
      </div>
    </div>
  )
}
