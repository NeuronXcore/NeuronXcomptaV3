import { useMemo } from 'react'
import { useAnnualStatus } from './useCloture'
import { useOperations } from './useOperations'
import { useCategories } from './useApi'
import type { Operation, CategoryGroup, MonthStatus } from '@/types'

export interface PipelineStepData {
  name: string
  ok: number
  total: number
  percent: number
  status: 'complete' | 'partial' | 'low' | 'empty'
}

export interface PipelineData {
  month: number
  year: number
  filename: string | null
  globalProgress: number
  steps: PipelineStepData[]
  uncategorized: Operation[]
  unmatched: Operation[]
  unlettered: Operation[]
  categories: CategoryGroup[]
  monthStatus: MonthStatus | null
  isLoading: boolean
}

function computeStatus(percent: number): PipelineStepData['status'] {
  if (percent >= 100) return 'complete'
  if (percent > 50) return 'partial'
  if (percent > 0) return 'low'
  return 'empty'
}

export function usePipeline(year: number, month: number): PipelineData {
  const { data: annualData, isLoading: loadingCloture } = useAnnualStatus(year)
  const { data: categoriesData, isLoading: loadingCategories } = useCategories()

  const monthStatus = useMemo(() => {
    if (!annualData) return null
    return annualData.find((m) => m.mois === month) ?? null
  }, [annualData, month])

  const filename = monthStatus?.filename ?? null

  const { data: operations, isLoading: loadingOps } = useOperations(filename)

  const isLoading = loadingCloture || loadingCategories || (!!filename && loadingOps)

  const uncategorized = useMemo(() => {
    if (!operations) return []
    return operations
      .map((op, i) => ({ ...op, _index: op._index ?? i }))
      .filter((op) => !op['Catégorie'])
  }, [operations])

  const unmatched = useMemo(() => {
    if (!operations) return []
    return operations
      .map((op, i) => ({ ...op, _index: op._index ?? i }))
      .filter((op) => !op.Justificatif)
  }, [operations])

  const unlettered = useMemo(() => {
    if (!operations) return []
    return operations
      .map((op, i) => ({ ...op, _index: op._index ?? i }))
      .filter((op) => !op.lettre)
  }, [operations])

  const steps = useMemo((): PipelineStepData[] => {
    const total = monthStatus?.nb_operations ?? 0
    const hasReleve = monthStatus?.has_releve ?? false

    const relevePercent = hasReleve ? 100 : 0
    const verificationPercent = hasReleve ? 100 : 0

    const nbCategorized = total - (uncategorized.length)
    const catPercent = total > 0 ? Math.round((nbCategorized / total) * 100) : 0

    const nbJustifies = total - (unmatched.length)
    const justPercent = total > 0 ? Math.round((nbJustifies / total) * 100) : 0

    const nbLettrees = total - (unlettered.length)
    const lettragePercent = total > 0 ? Math.round((nbLettrees / total) * 100) : 0

    const cloturePercent = catPercent >= 100 && justPercent >= 100 && lettragePercent >= 100 ? 100 : 0

    return [
      { name: 'Relevé importé', ok: hasReleve ? 1 : 0, total: 1, percent: relevePercent, status: computeStatus(relevePercent) },
      { name: 'Vérification', ok: hasReleve ? total : 0, total: total || 1, percent: verificationPercent, status: computeStatus(verificationPercent) },
      { name: 'Catégorisation', ok: nbCategorized, total, percent: catPercent, status: computeStatus(catPercent) },
      { name: 'Justificatifs', ok: nbJustifies, total, percent: justPercent, status: computeStatus(justPercent) },
      { name: 'Lettrage', ok: nbLettrees, total, percent: lettragePercent, status: computeStatus(lettragePercent) },
      { name: 'Clôture', ok: cloturePercent >= 100 ? 1 : 0, total: 1, percent: cloturePercent, status: computeStatus(cloturePercent) },
    ]
  }, [monthStatus, uncategorized.length, unmatched.length, unlettered.length])

  const globalProgress = useMemo(() => {
    if (steps.length === 0) return 0
    const weights = [0.10, 0.05, 0.30, 0.25, 0.25, 0.05]
    return Math.round(
      steps.reduce((acc, step, i) => acc + step.percent * weights[i], 0)
    )
  }, [steps])

  return {
    month,
    year,
    filename,
    globalProgress,
    steps,
    uncategorized,
    unmatched,
    unlettered,
    categories: categoriesData?.categories ?? [],
    monthStatus,
    isLoading,
  }
}
