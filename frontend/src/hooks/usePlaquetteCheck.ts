import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type {
  PlaquetteCheck,
  PlaquetteItem,
  PlaquetteItemPatch,
  PlaquetteItemCreatePayload,
  PlaquetteDrillDownOp,
  PlaquetteChallengeEmail,
  PlaquetteTemplate,
} from '@/types'

export function usePlaquetteTemplates() {
  return useQuery<{ templates: PlaquetteTemplate[] }>({
    queryKey: ['plaquette-templates'],
    queryFn: () => api.get('/plaquette/templates'),
    staleTime: 5 * 60 * 1000,
  })
}

export function usePlaquetteCheck(year: number | null, template: string = 'sygnatures_marenco') {
  return useQuery<PlaquetteCheck>({
    queryKey: ['plaquette-check', year],
    queryFn: () => api.get(`/plaquette/${year}?template=${encodeURIComponent(template)}`),
    enabled: year !== null,
    staleTime: 30 * 1000,
  })
}

export function usePatchPlaquetteItem(year: number | null) {
  const qc = useQueryClient()
  return useMutation<
    PlaquetteItem,
    Error,
    { item_id: string; patch: PlaquetteItemPatch }
  >({
    mutationFn: ({ item_id, patch }) =>
      api.patch(`/plaquette/${year}/items/${item_id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
    },
  })
}

export function useCreatePlaquetteItem(year: number | null) {
  const qc = useQueryClient()
  return useMutation<PlaquetteItem, Error, PlaquetteItemCreatePayload>({
    mutationFn: (payload) => api.post(`/plaquette/${year}/items`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
    },
  })
}

export function useDeletePlaquetteItem(year: number | null) {
  const qc = useQueryClient()
  return useMutation<{ status: string; item_id: string }, Error, string>({
    mutationFn: (item_id) => api.delete(`/plaquette/${year}/items/${item_id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
    },
  })
}

export function usePlaquetteItemOps(year: number | null, itemId: string | null) {
  return useQuery<{ item_id: string; nb_ops: number; operations: PlaquetteDrillDownOp[] }>({
    queryKey: ['plaquette-item-ops', year, itemId],
    queryFn: () => api.get(`/plaquette/${year}/items/${itemId}/ops`),
    enabled: year !== null && itemId !== null,
    staleTime: 30 * 1000,
  })
}

export function usePatchPlaquetteTotaux(year: number | null) {
  const qc = useQueryClient()
  return useMutation<{ totaux_plaquette: Record<string, number> }, Error, Record<string, number | null>>({
    mutationFn: (patch) => api.patch(`/plaquette/${year}/totaux`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
    },
  })
}

export function useSetPlaquetteGedRef(year: number | null) {
  const qc = useQueryClient()
  return useMutation<
    PlaquetteCheck,
    Error,
    { ged_doc_id: string; cabinet_template?: string }
  >({
    mutationFn: (payload) => api.post(`/plaquette/${year}/set-ged-ref`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
    },
  })
}

export function useGenerateChallengeEmail(year: number | null) {
  return useMutation<PlaquetteChallengeEmail, Error, { nom?: string }>({
    mutationFn: ({ nom } = {}) => {
      const qs = nom ? `?nom=${encodeURIComponent(nom)}` : ''
      return api.post(`/plaquette/${year}/generate-challenge-email${qs}`)
    },
  })
}

export function useAddJournalEntry(year: number | null) {
  const qc = useQueryClient()
  return useMutation<
    Record<string, unknown>,
    Error,
    {
      type: 'email_out' | 'email_in' | 'note'
      subject?: string
      body_excerpt?: string
      related_item_ids?: string[]
      ged_email_history_id?: string
      author?: string
    }
  >({
    mutationFn: (payload) => api.post(`/plaquette/${year}/journal`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
    },
  })
}

export interface PlaquetteReportMeta {
  filename: string
  ged_doc_id: string | null
  size_bytes: number
  generated_at: string
  year: number
  replaced_count?: number
}

export function useGeneratePlaquetteReport(year: number | null) {
  const qc = useQueryClient()
  return useMutation<PlaquetteReportMeta, Error>({
    mutationFn: () => api.post(`/plaquette/${year}/generate-pdf-report`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
      qc.invalidateQueries({ queryKey: ['ged-stats'] })
    },
  })
}

export interface PlaquetteEmailBundle {
  subject: string
  body: string
  related_item_ids: string[]
  nb_items: number
  attachments: { type: string; filename: string }[]
  rapport_filename: string
  rapport_ged_doc_id: string | null
  rapport_size_bytes: number
  plaquette_ged_doc_id: string | null
}

export function usePreparePlaquetteEmailBundle(year: number | null) {
  const qc = useQueryClient()
  return useMutation<PlaquetteEmailBundle, Error>({
    mutationFn: () => api.post(`/plaquette/${year}/prepare-email-bundle`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
    },
  })
}

export interface ArchivedReport {
  filename: string
  doc_id: string
  generated_at: string | null
  size_bytes: number | null
  preview_url: string
}

export function usePlaquetteReportsHistory(year: number | null) {
  return useQuery<{ count: number; reports: ArchivedReport[] }>({
    queryKey: ['plaquette-reports', year],
    queryFn: () => api.get(`/plaquette/${year}/reports`),
    enabled: year !== null,
    staleTime: 15 * 1000,
  })
}

export function useDeletePlaquetteReport(year: number | null) {
  const qc = useQueryClient()
  return useMutation<{ status: string; filename: string }, Error, string>({
    mutationFn: (filename) =>
      api.delete(`/plaquette/${year}/reports/${encodeURIComponent(filename)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-reports', year] })
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
    },
  })
}

export interface ItemStatusUpdate {
  item_id: string
  new_statut: 'non_revu' | 'ok' | 'a_challenger' | 'refus_justifie' | 'en_discussion' | 'resolu'
  appended_comment?: string | null
}

export interface ComptableResponseRequest {
  subject?: string
  body_excerpt: string
  received_at?: string
  items_updates: ItemStatusUpdate[]
}

export interface ComptableResponseResult {
  journal_entry_id: string
  updated_items_count: number
  updated_item_ids: string[]
}

export function useLogComptableResponse(year: number | null) {
  const qc = useQueryClient()
  return useMutation<ComptableResponseResult, Error, ComptableResponseRequest>({
    mutationFn: (payload) => api.post(`/plaquette/${year}/log-comptable-response`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
    },
  })
}
