import { useState, useMemo } from 'react'
import { Calculator } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import SimulationOptimisationSection from './SimulationOptimisationSection'
import SimulationPrevisionsSection from './SimulationPrevisionsSection'
import { useBaremes } from '@/hooks/useSimulation'
import { cn } from '@/lib/utils'

type TabKey = 'optimisation' | 'previsions'

export default function SimulationPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [activeTab, setActiveTab] = useState<TabKey>('optimisation')

  const availableYears = useMemo(() => {
    const years = []
    for (let y = currentYear - 3; y <= currentYear + 1; y++) years.push(y)
    return years
  }, [currentYear])

  const { isLoading: baremesLoading } = useBaremes(year)

  if (baremesLoading) return <LoadingSpinner text="Chargement des barèmes..." />

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'optimisation', label: 'Optimisation' },
    { key: 'previsions', label: 'Prévisions' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulation BNC"
        description={`Exercice ${year} — Optimisation fiscale et prévisions d'honoraires`}
        actions={
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        }
      />

      <div className="flex gap-1 bg-background rounded-lg p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-md transition-colors',
              activeTab === tab.key
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:text-text'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'optimisation' && <SimulationOptimisationSection year={year} />}
      {activeTab === 'previsions' && <SimulationPrevisionsSection year={year} />}
    </div>
  )
}
