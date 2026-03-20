import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { DashboardData, OperationFile, CategoryGroup, CategoryRaw, AppSettings, MLModelInfo, MLModelFull, TrainingExample, TrendRecord, AnomalyRecord } from '@/types'

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/analytics/dashboard'),
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

export function useMLBackups() {
  return useQuery<{ backups: string[] }>({
    queryKey: ['ml-backups'],
    queryFn: () => api.get('/ml/backups'),
  })
}

export function useAnalyticsTrends(months: number = 0) {
  return useQuery<TrendRecord[]>({
    queryKey: ['analytics-trends', months],
    queryFn: () => api.get(`/analytics/trends?months=${months}`),
  })
}

export function useAnalyticsAnomalies(threshold: number = 2.0) {
  return useQuery<AnomalyRecord[]>({
    queryKey: ['analytics-anomalies', threshold],
    queryFn: () => api.get(`/analytics/anomalies?threshold=${threshold}`),
  })
}
