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
  PlaquetteCheckStatus,
  PlaquetteStatusUpdatePayload,
  PlaquetteSummary,
  FinalizePlaquettePayload,
  FinalizePlaquetteResult,
  JournalAttachment,
  JournalGroupedByItem,
  RisqueOverridePayload,
  TopRisquesResult,
  RecomputeRisqueResult,
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

/**
 * Session 39 P3 — Résumé léger pour le badge sidebar.
 * Ne déclenche PAS de recalcul backend (lit le cache via _load_year).
 * staleTime 30s + refetchOnWindowFocus pour rester live sans matraquer l'API.
 */
export function usePlaquetteSummary(year: number) {
  return useQuery<PlaquetteSummary>({
    queryKey: ['plaquette-summary', year],
    queryFn: () => api.get(`/plaquette/${year}/summary`),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
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
      qc.invalidateQueries({ queryKey: ['plaquette-summary'] })
    },
  })
}

export function useCreatePlaquetteItem(year: number | null) {
  const qc = useQueryClient()
  return useMutation<PlaquetteItem, Error, PlaquetteItemCreatePayload>({
    mutationFn: (payload) => api.post(`/plaquette/${year}/items`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-summary'] })
    },
  })
}

export function useDeletePlaquetteItem(year: number | null) {
  const qc = useQueryClient()
  return useMutation<{ status: string; item_id: string }, Error, string>({
    mutationFn: (item_id) => api.delete(`/plaquette/${year}/items/${item_id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-summary'] })
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
      qc.invalidateQueries({ queryKey: ['plaquette-summary'] })
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
      // L'auto-replace backend supprime l'ancienne version → l'historique Archives
      // doit être rafraîchi sinon le bouton Eye/Open pointe vers un PDF disparu.
      qc.invalidateQueries({ queryKey: ['plaquette-reports', year] })
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
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
      qc.invalidateQueries({ queryKey: ['ged-stats'] })
      // Le bundle déclenche `generate_and_register` côté backend → idem auto-replace,
      // l'historique Archives doit être invalidé.
      qc.invalidateQueries({ queryKey: ['plaquette-reports', year] })
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
      qc.invalidateQueries({ queryKey: ['plaquette-summary'] })
    },
  })
}

// ─── Session 39 P1 : cycle de vie + attachements journal ───

/**
 * Transition de statut (en_cours ↔ validation_finale).
 * Pour →DECLARE, utiliser useFinalizePlaquette (snapshot atomique).
 */
export function usePatchPlaquetteStatus(year: number | null) {
  const qc = useQueryClient()
  return useMutation<PlaquetteCheck, Error, PlaquetteStatusUpdatePayload>({
    mutationFn: (payload) => api.patch(`/plaquette/${year}/status`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-summary'] })
    },
  })
}

/**
 * Transition atomique →DECLARE : PDF watermarké + snapshot JSON + GED protégé.
 * Invalide aussi ['livret'] car le snapshot impacte la cohérence livret.
 */
export function useFinalizePlaquette(year: number | null) {
  const qc = useQueryClient()
  return useMutation<FinalizePlaquetteResult, Error, FinalizePlaquettePayload>({
    mutationFn: (payload) => api.post(`/plaquette/${year}/finalize`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-summary'] })
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
      qc.invalidateQueries({ queryKey: ['ged-stats'] })
      qc.invalidateQueries({ queryKey: ['plaquette-reports', year] })
      qc.invalidateQueries({ queryKey: ['livret'] })
    },
  })
}

/**
 * Upload d'une pièce jointe sur une entrée journal (multipart).
 * Codes d'erreur :
 *   - 413 : > 10 Mo
 *   - 415 : mime non whitelisté (PDF, PNG, JPG, WEBP, EML, ZIP uniquement)
 */
export function useUploadJournalAttachment(year: number | null) {
  const qc = useQueryClient()
  return useMutation<
    JournalAttachment,
    Error,
    { entryId: string; file: File }
  >({
    mutationFn: async ({ entryId, file }) => {
      const formData = new FormData()
      formData.append('file', file)
      // Multipart : pas via api.post (qui force Content-Type JSON), via fetch direct
      const res = await fetch(
        `/api/plaquette/${year}/journal/${encodeURIComponent(entryId)}/attachments`,
        { method: 'POST', body: formData },
      )
      if (!res.ok) {
        const text = await res.text()
        let detail = text
        try {
          const parsed = JSON.parse(text)
          detail = parsed.detail || text
        } catch {
          /* keep raw */
        }
        const err = new Error(detail) as Error & { status?: number }
        err.status = res.status
        throw err
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-journal-grouped', year] })
    },
  })
}

export function useDeleteJournalAttachment(year: number | null) {
  const qc = useQueryClient()
  return useMutation<
    { status: string; filename: string },
    Error,
    { entryId: string; filename: string }
  >({
    mutationFn: ({ entryId, filename }) =>
      api.delete(
        `/plaquette/${year}/journal/${encodeURIComponent(entryId)}/attachments/${encodeURIComponent(filename)}`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-journal-grouped', year] })
    },
  })
}

export function useJournalGroupedByItem(year: number | null) {
  return useQuery<JournalGroupedByItem>({
    queryKey: ['plaquette-journal-grouped', year],
    queryFn: () => api.get(`/plaquette/${year}/journal/grouped-by-item`),
    enabled: year !== null,
    staleTime: 30 * 1000,
  })
}

/**
 * Helper URL pour preview/download inline d'un attachement journal.
 * Utiliser dans des <a target="_blank" href={...}> ou comme src d'iframe.
 */
export function journalAttachmentUrl(
  year: number,
  entryId: string,
  filename: string,
): string {
  return `/api/plaquette/${year}/journal/${encodeURIComponent(entryId)}/attachments/${encodeURIComponent(filename)}`
}

/**
 * Mirror frontend des gardes backend : items éditables UNIQUEMENT si status === 'en_cours'.
 * Le journal reste toujours appendable (cf. is_journal_appendable backend).
 */
export function isPlaquetteEditable(check: PlaquetteCheck | undefined | null): boolean {
  return check?.status === 'en_cours'
}

export function isPlaquetteStatusRevertable(
  check: PlaquetteCheck | undefined | null,
): boolean {
  return check?.status !== 'declare'
}

export type { PlaquetteCheckStatus }

// ─── Session 39 P2 : évaluation risque fiscal ───

/**
 * Force le recalcul du risque de tous les items (ignore le cache `last_evaluated_at`).
 * Préserve les overrides manuels. HTTP 423 si status==DECLARE.
 */
export function useRecomputeRisque(year: number | null) {
  const qc = useQueryClient()
  return useMutation<RecomputeRisqueResult, Error>({
    mutationFn: () => api.post(`/plaquette/${year}/risque/recompute`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-top-risques', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-summary'] })
    },
  })
}

/**
 * Override manuel du niveau de risque d'un item. Motif obligatoire pour traçabilité.
 * HTTP 423 si status==DECLARE.
 */
export function usePatchItemRisque(year: number | null) {
  const qc = useQueryClient()
  return useMutation<PlaquetteItem, Error, { item_id: string; payload: RisqueOverridePayload }>({
    mutationFn: ({ item_id, payload }) =>
      api.patch(`/plaquette/${year}/items/${item_id}/risque`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-top-risques', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-summary'] })
    },
  })
}

/**
 * Repasse un item en mode auto (efface l'override).
 * Le prochain GET /{year} recalculera le niveau automatiquement.
 */
export function useResetItemRisque(year: number | null) {
  const qc = useQueryClient()
  return useMutation<PlaquetteItem, Error, string>({
    mutationFn: (item_id) =>
      api.delete(`/plaquette/${year}/items/${item_id}/risque/override`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaquette-check', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-top-risques', year] })
      qc.invalidateQueries({ queryKey: ['plaquette-summary'] })
    },
  })
}

/**
 * Top N items triés par niveau desc puis montant desc. Autorisé en DECLARE.
 */
export function useTopRisques(year: number | null, limit: number = 5) {
  return useQuery<TopRisquesResult>({
    queryKey: ['plaquette-top-risques', year, limit],
    queryFn: () => api.get(`/plaquette/${year}/risque/top?limit=${limit}`),
    enabled: year !== null,
    staleTime: 30 * 1000,
  })
}
