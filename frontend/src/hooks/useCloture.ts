import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { MonthStatus } from '@/types'

export function useAnnualStatus(year: number | null) {
  return useQuery<MonthStatus[]>({
    queryKey: ['cloture', year],
    queryFn: () => api.get(`/cloture/${year}`),
    enabled: year != null,
  })
}

export function useClotureYears() {
  return useQuery<number[]>({
    queryKey: ['cloture-years'],
    queryFn: () => api.get('/cloture/years'),
  })
}
