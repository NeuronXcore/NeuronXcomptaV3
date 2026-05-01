import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { LettrageStats } from '@/types'

export function useLettrageStats(filename: string | null) {
  return useQuery<LettrageStats>({
    queryKey: ['lettrage-stats', filename],
    queryFn: () => api.get(`/lettrage/${filename}/stats`),
    enabled: !!filename,
  })
}

export function useToggleLettrage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ filename, index }: { filename: string; index: number }) =>
      api.post<{ lettre: boolean; index: number }>(`/lettrage/${filename}/${index}`),
    onSuccess: (_, { filename }) => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['lettrage-stats', filename] })
      queryClient.invalidateQueries({ queryKey: ['livret'] })
    },
  })
}

export function useBulkLettrage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ filename, indices, lettre }: { filename: string; indices: number[]; lettre: boolean }) =>
      api.post<{ modified: number }>(`/lettrage/${filename}/bulk`, { indices, lettre }),
    onSuccess: (_, { filename }) => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['lettrage-stats', filename] })
      queryClient.invalidateQueries({ queryKey: ['livret'] })
    },
  })
}
