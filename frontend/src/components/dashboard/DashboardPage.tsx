import { useState } from 'react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useNavigate } from 'react-router-dom'
import { useYearOverview } from '@/hooks/useApi'
import { useClotureYears } from '@/hooks/useCloture'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import YearSelector from './YearSelector'
import ProgressionGauge from './ProgressionGauge'
import KpiCards from './KpiCards'
import MonthsGrid from './MonthsGrid'
import AlertesSection from './AlertesSection'
import FiscalDeadlines from './FiscalDeadlines'
import RevenueChart from './RevenueChart'
import ActivityFeed from './ActivityFeed'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { selectedYear, setYear: setSelectedYear } = useFiscalYearStore()
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null)

  const { data: years } = useClotureYears()
  const { data, isLoading, error } = useYearOverview(selectedYear)

  if (isLoading) return <LoadingSpinner text="Chargement du cockpit..." />
  if (error) return <p className="text-danger">Erreur: {error.message}</p>
  if (!data) return null

  const handleToggleMonth = (m: number) => {
    setExpandedMonth(prev => prev === m ? null : m)
  }

  // Ensure current year is in the list
  const allYears = [...new Set([...(years ?? []), selectedYear])].sort((a, b) => b - a)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exercice comptable"
        description={`Cockpit ${selectedYear} — ${data.kpis.nb_mois_actifs} mois actifs, ${data.kpis.nb_operations} opérations`}
        actions={
          <YearSelector year={selectedYear} years={allYears} onChange={setSelectedYear} />
        }
      />

      {/* Progression gauge */}
      <ProgressionGauge progression={data.progression} />

      {/* KPI cards */}
      <KpiCards kpis={data.kpis} delta={data.delta_n1} />

      {/* Months grid */}
      <div>
        <h3 className="text-sm font-semibold text-text mb-3">Mois de l'exercice</h3>
        <MonthsGrid
          mois={data.mois}
          year={selectedYear}
          expandedMonth={expandedMonth}
          onToggle={handleToggleMonth}
        />
      </div>

      {/* Alertes */}
      {data.alertes.length > 0 && (
        <AlertesSection alertes={data.alertes} year={selectedYear} />
      )}

      {/* Pending reports */}
      {data.pending_reports && data.pending_reports.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text mb-2">Rapports à générer</h3>
          <div className="flex flex-wrap gap-2">
            {data.pending_reports.map((pr: { type: string; period: string; message: string; month?: number; quarter?: number }, i: number) => (
              <button
                key={`${pr.type}-${i}`}
                onClick={() => navigate('/reports')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400 text-xs hover:bg-amber-500/20 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {pr.period}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fiscal deadlines */}
      <div>
        <h3 className="text-sm font-semibold text-text mb-2">Échéances fiscales</h3>
        <FiscalDeadlines />
      </div>

      {/* Bottom row: chart + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueChart mois={data.mois} />
        <ActivityFeed activites={data.activite_recente} />
      </div>
    </div>
  )
}
