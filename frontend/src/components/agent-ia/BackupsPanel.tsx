import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useMLBackups, useTrainingData } from '@/hooks/useApi'
import { History, RotateCcw, Loader2, CheckCircle, XCircle, Database, FolderArchive } from 'lucide-react'

export default function BackupsPanel() {
  const queryClient = useQueryClient()
  const { data: backupsData, isLoading: backupsLoading } = useMLBackups()
  const { data: trainingData } = useTrainingData()
  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null)
  const [restoreMsg, setRestoreMsg] = useState('')

  const restoreMutation = useMutation({
    mutationFn: (backupName: string) =>
      api.post<{ message: string }>(`/ml/restore/${encodeURIComponent(backupName)}`),
    onSuccess: (data) => {
      setRestoreMsg(data.message || 'Restauration réussie')
      setRestoreConfirm(null)
      // Invalidate all ML queries
      queryClient.invalidateQueries({ queryKey: ['ml-model'] })
      queryClient.invalidateQueries({ queryKey: ['ml-model-full'] })
      queryClient.invalidateQueries({ queryKey: ['ml-training-data'] })
      queryClient.invalidateQueries({ queryKey: ['ml-backups'] })
      setTimeout(() => setRestoreMsg(''), 5000)
    },
    onError: () => setRestoreConfirm(null),
  })

  const backups = backupsData?.backups || []

  // Extract date from backup name: model_backup_20250507_134341_manuel → 2025-05-07 13:43
  const formatBackupName = (name: string): string => {
    const match = name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
    if (match) {
      const [, y, m, d, h, min] = match
      return `${d}/${m}/${y} à ${h}:${min}`
    }
    return name
  }

  // Count unique categories in training data
  const uniqueCategories = trainingData
    ? new Set(trainingData.examples.map((e) => e.categorie)).size
    : 0

  return (
    <div className="bg-surface rounded-xl border border-border p-5 flex flex-col">
      <h3 className="text-sm font-semibold text-text flex items-center gap-2 mb-4">
        <History size={16} className="text-primary" />
        Historique & Backups
      </h3>

      {/* Training Data Stats */}
      <div className="bg-background rounded-lg p-3 mb-4 border border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <Database size={14} className="text-primary" />
          <span className="text-xs font-medium text-text">Données d'entraînement</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-text-muted">Exemples</span>
            <p className="text-text font-semibold text-lg">{trainingData?.count || 0}</p>
          </div>
          <div>
            <span className="text-text-muted">Catégories</span>
            <p className="text-text font-semibold text-lg">{uniqueCategories}</p>
          </div>
        </div>
      </div>

      {/* Success message */}
      {restoreMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 mb-3 flex items-center gap-2">
          <CheckCircle size={14} className="text-emerald-400" />
          <span className="text-xs text-emerald-400">{restoreMsg}</span>
        </div>
      )}

      {restoreMutation.isError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 mb-3 flex items-center gap-2">
          <XCircle size={14} className="text-red-400" />
          <span className="text-xs text-red-400">{restoreMutation.error.message}</span>
        </div>
      )}

      {/* Backups list */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Sauvegardes</span>
        <span className="text-[10px] text-text-muted/60">{backups.length} backup(s)</span>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[280px] space-y-1.5 pr-1 scrollbar-thin">
        {backupsLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="animate-spin text-text-muted" />
          </div>
        ) : backups.length === 0 ? (
          <p className="text-xs text-text-muted/60 text-center py-4">
            Aucun backup disponible
          </p>
        ) : (
          backups.map((backup) => (
            <div
              key={backup}
              className="flex items-center gap-2 py-2 px-3 rounded-lg bg-background border border-border/50 hover:border-border"
            >
              <FolderArchive size={14} className="text-text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text font-medium truncate">
                  {formatBackupName(backup)}
                </p>
                <p className="text-[10px] text-text-muted/50 truncate">{backup}</p>
              </div>

              {restoreConfirm === backup ? (
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => restoreMutation.mutate(backup)}
                    disabled={restoreMutation.isPending}
                    className="bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded text-[10px] font-medium hover:bg-amber-500/30"
                  >
                    {restoreMutation.isPending ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      'Confirmer'
                    )}
                  </button>
                  <button
                    onClick={() => setRestoreConfirm(null)}
                    className="text-text-muted text-[10px] hover:text-text"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setRestoreConfirm(backup)}
                  className="text-text-muted hover:text-primary text-xs flex items-center gap-1 shrink-0"
                >
                  <RotateCcw size={12} />
                  <span className="text-[10px]">Restaurer</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
