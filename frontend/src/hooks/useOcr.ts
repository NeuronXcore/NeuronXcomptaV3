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
