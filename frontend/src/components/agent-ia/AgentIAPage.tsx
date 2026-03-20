import { useMLModel, useMLModelFull, useTrainingData } from '@/hooks/useApi'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import GaugesRow from './GaugesRow'
import ActionsRapides from './ActionsRapides'
import LearningCurveChart from './LearningCurveChart'
import RulesPanel from './RulesPanel'
import BackupsPanel from './BackupsPanel'

export default function AgentIAPage() {
  const { data: modelInfo, isLoading: infoLoading, error: infoError } = useMLModel()
  const { data: modelFull, isLoading: fullLoading } = useMLModelFull()
  const { data: trainingData } = useTrainingData()

  if (infoLoading || fullLoading) return <LoadingSpinner text="Chargement du modèle ML..." />
  if (infoError) return <p className="text-danger p-8">Erreur: {infoError.message}</p>
  if (!modelInfo || !modelFull) return null

  const { stats } = modelInfo
  const learningCurve = modelFull.stats.learning_curve

  // Compute gauge values
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

      <div className="space-y-6">
        {/* TOP: Gauges row */}
        <GaugesRow
          precision={lastAccTest}
          confidence={confidence}
          examplesCount={examplesCount}
          rulesCount={rulesCount}
          opsProcessed={opsProcessed}
          lastTraining={stats.last_training}
        />

        {/* MIDDLE: Actions + Learning Curve */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2">
            <ActionsRapides />
          </div>
          <div className="lg:col-span-3">
            <LearningCurveChart learningCurve={learningCurve} />
          </div>
        </div>

        {/* BOTTOM: Rules + Backups */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RulesPanel
            exactMatches={modelFull.exact_matches}
            subcategories={modelFull.subcategories}
          />
          <BackupsPanel />
        </div>
      </div>
    </div>
  )
}
