import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'

export interface BulkLockItem {
  filename: string
  index: number
  locked: boolean
}

export interface BulkLockResultItem {
  filename: string
  index: number
  locked: boolean
  locked_at: string | null
  error: string | null
}

export interface BulkLockResponse {
  results: BulkLockResultItem[]
  success_count: number
  error_count: number
}

export function useBulkLock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (items: BulkLockItem[]) =>
      api.patch<BulkLockResponse>('/operations/bulk-lock', { items }),
    onSuccess: (_data, items) => {
      const filenames = [...new Set(items.map(i => i.filename))]
      filenames.forEach(f =>
        queryClient.invalidateQueries({ queryKey: ['operations', f] })
      )
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
    },
  })
}
