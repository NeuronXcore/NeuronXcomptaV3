import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import type { ReportGalleryResponse, ReportTemplate, ReportGenerateRequest, ReportTreeResponse, ReportComparison, PendingReport } from '@/types'

export function useReportsGallery() {
  return useQuery<ReportGalleryResponse>({
    queryKey: ['reports-gallery'],
    queryFn: () => api.get('/reports/gallery'),
  })
}

export function useReportTree() {
  return useQuery<ReportTreeResponse>({
    queryKey: ['reports-tree'],
    queryFn: () => api.get('/reports/tree'),
  })
}

export function usePendingReports(year: number) {
  return useQuery<PendingReport[]>({
    queryKey: ['reports-pending', year],
    queryFn: () => api.get(`/reports/pending?year=${year}`),
  })
}

export function useReportTemplates() {
  return useQuery<ReportTemplate[]>({
    queryKey: ['reports-templates'],
    queryFn: () => api.get('/reports/templates'),
  })
}

export interface GenerateReportResult {
  filename: string
  title: string
  format: string
  nb_operations: number
  total_debit: number
  total_credit: number
  file_size_human: string
  replaced?: string
}

export function useGenerateReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ReportGenerateRequest) =>
      api.post<GenerateReportResult>('/reports/generate', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-gallery'] })
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useRegenerateReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (filename: string) =>
      api.post(`/reports/${filename}/regenerate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-gallery'] })
      toast.success('Rapport re-généré')
    },
    onError: () => toast.error('Erreur re-génération'),
  })
}

export function useUpdateReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ filename, data }: { filename: string; data: { title?: string; description?: string } }) =>
      api.put(`/reports/${filename}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-gallery'] })
      toast.success('Rapport mis à jour')
    },
  })
}

export function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (filename: string) =>
      api.post(`/reports/${filename}/favorite`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-gallery'] })
      qc.invalidateQueries({ queryKey: ['reports-tree'] })
    },
  })
}

export function useCompareReports() {
  return useMutation<ReportComparison, Error, { filename_a: string; filename_b: string }>({
    mutationFn: (data) => api.post('/reports/compare', data),
    onError: () => toast.error('Erreur comparaison'),
  })
}

export function useDeleteReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (filename: string) =>
      api.delete(`/reports/${filename}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports-gallery'] })
      toast.success('Rapport supprimé')
    },
  })
}

export function useOpenReportNative() {
  return useMutation({
    mutationFn: (filename: string) =>
      api.post(`/reports/${filename}/open-native`),
    onSuccess: () => toast.success('Rapport ouvert'),
    onError: () => toast.error("Impossible d'ouvrir le rapport"),
  })
}

export function useDeleteAllReports() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete('/reports/all'),
    onSuccess: (data: { deleted: number }) => {
      qc.invalidateQueries({ queryKey: ['reports-gallery'] })
      qc.invalidateQueries({ queryKey: ['reports-tree'] })
      toast.success(`${data.deleted} rapport${data.deleted > 1 ? 's' : ''} supprimé${data.deleted > 1 ? 's' : ''}`)
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })
}
