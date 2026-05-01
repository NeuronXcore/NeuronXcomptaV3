import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import type {
  Immobilisation, ImmobilisationCreate, ImmobilisationSource, AmortissementKpis,
  DotationsExercice, AmortissementCandidate, AmortissementConfig,
  CessionResult, AmortissementVirtualDetail, DotationRef,
  BackfillComputeRequest, BackfillComputeResponse,
  CandidateDetail, DotationGenere, GedDocument,
} from '@/types'

// ─── Queries ───

export function useImmobilisations(statut?: string, poste?: string, year?: number) {
  const params = new URLSearchParams()
  if (statut) params.set('statut', statut)
  if (poste) params.set('poste', poste)
  if (year) params.set('year', String(year))
  // URL toujours valide : trailing slash + qs uniquement si params.
  // Sans ce garde, `?` sans slash casse le proxy Vite (Failed to fetch).
  const qs = params.toString()
  return useQuery<Immobilisation[]>({
    queryKey: ['amortissements', statut, poste, year],
    queryFn: () => api.get(qs ? `/amortissements/?${qs}` : '/amortissements/'),
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
      qc.invalidateQueries({ queryKey: ['amortissements', 'source'] })
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
      qc.invalidateQueries({ queryKey: ['amortissements', 'source'] })
      toast.success('Immobilisation mise à jour')
    },
  })
}

export interface DeleteImmobilisationResult {
  status: 'deleted'
  immo_id: string
  designation: string
  ops_unlinked: Array<{ filename: string; index: number; libelle: string; date: string }>
  affected_years: number[]
}

export function useDeleteImmobilisation() {
  const qc = useQueryClient()
  return useMutation<DeleteImmobilisationResult, Error, string>({
    mutationFn: (id: string) => api.delete(`/amortissements/${id}`),
    onSuccess: () => {
      // Cascade côté serveur : ops déliées + cat remise à vide → invalider tout ce
      // qui dépend des ops + des dotations + des analytics. Le toast est délégué
      // au composant appelant (riche : compte ops déliées + années OD impactées).
      qc.invalidateQueries({ queryKey: ['amortissements'] })
      qc.invalidateQueries({ queryKey: ['amortissement-kpis'] })
      qc.invalidateQueries({ queryKey: ['amortissement-candidates'] })
      qc.invalidateQueries({ queryKey: ['amortissements', 'source'] })
      qc.invalidateQueries({ queryKey: ['operations'] })
      qc.invalidateQueries({ queryKey: ['analytics'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['year-overview'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['alertes'] })
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
      qc.invalidateQueries({ queryKey: ['amortissements', 'source'] })
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
      qc.invalidateQueries({ queryKey: ['livret'] })
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
      qc.invalidateQueries({ queryKey: ['livret'] })
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

// ─── Source op + justif lié (drawer édition) ───
//
// Renvoie l'op bancaire source d'une immo (via transitivité) + le filename
// du justif rattaché à cette op. `null` si l'immo a été créée manuellement
// ou en reprise. Cache 30s — invalidé sur create/update/delete.

export function useImmobilisationSource(immoId: string | null | undefined) {
  return useQuery<ImmobilisationSource | null>({
    queryKey: ['amortissements', 'source', immoId],
    queryFn: () => api.get<ImmobilisationSource | null>(`/amortissements/${immoId}/source`),
    enabled: !!immoId,
    staleTime: 30_000,
  })
}

// ─── Préparation envoi comptable amortissements ───
//
// Récupère (ou auto-génère si manquants) les rapports `amortissements_registre`
// et `amortissements_dotations` pour l'année cible, puis lit `linked_justifs`
// dans leur metadata GED. Retourne les 2 rapports + la liste dédupliquée des
// justifs liés. Consommé par le bouton « Envoyer au comptable » du header
// `AmortissementsPage` qui pré-coche tout dans `useSendDrawerStore`.

export interface PrepareAmortissementsEnvoiResult {
  rapports: GedDocument[]
  linkedJustifs: string[]
  generatedCount: number
}

export function usePrepareAmortissementsEnvoi() {
  const qc = useQueryClient()
  return useMutation<PrepareAmortissementsEnvoiResult, Error, number>({
    mutationFn: async (year: number): Promise<PrepareAmortissementsEnvoiResult> => {
      // Helper : récupère les rapports amortissements de l'année depuis la GED
      const fetchAmortReports = async (): Promise<GedDocument[]> => {
        const params = new URLSearchParams({ type: 'rapport', year: String(year) })
        const docs = await api.get<GedDocument[]>(`/ged/documents?${params.toString()}`)
        return docs.filter((d) => {
          const tid = d.rapport_meta?.template_id
          return tid === 'amortissements_registre' || tid === 'amortissements_dotations'
        })
      }

      const findIn = (list: GedDocument[], templateId: string): GedDocument | undefined =>
        list.find((d) => d.rapport_meta?.template_id === templateId)

      // Vérifie d'abord si des immos ont un justif lié — on ne régénère que dans ce cas
      const immos = await api.get<Immobilisation[]>('/amortissements/')
      const anyLinked = immos.some((i) => i.has_justif && (i.justif_filename ?? null))

      let docs = await fetchAmortReports()
      const registreCurrent = findIn(docs, 'amortissements_registre')
      const dotationsCurrent = findIn(docs, 'amortissements_dotations')

      // Régénération opportuniste : un rapport existe MAIS son `linked_justifs`
      // est vide ALORS qu'on sait qu'au moins une immo a un justif. C'est le cas
      // des rapports legacy générés avant le fix Session 35.1 (bug "all" → []
      // figé). Régénérer rafraîchit le snapshot — le fallback dynamique côté
      // email_service reste un filet de sécurité si la régénération échoue.
      const isStale = (doc: GedDocument | undefined) =>
        !!doc && anyLinked && (doc.rapport_meta?.linked_justifs?.length ?? 0) === 0

      const registreNeedsGen = !registreCurrent || isStale(registreCurrent)
      const dotationsNeedsGen = !dotationsCurrent || isStale(dotationsCurrent)
      let generatedCount = 0

      // Auto-génération / régénération (PDF par défaut)
      if (registreNeedsGen) {
        await api.post('/reports/generate', {
          template_id: 'amortissements_registre',
          filters: { year, statut: 'all', poste: 'all' },
          format: 'pdf',
        })
        generatedCount += 1
      }
      if (dotationsNeedsGen) {
        await api.post('/reports/generate', {
          template_id: 'amortissements_dotations',
          filters: { year, poste: 'all' },
          format: 'pdf',
        })
        generatedCount += 1
      }

      // Re-fetch pour récupérer les rapports fraîchement générés (et leur linked_justifs)
      if (generatedCount > 0) {
        await qc.invalidateQueries({ queryKey: ['ged-documents'] })
        await qc.invalidateQueries({ queryKey: ['ged-tree'] })
        await qc.invalidateQueries({ queryKey: ['reports-gallery'] })
        docs = await fetchAmortReports()
      }

      const registre = findIn(docs, 'amortissements_registre')
      const dotations = findIn(docs, 'amortissements_dotations')
      const rapports: GedDocument[] = [registre, dotations].filter(
        (r): r is GedDocument => !!r,
      )

      // Agrège les linked_justifs des deux rapports — dédupliqué
      const linkedSet = new Set<string>()
      for (const r of rapports) {
        for (const fn of r.rapport_meta?.linked_justifs ?? []) {
          if (fn) linkedSet.add(fn)
        }
      }

      return {
        rapports,
        linkedJustifs: Array.from(linkedSet).sort(),
        generatedCount,
      }
    },
  })
}
