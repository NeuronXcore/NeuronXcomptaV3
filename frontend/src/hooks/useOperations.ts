import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Operation, OperationFile } from '@/types'

export function useOperationFiles() {
  return useQuery<OperationFile[]>({
    queryKey: ['operation-files'],
    queryFn: () => api.get('/operations/files'),
  })
}

export function useOperations(filename: string | null) {
  return useQuery<Operation[]>({
    queryKey: ['operations', filename],
    queryFn: () => api.get(`/operations/${filename}`),
    enabled: !!filename,
  })
}

export function useSaveOperations() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ filename, operations }: { filename: string; operations: Operation[] }) =>
      api.put(`/operations/${filename}`, operations),
    onSuccess: (_, { filename }) => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useHasPdf(filename: string | null) {
  return useQuery<{ has_pdf: boolean; pdf_filename: string | null }>({
    queryKey: ['has-pdf', filename],
    queryFn: () => api.get(`/operations/${filename}/has-pdf`),
    enabled: !!filename,
  })
}

export function useCategorizeOperations() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ filename, mode }: { filename: string; mode: string }) =>
      api.post<{ modified: number; total: number }>(`/operations/${filename}/categorize`, { mode }),
    onSuccess: (_, { filename }) => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
    },
  })
}
