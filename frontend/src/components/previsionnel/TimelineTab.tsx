import { useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Scale, ShieldCheck, Search, RefreshCw, Loader2 } from 'lucide-react'
import MetricCard from '@/components/shared/MetricCard'
import { useTimeline, useScanPrev, useRefreshEcheances } from '@/hooks/usePrevisionnel'
import { formatCurrency, cn } from '@/lib/utils'
import TimelineChart from './TimelineChart'
import MonthExpansion from './MonthExpansion'

interface Props {
  year: number
}

export default function TimelineTab({ year }: Props) {
  const [showCumul, setShowCumul] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)

  const { data: timeline, isLoading } = useTimeline(year)
  const scan = useScanPrev()
  const refresh = useRefreshEcheances()

  const selectedMois = timeline?.mois.find((m) => m.mois === selectedMonth)

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showCumul}
            onChange={(e) => setShowCumul(e.target.checked)}
            className="accent-primary"
          />
          Trésorerie cumulée
        </label>
        <div className="flex-1" />
        <button
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-muted hover:text-text transition-colors disabled:opacity-50"
        >
          {scan.isPending ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          Scanner
        </button>
        <button
          onClick={() => refresh.mutate(year)}
          disabled={refresh.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-muted hover:text-text transition-colors disabled:opacity-50"
        >
          {refresh.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Actualiser
        </button>
      </div>

      {/* KPIs */}
      {timeline && (
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            title="Charges prévues"
            value={formatCurrency(timeline.charges_annuelles)}
            icon={<ArrowDownCircle size={18} className="text-red-400" />}
          />
          <MetricCard
            title="Recettes projetées"
            value={formatCurrency(timeline.recettes_annuelles)}
            icon={<ArrowUpCircle size={18} className="text-emerald-400" />}
          />
          <MetricCard
            title="Solde prévisionnel"
            value={formatCurrency(timeline.solde_annuel)}
            icon={<Scale size={18} className={timeline.solde_annuel >= 0 ? 'text-emerald-400' : 'text-red-400'} />}
          />
          <MetricCard
            title="Taux vérification"
            value={`${Math.round(timeline.taux_verification * 100)}%`}
            icon={<ShieldCheck size={18} className="text-primary" />}
          />
        </div>
      )}

      {/* Chart */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-text-muted">
          <Loader2 size={20} className="animate-spin mr-2" />
          Chargement...
        </div>
      ) : timeline ? (
        <div className="bg-surface rounded-xl border border-border p-4">
          <TimelineChart
            mois={timeline.mois}
            showCumul={showCumul}
            selectedMonth={selectedMonth}
            onSelectMonth={setSelectedMonth}
          />
        </div>
      ) : null}

      {/* Month expansion */}
      {selectedMois && (
        <MonthExpansion
          month={selectedMois}
          onClose={() => setSelectedMonth(null)}
        />
      )}
    </div>
  )
}
