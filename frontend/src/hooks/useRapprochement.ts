import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/api/client'
import type {
  RapprochementSuggestion,
  AutoRapprochementReport,
  UnmatchedSummary,
  AutoLogEntry,
} from '@/types'

export function useOperationSuggestions(file: string | null, index: number | null) {
  return useQuery<RapprochementSuggestion[]>({
    queryKey: ['rapprochement-op-suggestions', file, index],
    queryFn: () => api.get(`/rapprochement/suggestions/operation/${file}/${index}`),
    enabled: !!file && index !== null && index >= 0,
  })
}

export function useJustificatifSuggestions(filename: string | null) {
  return useQuery<RapprochementSuggestion[]>({
    queryKey: ['rapprochement-just-suggestions', filename],
    queryFn: () => api.get(`/rapprochement/suggestions/justificatif/${filename}`),
    enabled: !!filename,
  })
}

export function useUnmatched() {
  return useQuery<UnmatchedSummary>({
    queryKey: ['rapprochement-unmatched'],
    queryFn: () => api.get('/rapprochement/unmatched'),
    refetchInterval: 60000,
  })
}

export function useBatchHints(filename: string | null) {
  return useQuery<Record<string, number>>({
    queryKey: ['rapprochement-batch-hints', filename],
    queryFn: () => api.get(`/rapprochement/batch-hints/${filename}`),
    enabled: !!filename,
    // Les hints coûtent 1-2s backend (scoring N_ops × N_pending_ocr). On les considère
    // stables pendant 2 min pour éviter le refetch systématique au changement de mois.
    // placeholderData conserve les anciens hints pendant qu'on fetch les nouveaux
    // → pas de flash ni de re-render complet du TanStack Table via dep array columns.
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useBatchJustificatifScores() {
  return useQuery<Record<string, number>>({
    queryKey: ['rapprochement-batch-just-scores'],
    queryFn: () => api.get('/rapprochement/batch-justificatif-scores'),
  })
}

export interface AutoRapprochementScope {
  year?: number
  month?: number
}

export function useRunAutoRapprochement() {
  const queryClient = useQueryClient()
  return useMutation<AutoRapprochementReport, Error, AutoRapprochementScope | undefined>({
    mutationFn: (scope?: AutoRapprochementScope) => {
      // Construire query string si scope fourni — `month` requiert `year` côté backend.
      const params = new URLSearchParams()
      if (scope?.year != null) params.set('year', String(scope.year))
      if (scope?.month != null) params.set('month', String(scope.month))
      const qs = params.toString()
      return api.post(`/rapprochement/run-auto${qs ? `?${qs}` : ''}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-unmatched'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-batch-hints'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-batch-just-scores'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useAutoLog() {
  return useQuery<AutoLogEntry[]>({
    queryKey: ['rapprochement-auto-log'],
    queryFn: () => api.get('/rapprochement/log'),
  })
}

export function useManualAssociate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      justificatif_filename: string
      operation_file: string
      operation_index: number
      rapprochement_score?: number
      ventilation_index?: number | null
      force?: boolean
    }) => api.post('/rapprochement/associate-manual', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-unmatched'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-batch-hints'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-batch-just-scores'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-op-suggestions'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-just-suggestions'] })
    },
  })
}
