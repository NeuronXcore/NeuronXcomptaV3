import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'

export interface SuggestionFilters {
  montantMin: string
  montantMax: string
  dateFrom: string
  dateTo: string
  search: string
}

export interface JustificatifSuggestion {
  filename: string
  ocr_date: string
  ocr_montant: number | null
  ocr_fournisseur: string
  score: number
  size_human: string
}

const EMPTY_FILTERS: SuggestionFilters = {
  montantMin: '',
  montantMax: '',
  dateFrom: '',
  dateTo: '',
  search: '',
}

export function useRapprochementManuel(
  filename: string | null,
  index: number | null,
  ventilationIndex: number | null = null,
) {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<SuggestionFilters>({ ...EMPTY_FILTERS })

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.montantMin) params.set('montant_min', filters.montantMin)
    if (filters.montantMax) params.set('montant_max', filters.montantMax)
    if (filters.dateFrom) params.set('date_from', filters.dateFrom)
    if (filters.dateTo) params.set('date_to', filters.dateTo)
    if (filters.search) params.set('search', filters.search)
    if (ventilationIndex !== null) params.set('ventilation_index', String(ventilationIndex))
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }, [filters, ventilationIndex])

  const suggestions = useQuery<JustificatifSuggestion[]>({
    queryKey: ['rapprochement-suggestions', filename, index, queryParams],
    queryFn: () =>
      api.get(`/rapprochement/${filename}/${index}/suggestions${queryParams}`),
    enabled: !!filename && index !== null && index >= 0,
  })

  const associate = useMutation({
    mutationFn: (data: {
      operation_index: number
      justificatif_filename: string
      rapprochement_score?: number
      ventilation_index?: number
    }) =>
      api.post('/rapprochement/associate-manual', {
        justificatif_filename: data.justificatif_filename,
        operation_file: filename,
        operation_index: data.operation_index,
        rapprochement_score: data.rapprochement_score,
        ventilation_index: data.ventilation_index,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rapprochement'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-suggestions'] })
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-unmatched'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-batch-hints'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-batch-just-scores'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-op-suggestions'] })
    },
  })

  const updateFilter = (key: keyof SuggestionFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const resetFilters = () => {
    setFilters({ ...EMPTY_FILTERS })
  }

  return {
    filters,
    updateFilter,
    resetFilters,
    suggestions: suggestions.data ?? [],
    isLoading: suggestions.isLoading,
    associate,
  }
}
