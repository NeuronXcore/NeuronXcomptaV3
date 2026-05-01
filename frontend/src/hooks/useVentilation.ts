import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Operation, VentilationLine } from '../types'

export function useSetVentilation(filename: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ opIndex, lines }: { opIndex: number; lines: Omit<VentilationLine, 'index'>[] }) =>
      api.put<Operation>(`/ventilation/${filename}/${opIndex}`, { lines }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['livret'] })
    },
  })
}

export function useRemoveVentilation(filename: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (opIndex: number) =>
      api.delete<Operation>(`/ventilation/${filename}/${opIndex}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['livret'] })
    },
  })
}

export function useUpdateVentilationLine(filename: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      opIndex,
      lineIndex,
      updates,
    }: {
      opIndex: number
      lineIndex: number
      updates: Partial<VentilationLine>
    }) => api.patch<Operation>(`/ventilation/${filename}/${opIndex}/${lineIndex}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['livret'] })
    },
  })
}
