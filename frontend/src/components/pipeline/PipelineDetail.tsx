import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FileUp, Sparkles, FileSearch, Link, CheckSquare, Lock, PackageCheck, ExternalLink } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { useCategorizeOperations } from '@/hooks/useOperations'
import { useRunAutoRapprochement } from '@/hooks/useRapprochement'
import { useBulkLettrage } from '@/hooks/useLettrage'
import { useGenerateExport } from '@/hooks/useExports'
import type { PipelineData, PipelineStepData } from '@/hooks/usePipeline'

interface PipelineDetailProps {
  stepIndex: number
  step: PipelineStepData
  pipeline: PipelineData
  onClose: () => void
}

export default function PipelineDetail({ stepIndex, step, pipeline, onClose }: PipelineDetailProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const categorize = useCategorizeOperations()
  const autoRapprochement = useRunAutoRapprochement()
  const bulkLettrage = useBulkLettrage()
  const generateExport = useGenerateExport()

  const goTo = (path: string) => {
    onClose()
    navigate(path)
  }

  const invalidatePipeline = () => {
    queryClient.invalidateQueries({ queryKey: ['cloture'] })
    queryClient.invalidateQueries({ queryKey: ['operations', pipeline.filename] })
    queryClient.invalidateQueries({ queryKey: ['lettrage-stats', pipeline.filename] })
  }

  // Step 0: Relevé importé
  if (stepIndex === 0) {
    if (pipeline.monthStatus?.has_releve) {
      return (
        <div className="space-y-3">
          <div className="bg-success/10 border border-success/20 rounded-lg p-4">
            <p className="text-sm text-success font-medium">Relevé importé</p>
            <p className="text-xs text-text-muted mt-1">
              {pipeline.monthStatus.nb_operations} opérations extraites
            </p>
          </div>
        </div>
      )
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-muted">Aucun relevé importé pour ce mois.</p>
        <button
          onClick={() => goTo('/import')}
          className="flex items-center gap-2 w-full px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
        >
          <FileUp className="w-4 h-4" />
          Importer un relevé
        </button>
      </div>
    )
  }

  // Step 1: Vérification
  if (stepIndex === 1) {
    return (
      <div className="space-y-3">
        <div className={cn(
          'border rounded-lg p-4',
          pipeline.monthStatus?.has_releve
            ? 'bg-success/10 border-success/20'
            : 'bg-surface border-border'
        )}>
          <p className="text-sm font-medium text-text">
            {pipeline.monthStatus?.has_releve ? 'Données vérifiées automatiquement' : 'En attente du relevé'}
          </p>
          <p className="text-xs text-text-muted mt-1">
            Cette étape est informative. Les données extraites du PDF sont validées automatiquement lors de l'import.
          </p>
        </div>
      </div>
    )
  }

  // Step 2: Catégorisation
  if (stepIndex === 2) {
    const ops = pipeline.uncategorized
    return (
      <div className="space-y-3">
        {ops.length === 0 ? (
          <div className="bg-success/10 border border-success/20 rounded-lg p-4">
            <p className="text-sm text-success font-medium">Toutes les opérations sont catégorisées</p>
          </div>
        ) : (
          <>
            <div className="max-h-60 overflow-y-auto space-y-1 border border-border rounded-lg">
              {ops.slice(0, 50).map((op) => (
                <div key={op._index} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0">
                  <span className="text-xs text-text truncate max-w-[200px]">{op['Libellé']}</span>
                  <span className="text-xs font-medium text-text-muted tabular-nums shrink-0 ml-2">
                    {op['Débit'] ? `-${formatCurrency(op['Débit'])}` : `+${formatCurrency(op['Crédit'])}`}
                  </span>
                </div>
              ))}
              {ops.length > 50 && (
                <p className="text-xs text-text-muted px-3 py-2">
                  ... et {ops.length - 50} autres
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!pipeline.filename) return
                  categorize.mutate(
                    { filename: pipeline.filename, mode: 'auto' },
                    {
                      onSuccess: (result) => {
                        toast.success(`${result.modified} opérations catégorisées`)
                        invalidatePipeline()
                      },
                      onError: () => toast.error('Erreur de catégorisation'),
                    }
                  )
                }}
                disabled={categorize.isPending || !pipeline.filename}
                className="flex items-center gap-2 flex-1 justify-center px-3 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {categorize.isPending ? 'En cours...' : 'IA auto-catégoriser'}
              </button>
              <button
                onClick={() => goTo('/editor')}
                className="flex items-center gap-2 flex-1 justify-center px-3 py-2.5 border border-border text-text rounded-lg text-sm font-medium hover:bg-surface-hover transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Éditeur
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // Step 3: Justificatifs
  if (stepIndex === 3) {
    const ops = pipeline.unmatched
    return (
      <div className="space-y-3">
        {ops.length === 0 ? (
          <div className="bg-success/10 border border-success/20 rounded-lg p-4">
            <p className="text-sm text-success font-medium">Tous les justificatifs sont associés</p>
          </div>
        ) : (
          <>
            <div className="max-h-60 overflow-y-auto space-y-1 border border-border rounded-lg">
              {ops.slice(0, 50).map((op) => (
                <div key={op._index} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0">
                  <span className="text-xs text-text truncate max-w-[200px]">{op['Libellé']}</span>
                  <span className="text-xs font-medium text-text-muted tabular-nums shrink-0 ml-2">
                    {op['Débit'] ? `-${formatCurrency(op['Débit'])}` : `+${formatCurrency(op['Crédit'])}`}
                  </span>
                </div>
              ))}
              {ops.length > 50 && (
                <p className="text-xs text-text-muted px-3 py-2">
                  ... et {ops.length - 50} autres
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  autoRapprochement.mutate(undefined, {
                    onSuccess: (report) => {
                      toast.success(`${report.associations_auto} associations automatiques`)
                      invalidatePipeline()
                    },
                    onError: () => toast.error('Erreur de rapprochement'),
                  })
                }}
                disabled={autoRapprochement.isPending}
                className="flex items-center gap-2 flex-1 justify-center px-3 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                <Link className="w-4 h-4" />
                {autoRapprochement.isPending ? 'En cours...' : 'Rapprochement auto'}
              </button>
              <button
                onClick={() => goTo('/justificatifs')}
                className="flex items-center gap-2 flex-1 justify-center px-3 py-2.5 border border-border text-text rounded-lg text-sm font-medium hover:bg-surface-hover transition-colors"
              >
                <FileSearch className="w-4 h-4" />
                Justificatifs
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // Step 4: Lettrage
  if (stepIndex === 4) {
    const ops = pipeline.unlettered
    // Operations eligible for bulk lettrage: categorized AND justified but not yet lettered
    const eligibleForBulk = ops.filter((op) => !!op['Catégorie'] && !!op.Justificatif)

    return (
      <div className="space-y-3">
        {ops.length === 0 ? (
          <div className="bg-success/10 border border-success/20 rounded-lg p-4">
            <p className="text-sm text-success font-medium">Toutes les opérations sont lettrées</p>
          </div>
        ) : (
          <>
            <div className="bg-surface border border-border rounded-lg p-4">
              <p className="text-sm text-text">
                <span className="font-semibold">{ops.length}</span> opération{ops.length > 1 ? 's' : ''} non lettrée{ops.length > 1 ? 's' : ''}
              </p>
              {eligibleForBulk.length > 0 && (
                <p className="text-xs text-text-muted mt-1">
                  {eligibleForBulk.length} complète{eligibleForBulk.length > 1 ? 's' : ''} (catégorisée{eligibleForBulk.length > 1 ? 's' : ''} + justifiée{eligibleForBulk.length > 1 ? 's' : ''})
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {eligibleForBulk.length > 0 && (
                <button
                  onClick={() => {
                    if (!pipeline.filename) return
                    const indices = eligibleForBulk.map((op) => op._index!)
                    bulkLettrage.mutate(
                      { filename: pipeline.filename, indices, lettre: true },
                      {
                        onSuccess: (result) => {
                          toast.success(`${result.modified} opérations lettrées`)
                          invalidatePipeline()
                        },
                        onError: () => toast.error('Erreur de lettrage'),
                      }
                    )
                  }}
                  disabled={bulkLettrage.isPending || !pipeline.filename}
                  className="flex items-center gap-2 flex-1 justify-center px-3 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
                >
                  <CheckSquare className="w-4 h-4" />
                  {bulkLettrage.isPending ? 'En cours...' : `Lettrer ${eligibleForBulk.length} complètes`}
                </button>
              )}
              <button
                onClick={() => goTo('/editor')}
                className="flex items-center gap-2 flex-1 justify-center px-3 py-2.5 border border-border text-text rounded-lg text-sm font-medium hover:bg-surface-hover transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Éditeur
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // Step 5: Clôture
  if (stepIndex === 5) {
    const catOk = pipeline.steps[2]?.percent >= 100
    const justOk = pipeline.steps[3]?.percent >= 100
    const letOk = pipeline.steps[4]?.percent >= 100
    const allOk = catOk && justOk && letOk

    const deps = [
      { label: 'Catégorisation', ok: catOk },
      { label: 'Justificatifs', ok: justOk },
      { label: 'Lettrage', ok: letOk },
    ]

    return (
      <div className="space-y-3">
        {!allOk ? (
          <>
            <div className="bg-surface border border-border rounded-lg p-4">
              <p className="text-sm text-text font-medium flex items-center gap-2">
                <Lock className="w-4 h-4 text-warning" />
                Prérequis non remplis
              </p>
              <div className="mt-3 space-y-2">
                {deps.map((dep) => (
                  <div key={dep.label} className="flex items-center gap-2">
                    <div className={cn('w-2 h-2 rounded-full', dep.ok ? 'bg-success' : 'bg-danger')} />
                    <span className={cn('text-xs', dep.ok ? 'text-success' : 'text-text-muted')}>
                      {dep.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-success/10 border border-success/20 rounded-lg p-4">
              <p className="text-sm text-success font-medium">Tous les prérequis sont remplis</p>
            </div>
            <button
              onClick={() => {
                generateExport.mutate(
                  {
                    year: pipeline.year,
                    month: pipeline.month,
                    include_csv: true,
                    include_pdf: true,
                    include_excel: true,
                    include_bank_statement: true,
                    include_justificatifs: true,
                    include_reports: true,
                  },
                  {
                    onSuccess: () => {
                      toast.success('Export ZIP généré avec succès')
                      invalidatePipeline()
                    },
                    onError: () => toast.error("Erreur lors de la génération de l'export"),
                  }
                )
              }}
              disabled={generateExport.isPending}
              className="flex items-center gap-2 w-full justify-center px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              <PackageCheck className="w-4 h-4" />
              {generateExport.isPending ? 'Génération...' : 'Générer l\'export ZIP'}
            </button>
          </>
        )}
      </div>
    )
  }

  return null
}
