import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { AlerteSummary, AlerteType, Operation } from '@/types'

export function useAlertesSummary() {
  return useQuery<AlerteSummary>({
    queryKey: ['alertes-summary'],
    queryFn: () => api.get('/alertes/summary'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useAlertesFichier(filename: string | null) {
  return useQuery<Operation[]>({
    queryKey: ['alertes', filename],
    queryFn: () => api.get(`/alertes/${filename}`),
    enabled: !!filename,
  })
}

export function useResolveAlerte() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      filename,
      index,
      alerte_type,
      note,
    }: {
      filename: string
      index: number
      alerte_type: AlerteType
      note?: string
    }) => api.post(`/alertes/${filename}/${index}/resolve`, { alerte_type, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertes'] })
      queryClient.invalidateQueries({ queryKey: ['alertes-summary'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
    },
  })
}

export function useRefreshAlertes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ filename }: { filename: string }) =>
      api.post<{ nb_alertes: number; nb_operations: number }>(`/alertes/${filename}/refresh`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertes'] })
      queryClient.invalidateQueries({ queryKey: ['alertes-summary'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
    },
  })
}
