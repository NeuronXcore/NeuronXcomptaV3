import { useState } from 'react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { TrendingUp, BarChart3, Building2, Settings } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { cn } from '@/lib/utils'
import TimelineTab from './TimelineTab'
import FournisseursTab from './FournisseursTab'
import SettingsTab from './SettingsTab'

type Tab = 'timeline' | 'fournisseurs' | 'parametres'

const TABS = [
  { key: 'timeline' as Tab, label: 'Timeline', icon: BarChart3 },
  { key: 'fournisseurs' as Tab, label: 'Fournisseurs', icon: Building2 },
  { key: 'parametres' as Tab, label: 'Paramètres', icon: Settings },
]

export default function PrevisionnelPage() {
  const [activeTab, setActiveTab] = useState<Tab>('timeline')
  const { selectedYear: year, setYear } = useFiscalYearStore()

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Prévisionnel"
        description="Calendrier de trésorerie — charges, recettes et suivi des factures"
        actions={
          <div className="flex items-center gap-3">
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text"
            >
              {[year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border mb-6 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors',
              activeTab === tab.key
                ? 'bg-primary text-white'
                : 'text-text-muted hover:text-text',
            )}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'timeline' && <TimelineTab year={year} />}
      {activeTab === 'fournisseurs' && <FournisseursTab year={year} />}
      {activeTab === 'parametres' && <SettingsTab />}
    </div>
  )
}
