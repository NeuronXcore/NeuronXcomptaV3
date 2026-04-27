import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type {
  DocumentRef, DocumentInfo, EmailSendRequest, EmailSendResponse, EmailTestResponse,
  EmailPreview, EmailHistoryEntry, ManualPrep, ManualPrepRequest, ManualZipsStats,
} from '@/types'

export function useAvailableDocuments(type?: string, year?: number, month?: number) {
  return useQuery<DocumentInfo[]>({
    queryKey: ['email-documents', type, year, month],
    queryFn: () => {
      const params = new URLSearchParams()
      if (type) params.set('type', type)
      if (year) params.set('year', String(year))
      if (month) params.set('month', String(month))
      const qs = params.toString()
      return api.get(`/email/documents${qs ? `?${qs}` : ''}`)
    },
  })
}

export function useTestEmailConnection() {
  return useMutation<EmailTestResponse, Error>({
    mutationFn: () => api.post('/email/test-connection'),
  })
}

export function useEmailPreview() {
  return useMutation<EmailPreview, Error, { documents: DocumentRef[] }>({
    mutationFn: (data) => api.post('/email/preview', data),
  })
}

export function useSendEmail() {
  const qc = useQueryClient()
  return useMutation<EmailSendResponse, Error, EmailSendRequest>({
    mutationFn: (data) => api.post('/email/send', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-history'] })
    },
  })
}

export function useEmailHistory(year?: number) {
  return useQuery<EmailHistoryEntry[]>({
    queryKey: ['email-history', year],
    queryFn: () => {
      const params = new URLSearchParams()
      if (year) params.set('year', String(year))
      const qs = params.toString()
      return api.get(`/email/history${qs ? `?${qs}` : ''}`)
    },
  })
}

// ─── Mode envoi manuel ─────────────────────────────────────────────────

export function useManualZips() {
  return useQuery<ManualPrep[]>({
    queryKey: ['email-manual-zips'],
    queryFn: () => api.get('/email/manual-zips'),
  })
}

export function useManualZipsStats() {
  return useQuery<ManualZipsStats>({
    queryKey: ['email-manual-zips-stats'],
    queryFn: () => api.get('/email/manual-zips/stats'),
  })
}

export function usePrepareManual() {
  const qc = useQueryClient()
  return useMutation<ManualPrep, Error, ManualPrepRequest>({
    mutationFn: (req) => api.post('/email/prepare-manual', req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-manual-zips'] })
      qc.invalidateQueries({ queryKey: ['email-manual-zips-stats'] })
    },
  })
}

export function useOpenManualInFinder() {
  return useMutation<{ status: string }, Error, string>({
    mutationFn: (id) => api.post(`/email/manual-zips/${id}/open-native`),
  })
}

export function useMarkManualSent() {
  const qc = useQueryClient()
  return useMutation<EmailHistoryEntry, Error, string>({
    mutationFn: (id) => api.post(`/email/manual-zips/${id}/mark-sent`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-manual-zips'] })
      qc.invalidateQueries({ queryKey: ['email-manual-zips-stats'] })
      qc.invalidateQueries({ queryKey: ['email-history'] })
    },
  })
}

export function useDeleteManualZip() {
  const qc = useQueryClient()
  return useMutation<{ status: string }, Error, string>({
    mutationFn: (id) => api.delete(`/email/manual-zips/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-manual-zips'] })
      qc.invalidateQueries({ queryKey: ['email-manual-zips-stats'] })
    },
  })
}

export function useCleanupManualZips() {
  const qc = useQueryClient()
  return useMutation<{ removed: number; max_age_days: number }, Error, number>({
    mutationFn: (maxAgeDays) =>
      api.post(`/email/manual-zips/cleanup?max_age_days=${maxAgeDays}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-manual-zips'] })
      qc.invalidateQueries({ queryKey: ['email-manual-zips-stats'] })
    },
  })
}
