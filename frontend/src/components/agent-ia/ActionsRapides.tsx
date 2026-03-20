import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'
import { Brain, Play, Save, Loader2, CheckCircle, AlertTriangle, XCircle, Zap } from 'lucide-react'
import type { PredictionResult, TrainResult } from '@/types'

export default function ActionsRapides() {
  const queryClient = useQueryClient()

  // --- Predict ---
  const [libelle, setLibelle] = useState('')
  const [prediction, setPrediction] = useState<PredictionResult | null>(null)

  const predictMutation = useMutation({
    mutationFn: (lib: string) => api.post<PredictionResult>('/ml/predict', { libelle: lib }),
    onSuccess: (data) => setPrediction(data),
  })

  // --- Train ---
  const [trainResult, setTrainResult] = useState<TrainResult | null>(null)

  const trainMutation = useMutation({
    mutationFn: () => api.post<TrainResult>('/ml/train'),
    onSuccess: (data) => {
      setTrainResult(data)
      queryClient.invalidateQueries({ queryKey: ['ml-model'] })
      queryClient.invalidateQueries({ queryKey: ['ml-model-full'] })
    },
  })

  // --- Backup ---
  const [backupMsg, setBackupMsg] = useState('')

  const backupMutation = useMutation({
    mutationFn: () => api.post<{ backup_name: string }>('/ml/backup'),
    onSuccess: (data) => {
      setBackupMsg(`Backup créé : ${data.backup_name}`)
      queryClient.invalidateQueries({ queryKey: ['ml-backups'] })
      setTimeout(() => setBackupMsg(''), 5000)
    },
  })

  const handlePredict = (e: React.FormEvent) => {
    e.preventDefault()
    if (!libelle.trim()) return
    setPrediction(null)
    predictMutation.mutate(libelle.trim())
  }

  const confidencePct = prediction ? Math.round(prediction.confidence * 100) : 0

  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-5 h-full">
      <h3 className="text-sm font-semibold text-text flex items-center gap-2">
        <Zap size={16} className="text-primary" />
        Actions rapides
      </h3>

      {/* Tester une prédiction */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Tester une prédiction</p>
        <form onSubmit={handlePredict} className="flex gap-2">
          <input
            type="text"
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            placeholder="Ex: LIDL MONTAUBAN"
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={predictMutation.isPending || !libelle.trim()}
            className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/80 disabled:opacity-50 flex items-center gap-1.5"
          >
            {predictMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
            Prédire
          </button>
        </form>

        {/* Résultat prédiction */}
        {prediction && (
          <div className="bg-background rounded-lg p-3 space-y-2 border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Catégorie prédite</span>
              <span className="text-sm font-semibold text-primary">
                {prediction.best_prediction || 'Aucune'}
              </span>
            </div>

            {prediction.rules_subcategory && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">Sous-catégorie</span>
                <span className="text-xs text-text">{prediction.rules_subcategory}</span>
              </div>
            )}

            {/* Barre de confiance */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Confiance</span>
                <span className={cn(
                  'font-medium',
                  confidencePct >= 70 ? 'text-emerald-400' : confidencePct >= 40 ? 'text-amber-400' : 'text-red-400'
                )}>
                  {confidencePct}%
                </span>
              </div>
              <div className="h-2 bg-border/30 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    confidencePct >= 70 ? 'bg-emerald-400' : confidencePct >= 40 ? 'bg-amber-400' : 'bg-red-400'
                  )}
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
            </div>

            {/* Hallucination risk */}
            <div className="flex items-center gap-2 text-xs">
              {prediction.hallucination_risk ? (
                <>
                  <AlertTriangle size={12} className="text-amber-400" />
                  <span className="text-amber-400">Risque d'hallucination</span>
                </>
              ) : (
                <>
                  <CheckCircle size={12} className="text-emerald-400" />
                  <span className="text-emerald-400">Prédiction fiable</span>
                </>
              )}
            </div>

            {/* Sources */}
            <div className="flex gap-3 text-[10px] text-text-muted/60 pt-1 border-t border-border/30">
              <span>Règles: {prediction.rules_prediction || '—'}</span>
              <span>ML: {prediction.sklearn_prediction || '—'}</span>
            </div>
          </div>
        )}

        {predictMutation.isError && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <XCircle size={12} /> {predictMutation.error.message}
          </p>
        )}
      </div>

      {/* Entraîner le modèle */}
      <div className="space-y-3 pt-3 border-t border-border/30">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Entraîner le modèle</p>
        <button
          onClick={() => { setTrainResult(null); trainMutation.mutate() }}
          disabled={trainMutation.isPending}
          className="w-full bg-emerald-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {trainMutation.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Entraînement en cours...
            </>
          ) : (
            <>
              <Play size={14} />
              Lancer l'entraînement
            </>
          )}
        </button>

        {trainResult && trainResult.success && (
          <div className="bg-background rounded-lg p-3 border border-emerald-500/30">
            <div className="flex items-center gap-1.5 mb-2">
              <CheckCircle size={14} className="text-emerald-400" />
              <span className="text-xs font-medium text-emerald-400">Entraînement réussi</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">Accuracy (train)</span>
                <span className="text-text font-medium">{(trainResult.metrics.accuracy_train * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Accuracy (test)</span>
                <span className="text-text font-medium">{(trainResult.metrics.accuracy_test * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">F1 Score</span>
                <span className="text-text font-medium">{(trainResult.metrics.f1 * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Précision</span>
                <span className="text-text font-medium">{(trainResult.metrics.precision * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        )}

        {trainMutation.isError && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <XCircle size={12} /> {trainMutation.error.message}
          </p>
        )}
      </div>

      {/* Backup */}
      <div className="space-y-2 pt-3 border-t border-border/30">
        <button
          onClick={() => backupMutation.mutate()}
          disabled={backupMutation.isPending}
          className="w-full bg-surface border border-border text-text px-4 py-2 rounded-lg text-sm hover:bg-surface-hover flex items-center justify-center gap-2"
        >
          {backupMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Sauvegarder le modèle
        </button>
        {backupMsg && (
          <p className="text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle size={12} /> {backupMsg}
          </p>
        )}
      </div>
    </div>
  )
}
