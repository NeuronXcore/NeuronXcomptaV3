import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'
import { Brain, BrainCircuit, Play, Save, Loader2, CheckCircle, AlertTriangle, XCircle, Zap, Database } from 'lucide-react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import toast from 'react-hot-toast'
import type { PredictionResult, TrainResult, TrainAndApplyResult, ImportTrainingResult } from '@/types'

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

  // --- Import bulk depuis opérations catégorisées ---
  const [importResult, setImportResult] = useState<ImportTrainingResult | null>(null)

  const importMutation = useMutation({
    mutationFn: () => {
      const qs = allYears ? '' : `?year=${selectedYear}`
      return api.post<ImportTrainingResult>(`/ml/import-from-operations${qs}`)
    },
    onSuccess: (data) => {
      setImportResult(data)
      toast.success(
        `${data.examples_added} nouveaux exemples importés · ${data.rules_updated} règles · total ${data.total_training_data}`,
      )
      queryClient.invalidateQueries({ queryKey: ['ml-model'] })
      queryClient.invalidateQueries({ queryKey: ['ml-model-full'] })
      queryClient.invalidateQueries({ queryKey: ['ml-training-data'] })
    },
    onError: (error: Error) => toast.error(`Erreur import : ${error.message}`),
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

  // --- Train + Apply ---
  const { selectedYear } = useFiscalYearStore()
  const [allYears, setAllYears] = useState(false)
  const [applyResult, setApplyResult] = useState<TrainAndApplyResult | null>(null)

  const trainAndApplyMutation = useMutation({
    mutationFn: () => {
      const qs = allYears ? '' : `?year=${selectedYear}`
      return api.post<TrainAndApplyResult>(`/ml/train-and-apply${qs}`)
    },
    onSuccess: (data) => {
      setApplyResult(data)
      toast.dismiss('train-apply')
      toast.success(
        `Modèle entraîné. ${data.apply_results.total_modified} opérations recatégorisées sur ${data.apply_results.files_processed} fichiers.`
      )
      queryClient.invalidateQueries({ queryKey: ['ml-model'] })
      queryClient.invalidateQueries({ queryKey: ['ml-model-full'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['operation-files'] })
    },
    onError: (error) => {
      toast.dismiss('train-apply')
      toast.error(`Erreur : ${error.message}`)
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
                <span className="text-text font-medium">{(trainResult.metrics.acc_train * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Accuracy (test)</span>
                <span className="text-text font-medium">{(trainResult.metrics.acc_test * 100).toFixed(1)}%</span>
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

        {trainResult && !trainResult.success && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <XCircle size={12} /> Entraînement échoué — vérifier les logs backend
          </p>
        )}

        {trainMutation.isError && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <XCircle size={12} /> {trainMutation.error.message}
          </p>
        )}
      </div>

      {/* Entraîner + Appliquer */}
      <div className="space-y-3 pt-3 border-t border-border/30">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Entraîner + Appliquer</p>

        <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={allYears}
            onChange={(e) => setAllYears(e.target.checked)}
            className="rounded border-border"
          />
          Toutes les années {!allYears && <span className="text-text/60">({selectedYear})</span>}
        </label>

        <button
          onClick={() => { setApplyResult(null); toast.loading('Entraînement + recatégorisation en cours...', { id: 'train-apply' }); trainAndApplyMutation.mutate() }}
          disabled={trainAndApplyMutation.isPending}
          className="w-full bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-green-500 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {trainAndApplyMutation.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Entraînement + application en cours...
            </>
          ) : (
            <>
              <BrainCircuit size={14} />
              Entraîner + Appliquer {allYears ? '(toutes)' : selectedYear}
            </>
          )}
        </button>

        {applyResult && applyResult.success && (
          <div className="bg-background rounded-lg p-3 border border-green-500/30 space-y-2">
            <div className="flex items-center gap-1.5">
              <CheckCircle size={14} className="text-green-400" />
              <span className="text-xs font-medium text-green-400">Entraînement + application réussis</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">Accuracy (test)</span>
                <span className="text-text font-medium">{(applyResult.train_metrics.acc_test * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">F1 Score</span>
                <span className="text-text font-medium">{(applyResult.train_metrics.f1 * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Fichiers traités</span>
                <span className="text-text font-medium">{applyResult.apply_results.files_processed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Ops modifiées</span>
                <span className="text-text font-medium">{applyResult.apply_results.total_modified} / {applyResult.apply_results.total_operations}</span>
              </div>
            </div>
          </div>
        )}

        {trainAndApplyMutation.isError && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <XCircle size={12} /> {trainAndApplyMutation.error.message}
          </p>
        )}
      </div>

      {/* Import bulk : opérations catégorisées → training data */}
      <div className="space-y-3 pt-3 border-t border-border/30">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Importer données historiques</p>
        <p className="text-[11px] text-text-muted/70">
          Enrichit le corpus sklearn avec les opérations déjà catégorisées dans l'éditeur.
          Dédup par (libellé nettoyé, catégorie) + mise à jour des règles exactes.
        </p>

        <button
          onClick={() => { setImportResult(null); importMutation.mutate() }}
          disabled={importMutation.isPending}
          className="w-full bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-500 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {importMutation.isPending ? (
            <><Loader2 size={14} className="animate-spin" /> Import en cours...</>
          ) : (
            <><Database size={14} /> Importer ops catégorisées {allYears ? '(toutes)' : selectedYear}</>
          )}
        </button>

        {importResult && (
          <div className="bg-background rounded-lg p-3 border border-blue-500/30 space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle size={14} className="text-blue-400" />
              <span className="font-medium text-blue-400">
                Import terminé{importResult.year_filter ? ` (${importResult.year_filter})` : ' (toutes années)'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-y-1 gap-x-3 text-text-muted">
              <span>Fichiers lus</span><span className="text-text font-medium tabular-nums">{importResult.files_read}</span>
              <span>Ops scannées</span><span className="text-text font-medium tabular-nums">{importResult.ops_scanned}</span>
              <span>Ops ignorées</span><span className="text-text font-medium tabular-nums">{importResult.ops_skipped}</span>
              <span>Sous-lignes ventil.</span><span className="text-text font-medium tabular-nums">{importResult.vent_sublines}</span>
              <span>Exemples soumis</span><span className="text-text font-medium tabular-nums">{importResult.examples_submitted}</span>
              <span>Nouveaux (dédup)</span><span className="text-emerald-400 font-semibold tabular-nums">+{importResult.examples_added}</span>
              <span>Règles mises à jour</span><span className="text-text font-medium tabular-nums">{importResult.rules_updated}</span>
              <span>Total corpus</span><span className="text-text font-bold tabular-nums">{importResult.total_training_data}</span>
            </div>
          </div>
        )}

        {importMutation.isError && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <XCircle size={12} /> {importMutation.error.message}
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
