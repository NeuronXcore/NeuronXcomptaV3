import { useState } from 'react'
import { useMLModel, useMLModelFull, useTrainingData } from '@/hooks/useApi'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import GaugesRow from './GaugesRow'
import ActionsRapides from './ActionsRapides'
import LearningCurveChart from './LearningCurveChart'
import RulesPanel from './RulesPanel'
import BackupsPanel from './BackupsPanel'
import MLMonitoringTab from './MLMonitoringTab'
import { cn } from '@/lib/utils'
import { Bot, Activity } from 'lucide-react'

const TABS = [
  { key: 'dashboard', label: 'Dashboard ML', icon: Bot },
  { key: 'monitoring', label: 'Monitoring', icon: Activity },
] as const

type TabKey = typeof TABS[number]['key']

export default function AgentIAPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const { data: modelInfo, isLoading: infoLoading, error: infoError } = useMLModel()
  const { data: modelFull, isLoading: fullLoading } = useMLModelFull()
  const { data: trainingData } = useTrainingData()

  if (infoLoading || fullLoading) return <LoadingSpinner text="Chargement du modèle ML..." />
  if (infoError) return <p className="text-danger p-8">Erreur: {infoError.message}</p>
  if (!modelInfo || !modelFull) return null

  const { stats } = modelInfo
  const learningCurve = modelFull.stats.learning_curve

  const lastAccTest = learningCurve?.acc_test?.length
    ? learningCurve.acc_test[learningCurve.acc_test.length - 1] * 100
    : 0
  const confidence = stats.success_rate * 100
  const examplesCount = trainingData?.count || 0
  const rulesCount = modelInfo.exact_matches_count
  const opsProcessed = stats.operations_processed

  return (
    <div>
      <PageHeader
        title="Agent IA"
        description="Dashboard ML — Entraînement et gestion du modèle de catégorisation"
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === key
                ? 'text-primary border-primary'
                : 'text-text-muted border-transparent hover:text-text hover:border-border'
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          <GaugesRow
            precision={lastAccTest}
            confidence={confidence}
            examplesCount={examplesCount}
            rulesCount={rulesCount}
            opsProcessed={opsProcessed}
            lastTraining={stats.last_training}
          />

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2">
              <ActionsRapides />
            </div>
            <div className="lg:col-span-3">
              <LearningCurveChart learningCurve={learningCurve} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RulesPanel
              exactMatches={modelFull.exact_matches}
              subcategories={modelFull.subcategories}
            />
            <BackupsPanel />
          </div>
        </div>
      )}

      {activeTab === 'monitoring' && <MLMonitoringTab />}
    </div>
  )
}
