import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'

// ─── Legacy types (kept for backward compat) ───

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

// ─── New types ───

export interface ExportMonthStatus {
  month: number
  label: string
  nb_operations: number
  has_data: boolean
  has_pdf: boolean
  has_csv: boolean
  last_pdf_filename: string | null
  last_pdf_date: string | null
  last_csv_filename: string | null
  last_csv_date: string | null
  nb_releves: number
  nb_rapports: number
  nb_justificatifs: number
}

export interface ExportYearStatus {
  year: number
  months: ExportMonthStatus[]
}

export interface GenerateMonthResponse {
  filename: string
  title: string
  nb_operations: number
  generated: boolean
  download_url: string
  size_human?: string
  files_included?: { name: string; type: string }[]
}

export interface GenerateBatchResponse {
  zip_filename: string
  generated_count: number
  already_existed: number
  total: number
  download_url: string
}

// ─── Legacy hooks ───

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
      queryClient.invalidateQueries({ queryKey: ['export-status'] })
      queryClient.invalidateQueries({ queryKey: ['email-documents'] })
    },
  })
}

export interface ZipFileEntry {
  name: string
  size: number
  size_human: string
}

export interface AvailableReport {
  filename: string
  title: string
  auto_detected: boolean
  format: string
  year?: number
  month?: number
}

// ─── New hooks ───

export function useExportStatus(year: number) {
  return useQuery<ExportYearStatus>({
    queryKey: ['export-status', year],
    queryFn: () => api.get(`/exports/status/${year}`),
    enabled: !!year,
  })
}

export function useAvailableReports(year: number, month: number, enabled: boolean) {
  return useQuery<{ year: number; month: number; reports: AvailableReport[] }>({
    queryKey: ['available-reports', year, month],
    queryFn: () => api.get(`/exports/available-reports/${year}/${month}`),
    enabled,
  })
}

export function useGenerateMonthExport() {
  const qc = useQueryClient()
  return useMutation<GenerateMonthResponse, Error, { year: number; month: number; format: 'pdf' | 'csv'; report_filenames?: string[] | null }>({
    mutationFn: (params) => api.post('/exports/generate-month', params),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['export-status', vars.year] })
      qc.invalidateQueries({ queryKey: ['export-periods'] })
      qc.invalidateQueries({ queryKey: ['export-list'] })
    },
  })
}

export function useGenerateBatchExport() {
  const qc = useQueryClient()
  return useMutation<GenerateBatchResponse, Error, { year: number; months: number[]; format: 'pdf' | 'csv' }>({
    mutationFn: (params) => api.post('/exports/generate-batch', params),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['export-status', vars.year] })
      qc.invalidateQueries({ queryKey: ['export-periods'] })
      qc.invalidateQueries({ queryKey: ['export-list'] })
    },
  })
}

export function useExportContents(filename: string | null) {
  return useQuery<{ filename: string; files: ZipFileEntry[] }>({
    queryKey: ['export-contents', filename],
    queryFn: () => api.get(`/exports/contents/${encodeURIComponent(filename!)}`),
    enabled: !!filename,
  })
}
