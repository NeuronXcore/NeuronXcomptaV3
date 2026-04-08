import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { DashboardData, OperationFile, CategoryGroup, CategoryRaw, AppSettings, MLModelInfo, MLModelFull, TrainingExample, TrendRecord, AnomalyRecord, YearOverviewResponse, MLMonitoringStats, MLHealthKPI } from '@/types'

function _periodParams(year?: number | null, quarter?: number | null, month?: number | null): string {
  const params = new URLSearchParams()
  if (year != null) params.set('year', String(year))
  if (quarter != null) params.set('quarter', String(quarter))
  if (month != null) params.set('month', String(month))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function useDashboard(year?: number | null, quarter?: number | null, month?: number | null) {
  const qs = _periodParams(year, quarter, month)
  return useQuery<DashboardData>({
    queryKey: ['dashboard', year ?? 'all', quarter ?? 'all', month ?? 'all'],
    queryFn: () => api.get(`/analytics/dashboard${qs}`),
  })
}

export function useYearOverview(year: number) {
  return useQuery<YearOverviewResponse>({
    queryKey: ['year-overview', year],
    queryFn: () => api.get(`/analytics/year-overview?year=${year}`),
  })
}

export function useOperationFiles() {
  return useQuery<OperationFile[]>({
    queryKey: ['operation-files'],
    queryFn: () => api.get('/operations/files'),
  })
}

export function useCategories() {
  return useQuery<{ categories: CategoryGroup[]; raw: CategoryRaw[] }>({
    queryKey: ['categories'],
    queryFn: () => api.get('/categories'),
  })
}

export function useSettings() {
  return useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings'),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<AppSettings>) => api.put('/settings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

export function useMLModel() {
  return useQuery<MLModelInfo>({
    queryKey: ['ml-model'],
    queryFn: () => api.get('/ml/model'),
  })
}

export function useMLModelFull() {
  return useQuery<MLModelFull>({
    queryKey: ['ml-model-full'],
    queryFn: () => api.get('/ml/model/full'),
  })
}

export function useTrainingData() {
  return useQuery<{ count: number; examples: TrainingExample[] }>({
    queryKey: ['ml-training-data'],
    queryFn: () => api.get('/ml/training-data'),
  })
}

export function useMLMonitoringStats(year?: number) {
  const qs = year != null ? `?year=${year}` : ''
  return useQuery<MLMonitoringStats>({
    queryKey: ['ml-monitoring', year ?? 'all'],
    queryFn: () => api.get(`/ml/monitoring/stats${qs}`),
  })
}

export function useMLHealthKPI() {
  return useQuery<MLHealthKPI>({
    queryKey: ['ml-health'],
    queryFn: () => api.get('/ml/monitoring/health'),
    staleTime: 30_000,
  })
}

export function useCorrectionHistory() {
  return useQuery<Array<{ month: string; rate: number }>>({
    queryKey: ['ml-correction-history'],
    queryFn: () => api.get('/ml/monitoring/correction-history'),
  })
}

export function useMLBackups() {
  return useQuery<{ backups: string[] }>({
    queryKey: ['ml-backups'],
    queryFn: () => api.get('/ml/backups'),
  })
}

export function useAnalyticsTrends(months: number = 0, year?: number | null, quarter?: number | null, month?: number | null) {
  const params = new URLSearchParams()
  params.set('months', String(months))
  if (year != null) params.set('year', String(year))
  if (quarter != null) params.set('quarter', String(quarter))
  if (month != null) params.set('month', String(month))
  return useQuery<TrendRecord[]>({
    queryKey: ['analytics-trends', months, year ?? 'all', quarter ?? 'all', month ?? 'all'],
    queryFn: () => api.get(`/analytics/trends?${params.toString()}`),
  })
}

export function useAnalyticsAnomalies(threshold: number = 2.0, year?: number | null, quarter?: number | null, month?: number | null) {
  const params = new URLSearchParams()
  params.set('threshold', String(threshold))
  if (year != null) params.set('year', String(year))
  if (quarter != null) params.set('quarter', String(quarter))
  if (month != null) params.set('month', String(month))
  return useQuery<AnomalyRecord[]>({
    queryKey: ['analytics-anomalies', threshold, year ?? 'all', quarter ?? 'all', month ?? 'all'],
    queryFn: () => api.get(`/analytics/anomalies?${params.toString()}`),
  })
}

export interface CategoryDetail {
  category: string
  total_debit: number
  total_credit: number
  nb_operations: number
  subcategories: { name: string; debit: number; credit: number; count: number }[]
  monthly_evolution: { month: string; debit: number; credit: number }[]
  operations: { date: string; libelle: string; debit: number; credit: number; sous_categorie: string }[]
}

export interface CompareResult {
  period_a: { total_debit: number; total_credit: number; solde: number; nb_operations: number }
  period_b: { total_debit: number; total_credit: number; solde: number; nb_operations: number }
  delta: { total_debit: number | null; total_credit: number | null; solde: number | null; nb_operations: number | null }
  categories: {
    category: string
    a_debit: number; a_credit: number; a_ops: number
    b_debit: number; b_credit: number; b_ops: number
    delta_pct: number | null
  }[]
}

export function useComparePeriods(
  yearA: number | null, quarterA: number | null, monthA: number | null,
  yearB: number | null, quarterB: number | null, monthB: number | null,
  enabled: boolean,
) {
  const params = new URLSearchParams()
  if (yearA != null) params.set('year_a', String(yearA))
  if (quarterA != null) params.set('quarter_a', String(quarterA))
  if (monthA != null) params.set('month_a', String(monthA))
  if (yearB != null) params.set('year_b', String(yearB))
  if (quarterB != null) params.set('quarter_b', String(quarterB))
  if (monthB != null) params.set('month_b', String(monthB))
  return useQuery<CompareResult>({
    queryKey: ['analytics-compare', yearA, quarterA, monthA, yearB, quarterB, monthB],
    queryFn: () => api.get(`/analytics/compare?${params.toString()}`),
    enabled,
  })
}

export function useCategoryDetail(category: string | null, year?: number | null, quarter?: number | null, month?: number | null) {
  const params = new URLSearchParams()
  if (category) params.set('category', category)
  if (year != null) params.set('year', String(year))
  if (quarter != null) params.set('quarter', String(quarter))
  if (month != null) params.set('month', String(month))
  return useQuery<CategoryDetail>({
    queryKey: ['category-detail', category, year ?? 'all', quarter ?? 'all', month ?? 'all'],
    queryFn: () => api.get(`/analytics/category-detail?${params.toString()}`),
    enabled: !!category,
  })
}
