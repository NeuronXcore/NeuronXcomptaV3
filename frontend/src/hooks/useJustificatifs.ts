import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type {
  JustificatifInfo,
  JustificatifStats,
  JustificatifUploadResult,
  OperationSuggestion,
  ReverseLookupResult,
} from '@/types'

interface JustificatifFilters {
  status: string
  search: string
  year?: number | null
  month?: number | null
  sort_by: string
  sort_order: string
}

export function useJustificatifs(filters: JustificatifFilters) {
  const params = new URLSearchParams()
  params.set('status', filters.status)
  if (filters.search) params.set('search', filters.search)
  if (filters.year) params.set('year', String(filters.year))
  if (filters.month) params.set('month', String(filters.month))
  params.set('sort_by', filters.sort_by)
  params.set('sort_order', filters.sort_order)

  return useQuery<JustificatifInfo[]>({
    queryKey: ['justificatifs', filters],
    queryFn: () => api.get(`/justificatifs/?${params.toString()}`),
  })
}

export function useJustificatifStats() {
  return useQuery<JustificatifStats>({
    queryKey: ['justificatif-stats'],
    queryFn: () => api.get('/justificatifs/stats'),
  })
}

export function useUploadJustificatifs() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (files: File[]) =>
      api.uploadMultiple<JustificatifUploadResult[]>('/justificatifs/upload', files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
    },
  })
}

export function useDeleteJustificatif() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (filename: string) => api.delete(`/justificatifs/${filename}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
    },
  })
}

export function useAssociate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { justificatif_filename: string; operation_file: string; operation_index: number }) =>
      api.post('/justificatifs/associate', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-suggestions'] })
    },
  })
}

export function useDissociate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { operation_file: string; operation_index: number }) =>
      api.post('/justificatifs/dissociate', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
    },
  })
}

export function useSuggestions(filename: string | null) {
  return useQuery<OperationSuggestion[]>({
    queryKey: ['justificatif-suggestions', filename],
    queryFn: () => api.get(`/justificatifs/${filename}/suggestions`),
    enabled: !!filename,
  })
}

export function useReverseLookup(justificatifFilename: string | null) {
  return useQuery<ReverseLookupResult[]>({
    queryKey: ['justificatif-reverse-lookup', justificatifFilename],
    queryFn: () => api.get(`/justificatifs/reverse-lookup/${justificatifFilename}`),
    enabled: !!justificatifFilename,
  })
}

export function useJustificatifOperationSuggestions(justificatifFilename: string | null) {
  return useQuery<OperationSuggestion[]>({
    queryKey: ['justificatif-operation-suggestions', justificatifFilename],
    queryFn: () => api.get(`/rapprochement/suggestions/justificatif/${justificatifFilename}`),
    enabled: !!justificatifFilename,
  })
}
