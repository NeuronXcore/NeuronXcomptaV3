import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import type {
  GedTreeResponse,
  GedDocument,
  GedStats,
  GedSearchResult,
  GedFilters,
  PostesConfig,
} from '@/types'

// ─── Queries ───

export function useGedTree() {
  return useQuery<GedTreeResponse>({
    queryKey: ['ged-tree'],
    queryFn: () => api.get('/ged/tree'),
  })
}

export function useGedDocuments(filters: GedFilters) {
  const params = new URLSearchParams()
  if (filters.type) params.set('type', filters.type)
  if (filters.year) params.set('year', String(filters.year))
  if (filters.month) params.set('month', String(filters.month))
  if (filters.quarter) params.set('quarter', String(filters.quarter))
  if (filters.categorie) params.set('categorie', filters.categorie)
  if (filters.sous_categorie) params.set('sous_categorie', filters.sous_categorie)
  if (filters.fournisseur) params.set('fournisseur', filters.fournisseur)
  if (filters.format_type) params.set('format_type', filters.format_type)
  if (filters.favorite !== undefined) params.set('favorite', String(filters.favorite))
  if (filters.poste_comptable) params.set('poste_comptable', filters.poste_comptable)
  if (filters.tags?.length) params.set('tags', filters.tags.join(','))
  if (filters.search) params.set('search', filters.search)
  if (filters.montant_min !== undefined) params.set('montant_min', String(filters.montant_min))
  if (filters.montant_max !== undefined) params.set('montant_max', String(filters.montant_max))
  if (filters.sort_by) params.set('sort_by', filters.sort_by)
  if (filters.sort_order) params.set('sort_order', filters.sort_order)

  return useQuery<GedDocument[]>({
    queryKey: ['ged-documents', filters],
    queryFn: () => api.get(`/ged/documents?${params.toString()}`),
  })
}

export function useGedTypes() {
  return useQuery<string[]>({
    queryKey: ['ged-types'],
    queryFn: () => api.get('/ged/types'),
  })
}

export function useGedPostes() {
  return useQuery<PostesConfig>({
    queryKey: ['ged-postes'],
    queryFn: () => api.get('/ged/postes'),
  })
}

export function useGedStats() {
  return useQuery<GedStats>({
    queryKey: ['ged-stats'],
    queryFn: () => api.get('/ged/stats'),
  })
}

export function useGedSearch(query: string) {
  return useQuery<GedSearchResult[]>({
    queryKey: ['ged-search', query],
    queryFn: () => api.get(`/ged/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
  })
}

// ─── Mutations ───

export function useGedUpload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, metadata }: { file: File; metadata: Record<string, unknown> }) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('metadata_json', JSON.stringify(metadata))
      const res = await fetch('/api/ged/upload', { method: 'POST', body: formData })
      if (!res.ok) throw new Error((await res.json()).detail || 'Erreur upload')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ged-tree'] })
      queryClient.invalidateQueries({ queryKey: ['ged-documents'] })
      queryClient.invalidateQueries({ queryKey: ['ged-stats'] })
      queryClient.invalidateQueries({ queryKey: ['ged-types'] })
      toast.success('Document uploadé avec OCR')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useGedUpdateDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ docId, updates }: { docId: string; updates: Record<string, unknown> }) =>
      api.patch(`/ged/documents/${docId}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ged-documents'] })
      queryClient.invalidateQueries({ queryKey: ['ged-tree'] })
      queryClient.invalidateQueries({ queryKey: ['ged-stats'] })
      toast.success('Document mis à jour')
    },
  })
}

export function useGedDeleteDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (docId: string) => api.delete(`/ged/documents/${docId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ged-tree'] })
      queryClient.invalidateQueries({ queryKey: ['ged-documents'] })
      queryClient.invalidateQueries({ queryKey: ['ged-stats'] })
      toast.success('Document supprimé')
    },
  })
}

export function useGedSavePostes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (config: PostesConfig) => api.put('/ged/postes', config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ged-postes'] })
      queryClient.invalidateQueries({ queryKey: ['ged-stats'] })
      toast.success('Postes sauvegardés')
    },
  })
}

export function useGedAddPoste() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (poste: Record<string, unknown>) => api.post('/ged/postes', poste),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ged-postes'] })
    },
  })
}

export function useGedDeletePoste() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (posteId: string) => api.delete(`/ged/postes/${posteId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ged-postes'] })
    },
  })
}

export function useGedBulkTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { doc_ids: string[]; tags: string[] }) =>
      api.post('/ged/bulk-tag', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ged-documents'] })
      toast.success('Tags ajoutés')
    },
  })
}

export function useGedScan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/ged/scan'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ged-tree'] })
      queryClient.invalidateQueries({ queryKey: ['ged-documents'] })
      queryClient.invalidateQueries({ queryKey: ['ged-stats'] })
      toast.success('Scan terminé')
    },
  })
}

export function useGedOpenNative() {
  return useMutation({
    mutationFn: (docId: string) => api.post(`/ged/documents/${docId}/open-native`),
    onSuccess: () => toast.success('Document ouvert dans Aperçu'),
    onError: () => toast.error("Impossible d'ouvrir le document"),
  })
}

// ─── GED V2 Hooks ───

export function useGedPendingReports(year: number) {
  return useQuery({
    queryKey: ['ged', 'pending-reports', year],
    queryFn: () => api.get(`/ged/pending-reports?year=${year}`),
  })
}

export function useToggleReportFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (docId: string) => api.post(`/ged/documents/${encodeURIComponent(docId)}/favorite`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['ged-stats'] })
      toast.success('Favori mis à jour')
    },
  })
}

export function useRegenerateReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (docId: string) => api.post(`/ged/documents/${encodeURIComponent(docId)}/regenerate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['ged-stats'] })
      toast.success('Rapport re-généré')
    },
  })
}

export function useCompareReports() {
  return useMutation({
    mutationFn: (body: { doc_id_a: string; doc_id_b: string }) =>
      api.post('/ged/documents/compare-reports', body),
  })
}
