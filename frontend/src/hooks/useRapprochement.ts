import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  })
}

export function useBatchJustificatifScores() {
  return useQuery<Record<string, number>>({
    queryKey: ['rapprochement-batch-just-scores'],
    queryFn: () => api.get('/rapprochement/batch-justificatif-scores'),
  })
}

export function useRunAutoRapprochement() {
  const queryClient = useQueryClient()
  return useMutation<AutoRapprochementReport>({
    mutationFn: () => api.post('/rapprochement/run-auto'),
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
