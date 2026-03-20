import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { OCRStatus, OCRResult, OCRHistoryItem } from '@/types'

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
