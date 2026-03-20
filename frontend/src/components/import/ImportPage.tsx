import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, FileText, Check, AlertCircle, Loader2,
  ArrowRight, Bot, Eye, EyeOff, RefreshCw, Trash2,
  FileUp, Calendar, TrendingDown, TrendingUp,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { api } from '@/api/client'
import { formatCurrency, cn } from '@/lib/utils'
import type { Operation } from '@/types'

interface ImportResult {
  filename: string
  operations_count: number
  pdf_hash: string
  operations: Operation[]
}

export default function ImportPage() {
  const [result, setResult] = useState<ImportResult | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const [importHistory, setImportHistory] = useState<ImportResult[]>([])
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const importMutation = useMutation({
    mutationFn: (file: File) => api.upload<ImportResult>('/operations/import', file),
    onSuccess: (data) => {
      setResult(data)
      setImportHistory(prev => [data, ...prev])
      queryClient.invalidateQueries({ queryKey: ['operation-files'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (file) {
      setResult(null)
      importMutation.mutate(file)
    }
  }, [importMutation])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: importMutation.isPending,
  })

  // Calculate stats for imported operations
  const importStats = result ? {
    totalDebit: result.operations.reduce((s, op) => s + (op['Débit'] || 0), 0),
    totalCredit: result.operations.reduce((s, op) => s + (op['Crédit'] || 0), 0),
    categorized: result.operations.filter(op => op['Catégorie'] && op['Catégorie'] !== 'Autres').length,
    dateRange: (() => {
      const dates = result.operations.map(op => op.Date).filter(Boolean).sort()
      return dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null
    })(),
  } : null

  const handleNewImport = () => {
    setResult(null)
    importMutation.reset()
  }

  const goToEditor = () => {
    if (result) {
      navigate('/editor')
    }
  }

  return (
    <div>
      <PageHeader
        title="Importation"
        description="Importez un relevé bancaire PDF pour extraire les opérations automatiquement"
        actions={
          result ? (
            <div className="flex gap-2">
              <button
                onClick={handleNewImport}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover transition-colors"
              >
                <RefreshCw size={16} />
                Nouveau PDF
              </button>
              <button
                onClick={goToEditor}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
              >
                Éditer
                <ArrowRight size={16} />
              </button>
            </div>
          ) : undefined
        }
      />

      {/* Dropzone */}
      {!result && (
        <div
          {...getRootProps()}
          className={cn(
            'border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all duration-300',
            isDragActive
              ? 'border-primary bg-primary/5 scale-[1.02] shadow-lg shadow-primary/10'
              : 'border-border hover:border-primary/50 hover:bg-surface/50',
            importMutation.isPending ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''
          )}
        >
          <input {...getInputProps()} />
          {importMutation.isPending ? (
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <Loader2 size={56} className="text-primary animate-spin" />
                <FileText size={24} className="absolute inset-0 m-auto text-primary/50" />
              </div>
              <div>
                <p className="text-lg font-medium text-text">Extraction en cours...</p>
                <p className="text-sm text-text-muted mt-1">Analyse du PDF et extraction des opérations bancaires</p>
              </div>
            </div>
          ) : isDragActive ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload size={36} className="text-primary" />
              </div>
              <p className="text-xl font-medium text-primary">Déposez le PDF ici</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-surface flex items-center justify-center">
                <FileUp size={36} className="text-text-muted" />
              </div>
              <div>
                <p className="text-lg font-medium text-text">
                  Glissez-déposez un relevé bancaire PDF ici
                </p>
                <p className="text-sm text-text-muted mt-2">
                  ou cliquez pour sélectionner un fichier
                </p>
              </div>
              <div className="flex gap-6 mt-4 text-xs text-text-muted">
                <span className="flex items-center gap-1.5">
                  <FileText size={14} />
                  Format PDF uniquement
                </span>
                <span className="flex items-center gap-1.5">
                  <Bot size={14} />
                  Catégorisation automatique IA
                </span>
                <span className="flex items-center gap-1.5">
                  <Check size={14} />
                  Détection des doublons
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {importMutation.isError && (
        <div className="mt-6 bg-danger/10 border border-danger/30 rounded-xl p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-danger/20 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={20} className="text-danger" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-danger">Erreur d'importation</p>
            <p className="text-sm text-text-muted mt-1">{importMutation.error.message}</p>
            <button
              onClick={handleNewImport}
              className="mt-3 text-sm text-primary hover:underline"
            >
              Réessayer avec un autre fichier
            </button>
          </div>
        </div>
      )}

      {/* Success + Stats + Preview */}
      {result && importStats && (
        <div className="space-y-4">
          {/* Success banner */}
          <div className="bg-success/10 border border-success/30 rounded-xl p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
              <Check size={20} className="text-success" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-success">Importation réussie</p>
              <p className="text-sm text-text-muted mt-1">
                {result.operations_count} opérations extraites et sauvegardées dans{' '}
                <code className="bg-surface px-2 py-0.5 rounded text-xs font-mono">{result.filename}</code>
              </p>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 text-text-muted mb-2">
                <FileText size={16} />
                <span className="text-xs font-medium uppercase tracking-wider">Opérations</span>
              </div>
              <p className="text-2xl font-bold text-text">{result.operations_count}</p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 text-text-muted mb-2">
                <TrendingDown size={16} className="text-danger" />
                <span className="text-xs font-medium uppercase tracking-wider">Total débits</span>
              </div>
              <p className="text-2xl font-bold text-danger">{formatCurrency(importStats.totalDebit)}</p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 text-text-muted mb-2">
                <TrendingUp size={16} className="text-success" />
                <span className="text-xs font-medium uppercase tracking-wider">Total crédits</span>
              </div>
              <p className="text-2xl font-bold text-success">{formatCurrency(importStats.totalCredit)}</p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 text-text-muted mb-2">
                <Calendar size={16} />
                <span className="text-xs font-medium uppercase tracking-wider">Période</span>
              </div>
              {importStats.dateRange ? (
                <p className="text-sm font-medium text-text">
                  {importStats.dateRange.from} → {importStats.dateRange.to}
                </p>
              ) : (
                <p className="text-sm text-text-muted">—</p>
              )}
            </div>
          </div>

          {/* Categorization stats */}
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-text">Catégorisation automatique</span>
              <span className="text-xs text-text-muted">
                {importStats.categorized} / {result.operations_count} catégorisées
              </span>
            </div>
            <div className="w-full bg-background rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all duration-500"
                style={{ width: `${(importStats.categorized / result.operations_count) * 100}%` }}
              />
            </div>
            {importStats.categorized < result.operations_count && (
              <p className="text-xs text-text-muted mt-2">
                {result.operations_count - importStats.categorized} opérations pourront etre catégorisées dans l'éditeur avec l'IA
              </p>
            )}
          </div>

          {/* Preview table */}
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                Apercu des opérations extraites
                <span className="text-xs text-text-muted font-normal">({result.operations_count})</span>
              </h2>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors"
              >
                {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
                {showPreview ? 'Masquer' : 'Afficher'}
              </button>
            </div>

            {showPreview && (
              <div className="overflow-x-auto max-h-[450px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface shadow-sm">
                    <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wider">
                      <th className="text-left py-3 px-3 w-8">#</th>
                      <th className="text-left py-3 px-3">Date</th>
                      <th className="text-left py-3 px-3">Libellé</th>
                      <th className="text-right py-3 px-3">Débit</th>
                      <th className="text-right py-3 px-3">Crédit</th>
                      <th className="text-left py-3 px-3">Catégorie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.operations.map((op, i) => (
                      <tr key={i} className="border-b border-border/20 hover:bg-surface-hover transition-colors">
                        <td className="py-2 px-3 text-text-muted text-xs">{i + 1}</td>
                        <td className="py-2 px-3 text-text-muted whitespace-nowrap text-xs font-mono">
                          {op.Date}
                        </td>
                        <td className="py-2 px-3 max-w-[350px]">
                          <span className="block truncate" title={op['Libellé']}>
                            {op['Libellé']}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {op['Débit'] > 0 ? (
                            <span className="text-danger">{formatCurrency(op['Débit'])}</span>
                          ) : (
                            <span className="text-text-muted/30">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {op['Crédit'] > 0 ? (
                            <span className="text-success">{formatCurrency(op['Crédit'])}</span>
                          ) : (
                            <span className="text-text-muted/30">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {op['Catégorie'] && op['Catégorie'] !== 'Autres' ? (
                            <span className="inline-flex items-center px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full font-medium">
                              {op['Catégorie']}
                            </span>
                          ) : (
                            <span className="text-text-muted/50 text-xs italic">Non catégorisée</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Table footer */}
            <div className="border-t border-border px-5 py-3 flex justify-between items-center text-xs text-text-muted bg-surface">
              <span>{result.operations_count} opérations</span>
              <div className="flex gap-4 font-mono">
                <span>Débits: <span className="text-danger">{formatCurrency(importStats.totalDebit)}</span></span>
                <span>Crédits: <span className="text-success">{formatCurrency(importStats.totalCredit)}</span></span>
                <span>
                  Solde:{' '}
                  <span className={importStats.totalCredit - importStats.totalDebit >= 0 ? 'text-success' : 'text-danger'}>
                    {formatCurrency(importStats.totalCredit - importStats.totalDebit)}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex justify-center gap-3 pt-2">
            <button
              onClick={handleNewImport}
              className="flex items-center gap-2 px-5 py-2.5 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover transition-colors"
            >
              <Upload size={16} />
              Importer un autre PDF
            </button>
            <button
              onClick={goToEditor}
              className="flex items-center gap-2 px-6 py-2.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors shadow-lg shadow-primary/25"
            >
              Éditer les opérations
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Import history (when multiple imports in same session) */}
      {importHistory.length > 1 && (
        <div className="mt-8">
          <h3 className="text-sm font-medium text-text-muted mb-3">Historique de cette session</h3>
          <div className="space-y-2">
            {importHistory.slice(1).map((item, i) => (
              <div key={i} className="bg-surface rounded-lg border border-border/50 p-3 flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <FileText size={16} className="text-text-muted" />
                  <span className="font-mono text-xs">{item.filename}</span>
                  <span className="text-text-muted">({item.operations_count} ops)</span>
                </div>
                <Check size={14} className="text-success" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
