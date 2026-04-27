import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import type {
  PrevProvider, PrevProviderCreate, PrevEcheance, PrevDashboard,
  TimelineResponse, PrevSettings, PrelevementLine, OcrExtractionResult,
} from '@/types'

const KEY = ['previsionnel']

// ─── Timeline ───

export function useTimeline(year: number) {
  return useQuery<TimelineResponse>({
    queryKey: [...KEY, 'timeline', year],
    queryFn: () => api.get(`/previsionnel/timeline?year=${year}`),
  })
}

// ─── Providers ───

export function useProviders() {
  return useQuery<PrevProvider[]>({
    queryKey: [...KEY, 'providers'],
    queryFn: () => api.get('/previsionnel/providers'),
  })
}

export function useAddProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: PrevProviderCreate) => api.post('/previsionnel/providers', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success('Fournisseur ajouté')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PrevProvider> }) =>
      api.put(`/previsionnel/providers/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success('Fournisseur mis à jour')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/previsionnel/providers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success('Fournisseur supprimé')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Échéances ───

export function useEcheances(year?: number, statut?: string) {
  const params = new URLSearchParams()
  if (year) params.set('year', String(year))
  if (statut) params.set('statut', statut)
  const qs = params.toString()
  return useQuery<PrevEcheance[]>({
    queryKey: [...KEY, 'echeances', year, statut],
    queryFn: () => api.get(`/previsionnel/echeances${qs ? `?${qs}` : ''}`),
  })
}

export function usePrevDashboard(year: number) {
  return useQuery<PrevDashboard>({
    queryKey: [...KEY, 'dashboard', year],
    queryFn: () => api.get(`/previsionnel/dashboard?year=${year}`),
  })
}

// ─── Actions ───

export function useScanPrev() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ scanned: number; matched: number }>('/previsionnel/scan'),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success(`Scan terminé : ${data.matched} document(s) associé(s)`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useRefreshEcheances() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (year: number) => api.post<{ created: number; total: number }>(`/previsionnel/refresh?year=${year}`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success(`${data.created} échéance(s) créée(s)`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useLinkEcheance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { document_ref: string; document_source: string; montant_reel?: number } }) =>
      api.post(`/previsionnel/echeances/${id}/link`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success('Document associé')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUnlinkEcheance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/previsionnel/echeances/${id}/unlink`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success('Document dissocié')
    },
  })
}

export function useDismissEcheance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post(`/previsionnel/echeances/${id}/dismiss`, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success('Échéance marquée non applicable')
    },
  })
}

// ─── Prélèvements ───

export function useSetPrelevements() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, prelevements }: { id: string; prelevements: PrelevementLine[] }) =>
      api.post(`/previsionnel/echeances/${id}/prelevements`, { prelevements }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success('Prélèvements enregistrés')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useAutoPopulateOcr() {
  const qc = useQueryClient()
  return useMutation<OcrExtractionResult, Error, string>({
    mutationFn: (id: string) => api.post(`/previsionnel/echeances/${id}/auto-populate`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success(data.success ? `${data.nb_lignes_extraites} mois extraits par OCR` : 'Extraction OCR insuffisante')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useScanPrelevements() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<{ matched: number; ecarts: number }>(`/previsionnel/echeances/${id}/scan-prelevements`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success(`${data.matched} prélèvement(s) vérifié(s)${data.ecarts ? `, ${data.ecarts} écart(s)` : ''}`)
    },
  })
}

export function useVerifyPrelevement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, mois, body }: {
      id: string; mois: number
      body?: { operation_file?: string; operation_index?: number; montant_reel?: number }
    }) => api.post(`/previsionnel/echeances/${id}/prelevements/${mois}/verify`, body ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success('Prélèvement vérifié')
    },
  })
}

export function useUnverifyPrelevement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, mois }: { id: string; mois: number }) =>
      api.post(`/previsionnel/echeances/${id}/prelevements/${mois}/unverify`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ─── Settings ───

export function usePrevSettings() {
  return useQuery<PrevSettings>({
    queryKey: [...KEY, 'settings'],
    queryFn: () => api.get('/previsionnel/settings'),
  })
}

export function useUpdatePrevSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: PrevSettings) => api.put('/previsionnel/settings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      toast.success('Paramètres enregistrés')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
