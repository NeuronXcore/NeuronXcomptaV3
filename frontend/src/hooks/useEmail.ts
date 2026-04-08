import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { DocumentRef, DocumentInfo, EmailSendRequest, EmailSendResponse, EmailTestResponse, EmailPreview, EmailHistoryEntry } from '@/types'

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
