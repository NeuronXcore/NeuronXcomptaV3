import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Recurrence, Echeance, EcheancierStats, SoldePrevisionnel } from '@/types'

export function useRecurrences() {
  return useQuery<Recurrence[]>({
    queryKey: ['echeancier-recurrences'],
    queryFn: () => api.get('/echeancier/recurrences'),
  })
}

export function useEcheancier(horizon: number = 6) {
  return useQuery<Echeance[]>({
    queryKey: ['echeancier', horizon],
    queryFn: () => api.get(`/echeancier/calendar?horizon=${horizon}`),
  })
}

export function useEcheancierStats(horizon: number = 6) {
  return useQuery<EcheancierStats>({
    queryKey: ['echeancier-stats', horizon],
    queryFn: () => api.get(`/echeancier/stats?horizon=${horizon}`),
  })
}

export function useSoldePrevisionnel(soldeActuel: number, horizon: number = 6) {
  return useQuery<SoldePrevisionnel[]>({
    queryKey: ['solde-previsionnel', soldeActuel, horizon],
    queryFn: () =>
      api.get(`/echeancier/solde-previsionnel?solde_actuel=${soldeActuel}&horizon=${horizon}`),
  })
}

export function useConfirmEcheance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { echeanceId: string; operationFile: string; operationIndex: number }) =>
      api.put(`/echeancier/${data.echeanceId}/confirm`, {
        echeance_id: data.echeanceId,
        operation_file: data.operationFile,
        operation_index: data.operationIndex,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['echeancier'] })
      queryClient.invalidateQueries({ queryKey: ['echeancier-stats'] })
      queryClient.invalidateQueries({ queryKey: ['solde-previsionnel'] })
    },
  })
}

export function useAnnulerEcheance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (echeanceId: string) => api.put(`/echeancier/${echeanceId}/annuler`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['echeancier'] })
      queryClient.invalidateQueries({ queryKey: ['echeancier-stats'] })
      queryClient.invalidateQueries({ queryKey: ['solde-previsionnel'] })
    },
  })
}
