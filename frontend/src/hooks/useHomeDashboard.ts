import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useDashboard, useAnalyticsTrends, useAnalyticsAnomalies, useMLModel } from '@/hooks/useApi'
import { useJustificatifStats } from '@/hooks/useJustificatifs'
import { useAnnualStatus, useClotureYears } from '@/hooks/useCloture'
import type { CategorySummary } from '@/types'

export function useHomeDashboard() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

  const dashboard = useDashboard(selectedYear)
  const trends = useAnalyticsTrends(12, selectedYear)
  const anomalies = useAnalyticsAnomalies(2.0, selectedYear)
  const justifStats = useJustificatifStats()
  const mlModel = useMLModel()
  const clotureYears = useClotureYears()
  const cloture = useAnnualStatus(selectedYear)

  const summary = useQuery<CategorySummary[]>({
    queryKey: ['analytics-summary', selectedYear],
    queryFn: () => api.get(`/analytics/summary?year=${selectedYear}`),
    staleTime: 60_000,
  })

  const isLoading =
    dashboard.isLoading ||
    trends.isLoading ||
    anomalies.isLoading ||
    justifStats.isLoading ||
    mlModel.isLoading ||
    cloture.isLoading ||
    summary.isLoading

  return {
    dashboard: dashboard.data,
    trends: trends.data,
    summary: summary.data,
    anomalies: anomalies.data,
    justifStats: justifStats.data,
    mlModel: mlModel.data,
    cloture: cloture.data,
    availableYears: clotureYears.data ?? [],
    selectedYear,
    setSelectedYear,
    isLoading,
    isClotureLoading: cloture.isLoading,
  }
}
