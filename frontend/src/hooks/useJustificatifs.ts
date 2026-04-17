import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type {
  JustificatifInfo,
  JustificatifStats,
  JustificatifUploadResult,
  OperationSuggestion,
  ReverseLookupResult,
} from '@/types'

interface JustificatifFilters {
  status: string
  search: string
  year?: number | null
  month?: number | null
  sort_by: string
  sort_order: string
}

export function useJustificatifs(filters: JustificatifFilters) {
  const params = new URLSearchParams()
  params.set('status', filters.status)
  if (filters.search) params.set('search', filters.search)
  if (filters.year) params.set('year', String(filters.year))
  if (filters.month) params.set('month', String(filters.month))
  params.set('sort_by', filters.sort_by)
  params.set('sort_order', filters.sort_order)

  return useQuery<JustificatifInfo[]>({
    queryKey: ['justificatifs', filters],
    queryFn: () => api.get(`/justificatifs/?${params.toString()}`),
  })
}

export function useJustificatifStats() {
  return useQuery<JustificatifStats>({
    queryKey: ['justificatif-stats'],
    queryFn: () => api.get('/justificatifs/stats'),
  })
}

export function useUploadJustificatifs() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (files: File[]) =>
      api.uploadMultiple<JustificatifUploadResult[]>('/justificatifs/upload', files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
    },
  })
}

export interface DeleteJustificatifResult {
  deleted: string
  ops_unlinked: Array<{ file: string; libelle: string; index: number }>
  thumbnail_deleted: boolean
  ged_cleaned: boolean
  ocr_cache_deleted: boolean
}

export function useDeleteJustificatif() {
  const queryClient = useQueryClient()
  return useMutation<DeleteJustificatifResult, Error, string>({
    mutationFn: (filename: string) => api.delete(`/justificatifs/${filename}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
      queryClient.invalidateQueries({ queryKey: ['ged'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-unmatched'] })
    },
  })
}

export function useAssociate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { justificatif_filename: string; operation_file: string; operation_index: number }) =>
      api.post('/justificatifs/associate', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-suggestions'] })
    },
  })
}

export function useDissociate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { operation_file: string; operation_index: number }) =>
      api.post('/justificatifs/dissociate', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      // Sans ces 2 invalidations, le justif dissocié resterait faussement
      // classé "Avec assoc." dans OCR Historique et n'apparaîtrait pas avec
      // ses suggestions dans le widget Pipeline jusqu'au prochain refetch.
      queryClient.invalidateQueries({ queryKey: ['justificatif-reverse-lookup'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-operation-suggestions'] })
    },
  })
}

export function useSuggestions(filename: string | null) {
  return useQuery<OperationSuggestion[]>({
    queryKey: ['justificatif-suggestions', filename],
    queryFn: () => api.get(`/justificatifs/${filename}/suggestions`),
    enabled: !!filename,
  })
}

export function useReverseLookup(justificatifFilename: string | null) {
  return useQuery<ReverseLookupResult[]>({
    queryKey: ['justificatif-reverse-lookup', justificatifFilename],
    queryFn: () => api.get(`/justificatifs/reverse-lookup/${justificatifFilename}`),
    enabled: !!justificatifFilename,
  })
}

export function useJustificatifOperationSuggestions(justificatifFilename: string | null) {
  return useQuery<OperationSuggestion[]>({
    queryKey: ['justificatif-operation-suggestions', justificatifFilename],
    queryFn: () => api.get(`/rapprochement/suggestions/justificatif/${justificatifFilename}`),
    enabled: !!justificatifFilename,
  })
}

export interface RenameCollisionDetail {
  error: 'rename_collision'
  message: string
  existing_location: 'en_attente' | 'traites'
  suggestion: string
}

export function isRenameCollision(err: unknown): err is Error & { detail: RenameCollisionDetail } {
  if (!err || typeof err !== 'object') return false
  const detail = (err as { detail?: unknown }).detail
  return (
    !!detail &&
    typeof detail === 'object' &&
    (detail as { error?: unknown }).error === 'rename_collision'
  )
}

export function useRenameJustificatif() {
  const queryClient = useQueryClient()
  return useMutation<
    { old: string; new: string; location: string; status?: string },
    Error,
    { filename: string; newFilename: string }
  >({
    mutationFn: ({ filename, newFilename }) =>
      api.post(`/justificatifs/${encodeURIComponent(filename)}/rename`, {
        new_filename: newFilename,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['ged'] })
    },
  })
}

// ─── Link integrity scan & repair ───

export interface ScanLinksResult {
  scanned: { traites: number; attente: number; op_refs: number }
  duplicates_to_delete_attente: Array<{ name: string; refs: number; hash: string }>
  misplaced_to_move_to_traites: Array<{ name: string; refs: number }>
  orphans_to_delete_traites: Array<{ name: string; hash: string }>
  orphans_to_move_to_attente: Array<{ name: string }>
  reconnectable_ventilation: Array<{
    name: string
    op_file: string
    op_index: number
    ventilation_index: number
    montant: number
    date: string
    supplier: string
  }>
  hash_conflicts: Array<{
    name: string
    hash_attente: string
    hash_traites: string
    location: string
    refs: number
  }>
  ghost_refs: Array<{ name: string; op_file: string; op_idx: number }>
}

export interface RepairLinksResult {
  deleted_from_attente: number
  moved_to_traites: number
  deleted_from_traites: number
  moved_to_attente: number
  ventilation_reconnected: number
  ghost_refs_cleared: number
  conflicts_skipped: number
  errors: string[]
}

/**
 * Dry-run scan — détecte les incohérences disque ↔ opérations sans rien modifier.
 * `enabled: false` — le composant appelle `refetch()` manuellement au clic.
 */
export function useScanLinks() {
  return useQuery<ScanLinksResult>({
    queryKey: ['justificatifs-scan-links'],
    queryFn: () => api.get('/justificatifs/scan-links'),
    enabled: false,
    staleTime: 0,
  })
}

/**
 * Apply — répare les incohérences (duplicatas, orphelins, ghosts).
 * Skippe systématiquement les conflits de hash. Invalide tous les caches concernés.
 */
export function useRepairLinks() {
  const queryClient = useQueryClient()
  return useMutation<RepairLinksResult, Error, void>({
    mutationFn: () => api.post('/justificatifs/repair-links'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['justificatifs-scan-links'] })
      queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['ged'] })
    },
  })
}
