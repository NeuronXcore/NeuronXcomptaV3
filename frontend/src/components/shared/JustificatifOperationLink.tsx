import { useNavigate } from 'react-router-dom'
import { ExternalLink, Search, Loader2, Edit3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils'
import { useReverseLookup, useJustificatifOperationSuggestions } from '@/hooks/useJustificatifs'
import { useManualAssociate } from '@/hooks/useRapprochement'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { OperationSuggestion } from '@/types'

interface JustificatifOperationLinkProps {
  justificatifFilename: string
  isAssociated: boolean
  /** Afficher aussi un bouton vers /editor (en plus de /justificatifs). Utile dans le drawer GED. */
  showEditorLink?: boolean
  className?: string
}

export default function JustificatifOperationLink({
  justificatifFilename,
  isAssociated,
  showEditorLink = false,
  className,
}: JustificatifOperationLinkProps) {
  const navigate = useNavigate()
  const { data: reverseResults, isLoading: reverseLoading } = useReverseLookup(justificatifFilename)

  // Si le reverse-lookup trouve un lien → afficher "Voir l'opération"
  if (reverseResults && reverseResults.length > 0) {
    const result = reverseResults[0]
    const montant = result.debit || result.credit || 0
    const vlParam = result.ventilation_index !== null ? `&vl=${result.ventilation_index}` : ''
    return (
      <div className={cn('space-y-1.5', className)}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() =>
              navigate(
                `/justificatifs?file=${encodeURIComponent(result.operation_file)}&highlight=${result.operation_index}${vlParam}&filter=avec`
              )
            }
            className="inline-flex items-center gap-1.5 bg-warning text-background hover:bg-warning/90 font-medium text-sm px-3 py-1.5 rounded-md transition-colors shadow-sm"
          >
            <ExternalLink size={14} />
            Voir l'opération
          </button>
          {showEditorLink && (
            <button
              onClick={() =>
                navigate(
                  `/editor?file=${encodeURIComponent(result.operation_file)}&highlight=${result.operation_index}`
                )
              }
              className="inline-flex items-center gap-1.5 bg-surface border border-border hover:border-primary/50 text-text font-medium text-sm px-3 py-1.5 rounded-md transition-colors"
              title="Ouvrir la ligne dans l'Éditeur"
            >
              <Edit3 size={14} />
              Ouvrir dans l'Éditeur
            </button>
          )}
        </div>
        <div className="text-xs text-text-muted">
          {result.date} — {result.libelle?.slice(0, 40)}{result.libelle?.length > 40 ? '...' : ''} — {formatCurrency(montant)}
        </div>
      </div>
    )
  }

  // Sinon (en attente OU traité sans lien trouvé) → afficher les suggestions
  if (reverseLoading) return null
  return <PendingView justificatifFilename={justificatifFilename} className={className} />
}

function PendingView({ justificatifFilename, className }: { justificatifFilename: string; className?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: suggestions, isLoading } = useJustificatifOperationSuggestions(justificatifFilename)
  const associateMutation = useManualAssociate()

  const getScoreValue = (score: unknown): number => {
    if (typeof score === 'number') return score
    if (score && typeof score === 'object' && 'total' in score) return (score as { total: number }).total
    return 0
  }

  const handleAssociate = (s: OperationSuggestion) => {
    associateMutation.mutate(
      {
        justificatif_filename: justificatifFilename,
        operation_file: s.operation_file,
        operation_index: s.operation_index,
        // Le backend retourne `score` comme un objet MatchScore → on extrait le total
        rapprochement_score: getScoreValue(s.score),
        // Forward ventilation_index pour les sous-lignes ventilées
        ventilation_index: s.ventilation_index ?? undefined,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['justificatif-reverse-lookup'] })
          queryClient.invalidateQueries({ queryKey: ['justificatif-operation-suggestions'] })
          toast.success('Justificatif associé')
        },
        onError: (err: Error) => {
          toast.error(err.message || "Erreur lors de l'association")
        },
      }
    )
  }

  const scoreBadgeClass = (score: number) => {
    const pct = score * 100
    if (pct >= 80) return 'text-xs font-medium px-1.5 py-0.5 rounded bg-success/10 text-success'
    if (pct >= 60) return 'text-xs font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning'
    return 'text-xs font-medium px-1.5 py-0.5 rounded bg-surface text-text-muted'
  }

  return (
    <div className={cn('space-y-2', className)}>
      <span className="text-xs font-medium text-text-muted">Opérations correspondantes</span>

      {isLoading && (
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <Loader2 size={12} className="animate-spin" />
          Recherche...
        </div>
      )}

      {!isLoading && suggestions && suggestions.length > 0 && (
        <div className="space-y-1.5">
          {suggestions.slice(0, 3).map((s: any, i: number) => {
            const score = getScoreValue(s.score)
            const libelle = s.libelle || s.operation_libelle || ''
            const date = s.date || s.operation_date || ''
            const montant = s.debit || s.credit || s.operation_montant || 0
            const categorie = s.categorie || ''
            return (
              <div key={`${s.operation_file}-${s.operation_index}-${i}`} className="flex items-center gap-2 bg-surface rounded-md p-2">
                <span className={scoreBadgeClass(score)}>{Math.round(score * 100)}%</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{libelle}</div>
                  <div className="text-xs text-text-muted">
                    {date} · {formatCurrency(montant)} · {categorie || '—'}
                  </div>
                </div>
                <button
                  onClick={() => handleAssociate(s)}
                  disabled={associateMutation.isPending}
                  className="bg-warning text-background text-xs font-medium px-2.5 py-1 rounded-md hover:scale-105 transition-transform disabled:opacity-50"
                >
                  Associer
                </button>
              </div>
            )
          })}
        </div>
      )}

      {!isLoading && (!suggestions || suggestions.length === 0) && (
        <div className="text-xs text-text-muted">Aucune suggestion trouvée</div>
      )}

      <button
        onClick={() => {
          // Extraire année/mois du filename canonique si possible pour pré-filtrer
          const match = justificatifFilename.match(/_(\d{4})(\d{2})\d{2}_/)
          const params = new URLSearchParams({ filter: 'sans' })
          if (match) {
            params.set('year', match[1])
            params.set('month', String(parseInt(match[2], 10)))
          }
          navigate(`/justificatifs?${params.toString()}`)
        }}
        className="inline-flex items-center gap-1 text-xs text-text-muted hover:bg-surface border border-border/50 px-2 py-1 rounded-md transition-colors"
      >
        <Search size={12} />
        Rechercher manuellement
      </button>
    </div>
  )
}
