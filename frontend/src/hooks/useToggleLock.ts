import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'

interface ToggleLockParams {
  filename: string
  index: number
  locked: boolean
}

interface ToggleLockResponse {
  locked: boolean
  locked_at: string | null
}

export function useToggleLock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ filename, index, locked }: ToggleLockParams) =>
      api.patch<ToggleLockResponse>(`/operations/${filename}/${index}/lock`, { locked }),
    onSuccess: (_data, { filename }) => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
    },
  })
}
