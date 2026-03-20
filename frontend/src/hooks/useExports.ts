import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'

export interface ExportPeriod {
  year: number
  month: number
  month_name: string
  filename: string
  count: number
  total_debit: number
  total_credit: number
  has_export: boolean
  justificatif_ratio: number
}

export interface ExportFile {
  filename: string
  year: number | null
  month: number | null
  month_name: string
  size: number
  size_human: string
  created: string
}

export interface ExportResult {
  filename: string
  year: number
  month: number
  month_name: string
  size: number
  size_human: string
  operations_count: number
  total_debit: number
  total_credit: number
  solde: number
  justificatif_count: number
  files_included: { name: string; type: string }[]
  created: string
}

interface GenerateExportParams {
  year: number
  month: number
  include_csv: boolean
  include_pdf: boolean
  include_excel: boolean
  include_bank_statement: boolean
  include_justificatifs: boolean
  include_reports: boolean
}

export function useExportPeriods() {
  return useQuery<{ periods: ExportPeriod[]; years: number[] }>({
    queryKey: ['export-periods'],
    queryFn: () => api.get('/exports/periods'),
  })
}

export function useExportList() {
  return useQuery<ExportFile[]>({
    queryKey: ['export-list'],
    queryFn: () => api.get('/exports/list'),
  })
}

export function useGenerateExport() {
  const queryClient = useQueryClient()
  return useMutation<ExportResult, Error, GenerateExportParams>({
    mutationFn: (params) => api.post('/exports/generate', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['export-periods'] })
      queryClient.invalidateQueries({ queryKey: ['export-list'] })
    },
  })
}

export function useDeleteExport() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, string>({
    mutationFn: (filename) => api.delete(`/exports/${encodeURIComponent(filename)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['export-periods'] })
      queryClient.invalidateQueries({ queryKey: ['export-list'] })
    },
  })
}
