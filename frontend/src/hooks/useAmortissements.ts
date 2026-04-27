import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import type {
  Immobilisation, ImmobilisationCreate, AmortissementKpis,
  DotationsExercice, AmortissementCandidate, AmortissementConfig,
  CessionResult, AmortissementVirtualDetail, DotationRef,
  BackfillComputeRequest, BackfillComputeResponse,
  CandidateDetail, DotationGenere,
} from '@/types'

// ─── Queries ───

export function useImmobilisations(statut?: string, poste?: string, year?: number) {
  const params = new URLSearchParams()
  if (statut) params.set('statut', statut)
  if (poste) params.set('poste', poste)
  if (year) params.set('year', String(year))
  return useQuery<Immobilisation[]>({
    queryKey: ['amortissements', statut, poste, year],
    queryFn: () => api.get(`/amortissements?${params.toString()}`),
  })
}

export function useImmobilisation(immoId: string | null) {
  return useQuery<Immobilisation>({
    queryKey: ['amortissement', immoId],
    queryFn: () => api.get(`/amortissements/${immoId}`),
    enabled: !!immoId,
  })
}

export function useAmortissementKpis(year?: number) {
  const qs = year ? `?year=${year}` : ''
  return useQuery<AmortissementKpis>({
    queryKey: ['amortissement-kpis', year],
    queryFn: () => api.get(`/amortissements/kpis${qs}`),
  })
}

export function useDotationsExercice(year: number) {
  return useQuery<DotationsExercice>({
    queryKey: ['dotations', year],
    queryFn: () => api.get(`/amortissements/dotations/${year}`),
  })
}

export function useProjections(years: number = 5) {
  return useQuery<DotationsExercice[]>({
    queryKey: ['amortissement-projections', years],
    queryFn: () => api.get(`/amortissements/projections?years=${years}`),
  })
}

export function useCandidates() {
  return useQuery<AmortissementCandidate[]>({
    queryKey: ['amortissement-candidates'],
    queryFn: () => api.get('/amortissements/candidates'),
  })
}

export function useAmortissementConfig() {
  return useQuery<AmortissementConfig>({
    queryKey: ['amortissement-config'],
    queryFn: () => api.get('/amortissements/config'),
  })
}

// ─── Mutations ───

export function useCreateImmobilisation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ImmobilisationCreate) => api.post('/amortissements', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortissements'] })
      qc.invalidateQueries({ queryKey: ['amortissement-kpis'] })
      toast.success('Immobilisation créée')
    },
  })
}

export function useUpdateImmobilisation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/amortissements/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortissements'] })
      qc.invalidateQueries({ queryKey: ['amortissement-kpis'] })
      toast.success('Immobilisation mise à jour')
    },
  })
}

export function useDeleteImmobilisation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/amortissements/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortissements'] })
      qc.invalidateQueries({ queryKey: ['amortissement-kpis'] })
      toast.success('Immobilisation supprimée')
    },
  })
}

export function useImmobiliserCandidate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ImmobilisationCreate) =>
      api.post('/amortissements/candidates/immobiliser', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortissements'] })
      qc.invalidateQueries({ queryKey: ['amortissement-candidates'] })
      qc.invalidateQueries({ queryKey: ['amortissement-kpis'] })
      qc.invalidateQueries({ queryKey: ['operations'] })
      qc.invalidateQueries({ queryKey: ['alertes'] })
      toast.success('Opération immobilisée')
    },
  })
}

export function useIgnoreCandidate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { filename: string; index: number }) =>
      api.post('/amortissements/candidates/ignore', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortissement-candidates'] })
      qc.invalidateQueries({ queryKey: ['operations'] })
      toast.success('Candidat ignoré')
    },
  })
}

export function useCession() {
  const qc = useQueryClient()
  return useMutation<CessionResult, Error, { id: string; data: Record<string, unknown> }>({
    mutationFn: ({ id, data }) => api.post(`/amortissements/cession/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortissements'] })
      qc.invalidateQueries({ queryKey: ['amortissement-kpis'] })
      toast.success('Sortie enregistrée')
    },
  })
}

export function useSaveAmortissementConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: AmortissementConfig) =>
      api.put('/amortissements/config', config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortissement-config'] })
      qc.invalidateQueries({ queryKey: ['amortissement-candidates'] })
      toast.success('Configuration sauvegardée')
    },
  })
}

// ─── Prompt A2 — virtual-detail / dotation-ref / compute-backfill ───

export function useDotationVirtualDetail(year: number) {
  return useQuery<AmortissementVirtualDetail>({
    queryKey: ['amortissements', 'virtual-detail', year],
    queryFn: () => api.get(`/amortissements/virtual-detail?year=${year}`),
  })
}

export function useDotationRef(year: number) {
  return useQuery<DotationRef | null>({
    queryKey: ['amortissements', 'dotation-ref', year],
    queryFn: () => api.get(`/amortissements/dotation-ref/${year}`),
  })
}

export function useComputeBackfill() {
  return useMutation<BackfillComputeResponse, Error, BackfillComputeRequest>({
    mutationFn: (req) => api.post('/amortissements/compute-backfill', req),
  })
}

// ─── Prompt B2 — OD dotation (generer / supprimer / regenerer-pdf / dotation-genere / candidate-detail) ───

export function useDotationGenere(year: number) {
  return useQuery<DotationGenere | null>({
    queryKey: ['amortissements', 'dotation-genere', year],
    queryFn: () => api.get(`/amortissements/dotation-genere?year=${year}`),
  })
}

export function useCandidateDetail(filename: string | null, index: number | null) {
  return useQuery<CandidateDetail>({
    queryKey: ['amortissements', 'candidate-detail', filename, index],
    queryFn: () => api.get(`/amortissements/candidate-detail?filename=${encodeURIComponent(filename ?? '')}&index=${index ?? 0}`),
    enabled: !!filename && index !== null,
  })
}

export function useGenererDotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (year: number) => api.post(`/amortissements/generer-dotation?year=${year}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortissements'] })
      qc.invalidateQueries({ queryKey: ['amortissement-kpis'] })
      qc.invalidateQueries({ queryKey: ['operations'] })
      qc.invalidateQueries({ queryKey: ['ged'] })
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useSupprimerDotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (year: number) => api.delete(`/amortissements/supprimer-dotation?year=${year}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amortissements'] })
      qc.invalidateQueries({ queryKey: ['amortissement-kpis'] })
      qc.invalidateQueries({ queryKey: ['operations'] })
      qc.invalidateQueries({ queryKey: ['ged'] })
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useRegenererPdfDotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (year: number) => api.post(`/amortissements/regenerer-pdf-dotation?year=${year}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ged'] })
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['amortissements', 'dotation-genere'] })
    },
  })
}
