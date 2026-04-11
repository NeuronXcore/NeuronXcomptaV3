import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { OCRStatus, OCRResult, OCRHistoryItem, OcrManualEdit, OCRExtractedData } from '@/types'
import toast from 'react-hot-toast'

export function useOcrStatus() {
  return useQuery<OCRStatus>({
    queryKey: ['ocr-status'],
    queryFn: () => api.get('/ocr/status'),
    refetchInterval: 30000,
  })
}

export function useOcrHistory(limit: number = 20) {
  return useQuery<OCRHistoryItem[]>({
    queryKey: ['ocr-history', limit],
    queryFn: () => api.get(`/ocr/history?limit=${limit}`),
  })
}

export function useOcrResult(filename: string | null) {
  return useQuery<OCRResult>({
    queryKey: ['ocr-result', filename],
    queryFn: () => api.get(`/ocr/result/${filename}`),
    enabled: !!filename,
    retry: false,
  })
}

export function useExtractOcr() {
  const queryClient = useQueryClient()
  return useMutation<OCRResult, Error, string>({
    mutationFn: (filename: string) =>
      api.post('/ocr/extract', { filename }),
    onSuccess: (_data, filename) => {
      queryClient.invalidateQueries({ queryKey: ['ocr-result', filename] })
      queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
      queryClient.invalidateQueries({ queryKey: ['ocr-status'] })
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
    },
  })
}

export function useExtractUpload() {
  const queryClient = useQueryClient()
  return useMutation<OCRResult, Error, File>({
    mutationFn: (file: File) => api.upload('/ocr/extract-upload', file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
      queryClient.invalidateQueries({ queryKey: ['ocr-status'] })
    },
  })
}

export interface BatchUploadResult {
  filename: string
  original_name: string
  success: boolean
  ocr_success?: boolean
  ocr_data?: {
    best_amount: number | null
    best_date: string | null
    supplier: string | null
  } | null
  ocr_error?: string | null
  error?: string
}

export function useBatchUploadOcr() {
  const queryClient = useQueryClient()
  return useMutation<BatchUploadResult[], Error, File[]>({
    mutationFn: (files: File[]) => api.uploadMultiple('/ocr/batch-upload', files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
      queryClient.invalidateQueries({ queryKey: ['ocr-status'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-unmatched'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-batch-just-scores'] })
    },
  })
}

export function useUpdateOcrData() {
  const queryClient = useQueryClient()
  return useMutation<OCRExtractedData, Error, { filename: string; data: OcrManualEdit }>({
    mutationFn: ({ filename, data }) =>
      api.patch(`/ocr/${filename}/extracted-data`, data),
    onSuccess: (_data, { filename }) => {
      queryClient.invalidateQueries({ queryKey: ['ocr-result', filename] })
      queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-suggestions'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-unmatched'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-batch-just-scores'] })
      toast.success('Donnees OCR mises a jour')
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}

export function useDeleteOcrCache() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, string>({
    mutationFn: (filename: string) => api.delete(`/ocr/cache/${filename}`),
    onSuccess: (_data, filename) => {
      queryClient.invalidateQueries({ queryKey: ['ocr-result', filename] })
      queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
      queryClient.invalidateQueries({ queryKey: ['ocr-status'] })
    },
  })
}

// ─── Scan & Rename (convention filename-first) ───────────────────────────

export interface SkippedItem {
  filename: string
  supplier: string | null
  best_date: string | null
  best_amount: number | null
  amounts: number[]
  dates: string[]
  reason: 'no_ocr' | 'bad_supplier' | 'no_date_amount'
}

export interface ScanRenamePlan {
  scanned: number
  already_canonical: number
  to_rename_safe: { old: string; new: string }[]
  to_rename_ocr: { old: string; new: string; supplier_ocr: string }[]
  skipped: {
    no_ocr: SkippedItem[]
    bad_supplier: SkippedItem[]
    no_date_amount: SkippedItem[]
  }
  applied?: {
    ok: number
    errors: { old: string; new: string; error: string }[]
    renamed: Array<{ old: string; new: string; location: string }>
    auto_associated?: number       // chaîné auto-rapprochement post-rename
    strong_suggestions?: number    // matches forts non associés (ambiguïté)
  }
}

/**
 * Dry-run scan — ne modifie rien, renvoie juste le plan.
 * Pas d'invalidation de cache car aucun fichier n'est touché.
 */
export function useScanRename() {
  return useMutation<ScanRenamePlan, Error, void>({
    mutationFn: () => api.post('/justificatifs/scan-rename?apply=false'),
  })
}

/**
 * Apply scan — applique les renames SAFE (filename-parsed) et optionnellement
 * les renames OCR (opt-in via `applyOcr: true`). Invalide les caches concernés.
 */
export function useApplyScanRename() {
  const qc = useQueryClient()
  return useMutation<ScanRenamePlan, Error, { applyOcr?: boolean }>({
    mutationFn: ({ applyOcr = false }) =>
      api.post(`/justificatifs/scan-rename?apply=true&apply_ocr=${applyOcr}`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['justificatifs'] })
      qc.invalidateQueries({ queryKey: ['justificatif-stats'] })
      qc.invalidateQueries({ queryKey: ['ocr-history'] })
      qc.invalidateQueries({ queryKey: ['ocr-status'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['operations'] })  // auto-associate modifie les ops
      qc.invalidateQueries({ queryKey: ['justificatif-reverse-lookup'] })
      qc.invalidateQueries({ queryKey: ['justificatif-operation-suggestions'] })
      const ok = data.applied?.ok ?? 0
      const errs = data.applied?.errors?.length ?? 0
      const autoAssoc = data.applied?.auto_associated ?? 0
      const strongSugg = data.applied?.strong_suggestions ?? 0
      if (ok > 0) {
        // Message enrichi : rename + auto-association chainée
        let msg = `${ok} renommé(s)`
        if (autoAssoc > 0) msg += ` · ${autoAssoc} auto-associé(s)`
        if (strongSugg > 0) msg += ` · ${strongSugg} suggestion(s) forte(s)`
        toast.success(msg)
      } else {
        toast('Aucun renommage appliqué', { icon: 'ℹ️' })
      }
      if (errs > 0) {
        toast.error(`${errs} erreur(s) lors du renommage`)
      }
    },
    onError: (err) => toast.error(err.message),
  })
}
