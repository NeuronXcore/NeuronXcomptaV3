import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/api/client'
import type { LiasseScp, LiasseComparator } from '@/types'

// Récupère la liasse d'une année, ou null si absente (404 silencieux)
export function useLiasseScp(year: number | null) {
  return useQuery<LiasseScp | null>({
    queryKey: ['liasse-scp', year],
    queryFn: async () => {
      if (year === null) return null
      try {
        return await api.get<LiasseScp>(`/liasse-scp/${year}`)
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }
    },
    enabled: year !== null,
  })
}

// Liste toutes les liasses (pour admin / vue d'ensemble)
export function useLiasseList() {
  return useQuery<LiasseScp[]>({
    queryKey: ['liasse-scp', 'list'],
    queryFn: () => api.get('/liasse-scp/'),
  })
}

// Comparateur CA liasse vs honoraires bancaires
export function useLiasseComparator(year: number | null, enabled: boolean = true) {
  return useQuery<LiasseComparator>({
    queryKey: ['liasse-scp', year, 'comparator'],
    queryFn: () => api.get(`/liasse-scp/${year}/comparator`),
    enabled: enabled && year !== null,
  })
}

export interface SaveLiassePayload {
  year: number
  ca_declare: number
  ged_document_id?: string | null
  note?: string | null
}

export function useSaveLiasse() {
  const qc = useQueryClient()
  return useMutation<LiasseScp, Error, SaveLiassePayload>({
    mutationFn: (data) => api.post('/liasse-scp/', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['liasse-scp'] })
      // Les KPIs BNC/Dashboard doivent se réévaluer
      qc.invalidateQueries({ queryKey: ['analytics'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['year-overview'] })
      qc.invalidateQueries({ queryKey: ['livret'] })
    },
  })
}

export function useDeleteLiasse() {
  const qc = useQueryClient()
  return useMutation<{ deleted: number }, Error, number>({
    mutationFn: (year) => api.delete(`/liasse-scp/${year}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['liasse-scp'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['year-overview'] })
      qc.invalidateQueries({ queryKey: ['livret'] })
    },
  })
}
