import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type {
  AllBaremes,
  TauxMarginal,
  SeuilCritique,
  HistoriqueBNC,
  PrevisionBNC,
  UrssafDeductibleResult,
  UrssafRegulEstimate,
  UrssafAcompteTheorique,
  UrssafProjectionRow,
} from '@/types'

export function useBaremes(year: number) {
  return useQuery<AllBaremes>({
    queryKey: ['baremes', year],
    queryFn: () => api.get(`/simulation/baremes?year=${year}`),
    staleTime: 5 * 60 * 1000,
  })
}

export function useTauxMarginal(bnc: number, year: number, parts: number = 1) {
  return useQuery<TauxMarginal>({
    queryKey: ['taux-marginal', bnc, year, parts],
    queryFn: () => api.get(`/simulation/taux-marginal?bnc=${bnc}&year=${year}&parts=${parts}`),
    enabled: bnc > 0,
  })
}

export function useSeuilsCritiques(year: number, parts: number = 1) {
  return useQuery<SeuilCritique[]>({
    queryKey: ['seuils-critiques', year, parts],
    queryFn: () => api.get(`/simulation/seuils?year=${year}&parts=${parts}`),
  })
}

export function useHistoriqueBNC(years?: number[]) {
  const params = years ? `?years=${years.join(',')}` : ''
  return useQuery<HistoriqueBNC>({
    queryKey: ['historique-bnc', years],
    queryFn: () => api.get(`/simulation/historique${params}`),
  })
}

export function usePrevisionsBNC(horizon: number = 12, methode: string = 'saisonnier') {
  return useQuery<PrevisionBNC>({
    queryKey: ['previsions-bnc', horizon, methode],
    queryFn: () => api.get(`/simulation/previsions?horizon=${horizon}&methode=${methode}`),
  })
}

export function useSimulateServer() {
  return useMutation({
    mutationFn: (data: any) => api.post('/simulation/calculate', data),
  })
}

export function useSaveBareme() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ type, year, data }: { type: string; year: number; data: any }) =>
      api.put(`/simulation/baremes/${type}?year=${year}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['baremes'] })
    },
  })
}

export function useBatchCsgSplit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ year, force = false }: { year: number; force?: boolean }) =>
      api.post<{ year: number; updated: number; skipped: number; total_non_deductible: number }>(
        `/simulation/batch-csg-split?year=${year}&force=${force}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['category-detail'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUrssafDeductible() {
  return useMutation({
    mutationFn: (body: {
      montant_brut: number
      bnc_estime: number
      year: number
      cotisations_sociales_estime?: number
    }) => api.post<UrssafDeductibleResult>('/simulation/urssaf-deductible', body),
  })
}

export function usePatchCsgSplit(filename: string, index: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (csg_non_deductible: number | null) =>
      api.patch(`/operations/${filename}/${index}/csg-split`, { csg_non_deductible }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
    },
  })
}

export function useUrssafRegul(year: number, enabled: boolean = true) {
  return useQuery<UrssafRegulEstimate>({
    queryKey: ['urssaf-regul', year],
    queryFn: () => api.get(`/simulation/urssaf-regul/${year}`),
    staleTime: 60 * 1000,
    enabled: enabled && year > 0,
  })
}

export function useUrssafAcompteTheorique(year: number, enabled: boolean = true) {
  return useQuery<UrssafAcompteTheorique>({
    queryKey: ['urssaf-acompte-theorique', year],
    queryFn: () => api.get(`/simulation/urssaf-acompte-theorique/${year}`),
    staleTime: 5 * 60 * 1000,
    enabled: enabled && year > 0,
  })
}

export function useUrssafProjection(startYear: number, horizon: number = 5, enabled: boolean = true) {
  return useQuery<UrssafProjectionRow[]>({
    queryKey: ['urssaf-projection', startYear, horizon],
    queryFn: () => api.get(`/simulation/urssaf-projection?start_year=${startYear}&horizon=${horizon}`),
    staleTime: 60 * 1000,
    enabled: enabled && startYear > 0,
  })
}
