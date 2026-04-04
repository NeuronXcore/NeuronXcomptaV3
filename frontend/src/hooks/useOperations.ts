import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
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

export function useYearOperations(filesForYear: OperationFile[], enabled: boolean) {
  const queries = useQueries({
    queries: filesForYear.map(f => ({
      queryKey: ['operations', f.filename],
      queryFn: () => api.get<Operation[]>(`/operations/${f.filename}`),
      enabled,
      staleTime: 5 * 60 * 1000,
    })),
  })

  const isLoading = queries.some(q => q.isLoading)
  const allDone = enabled && queries.length > 0 && queries.every(q => q.isSuccess)
  // Stable key for memo: use dataUpdatedAt timestamps
  const dataKey = queries.map(q => q.dataUpdatedAt).join(',')

  const data = useMemo(() => {
    if (!allDone) return undefined
    const merged: Operation[] = []
    queries.forEach((q, i) => {
      if (q.data) {
        for (const op of q.data as Operation[]) {
          merged.push({ ...op, _sourceFile: filesForYear[i].filename })
        }
      }
    })
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, allDone])

  return { data, isLoading }
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
