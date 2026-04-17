import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import type {
  Operation,
  VentilationLine,
  JustificatifSuggestion,
  JustificatifInfo,
} from '@/types'

export type RapprochementWorkflowMode = 'all' | 'single'

interface UseRapprochementWorkflowProps {
  operations: Operation[]
  initialIndex?: number
  initialVentilationIndex?: number
  isOpen: boolean
  fallbackFilename?: string
}

interface AttribuerPayload {
  justificatif_filename: string
  operation_file: string
  operation_index: number
  rapprochement_score?: number
  ventilation_index?: number
}

// Les ops provenant de useJustificatifsPage sont enrichies avec _filename + _originalIndex.
// Les ops provenant d'EditorPage sont brutes (pas d'enrichment) — index tableau = index JSON.
interface EnrichedOp extends Operation {
  _filename?: string
  _originalIndex?: number
}

function getOpFilename(op: Operation | null | undefined, fallback?: string): string {
  if (!op) return fallback ?? ''
  const enriched = op as EnrichedOp
  return enriched._filename ?? op._sourceFile ?? fallback ?? ''
}

function getOpBackendIndex(op: Operation | null | undefined, fallbackIdx: number): number {
  if (!op) return fallbackIdx
  const enriched = op as EnrichedOp
  return typeof enriched._originalIndex === 'number' ? enriched._originalIndex : fallbackIdx
}

function isOpUnmatched(op: Operation | undefined): boolean {
  if (!op) return false
  // Op ventilée : unmatched si au moins une sous-ligne n'a pas de justif.
  // Le champ parent `Lien justificatif` est legacy et peut pointer vers la
  // 1re sous-ligne associée — ne pas s'y fier quand la ventilation existe.
  const vlines = (op as Operation & { ventilation?: { justificatif?: string | null }[] }).ventilation
  if (Array.isArray(vlines) && vlines.length > 0) {
    return vlines.some((vl) => !vl?.justificatif || String(vl.justificatif).trim() === '')
  }
  const lien = op['Lien justificatif']
  return !lien || lien.trim() === ''
}

export function useRapprochementWorkflow({
  operations,
  initialIndex,
  initialVentilationIndex,
  isOpen,
  fallbackFilename,
}: UseRapprochementWorkflowProps) {
  const queryClient = useQueryClient()

  // ── Mode ──
  const [mode, setMode] = useState<RapprochementWorkflowMode>(
    initialIndex !== undefined ? 'single' : 'all',
  )

  // ── Unmatched indices ──
  const unmatchedIndices = useMemo(() => {
    const out: number[] = []
    operations.forEach((op, idx) => {
      if (isOpUnmatched(op)) out.push(idx)
    })
    return out
  }, [operations])

  // ── Current index ──
  const firstUnmatched = unmatchedIndices[0] ?? 0
  const [currentIndex, setCurrentIndex] = useState<number>(
    initialIndex ?? firstUnmatched,
  )

  // Sync when initialIndex changes (new opening) or operations array replaced
  useEffect(() => {
    if (!isOpen) return
    if (initialIndex !== undefined) {
      setCurrentIndex(initialIndex)
      setMode('single')
    } else {
      setCurrentIndex((prev) => {
        if (prev >= 0 && prev < operations.length) return prev
        return unmatchedIndices[0] ?? 0
      })
      setMode('all')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIndex, isOpen])

  // ── Done counter ──
  const [doneCount, setDoneCount] = useState(0)
  useEffect(() => {
    if (isOpen) setDoneCount(0)
  }, [isOpen])

  // ── Current operation ──
  const currentOp: Operation | null = operations[currentIndex] ?? null
  const currentFile = getOpFilename(currentOp, fallbackFilename)
  // Index transmis au backend : pour les ops enrichies (JustificatifsPage), utiliser
  // _originalIndex. Sinon (EditorPage, ops brutes), utiliser currentIndex qui est déjà l'index JSON.
  const backendOpIndex = getOpBackendIndex(currentOp, currentIndex)
  const totalOps = operations.length
  const unmatchedCount = unmatchedIndices.length

  const isCurrentDone = !isOpUnmatched(currentOp ?? undefined)

  const canPrev = mode === 'all' && currentIndex > 0
  const canNext = mode === 'all' && currentIndex < operations.length - 1

  // ── Ventilation ──
  const ventilationLines: VentilationLine[] = useMemo(
    () => (currentOp?.ventilation ?? []) as VentilationLine[],
    [currentOp],
  )
  const currentOpVentilated = ventilationLines.length >= 2
  const [selectedVentilationIndex, setSelectedVentilationIndex] = useState<number | null>(
    initialVentilationIndex ?? null,
  )

  // ── Search query (debounced) ──
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  // ── Selected suggestion ──
  const [selectedSuggestion, setSelectedSuggestion] =
    useState<JustificatifSuggestion | null>(null)

  // ── Reset dependent state when currentIndex changes ──
  useEffect(() => {
    setSelectedVentilationIndex(initialVentilationIndex ?? null)
    setSearchQuery('')
    setDebouncedSearch('')
    setSelectedSuggestion(null)
  }, [currentIndex, initialVentilationIndex])

  // ── Suggestions query ──
  const suggestionsQueryParams = useMemo(() => {
    const p = new URLSearchParams()
    if (selectedVentilationIndex !== null)
      p.set('ventilation_index', String(selectedVentilationIndex))
    if (debouncedSearch.trim().length >= 2) p.set('search', debouncedSearch.trim())
    const qs = p.toString()
    return qs ? `?${qs}` : ''
  }, [selectedVentilationIndex, debouncedSearch])

  const suggestionsEnabled =
    isOpen && !!currentFile && backendOpIndex >= 0 && !!currentOp

  const suggestionsQuery = useQuery<JustificatifSuggestion[]>({
    queryKey: [
      'rapprochement-workflow-suggestions',
      currentFile,
      backendOpIndex,
      selectedVentilationIndex,
      debouncedSearch,
    ],
    queryFn: () =>
      api.get(
        `/rapprochement/${encodeURIComponent(currentFile)}/${backendOpIndex}/suggestions${suggestionsQueryParams}`,
      ),
    enabled: suggestionsEnabled,
    staleTime: 60_000,
  })

  const suggestions = suggestionsQuery.data ?? []
  const suggestionsLoading = suggestionsQuery.isLoading

  // Auto-select first suggestion when list arrives
  useEffect(() => {
    if (suggestions.length > 0 && !selectedSuggestion) {
      setSelectedSuggestion(suggestions[0])
    }
  }, [suggestions, selectedSuggestion])

  // ── Prefetch N+1 : précharger la prochaine op non matchée pour fluidifier le flux ──
  useEffect(() => {
    if (!isOpen || mode !== 'all') return
    const nextUnmatched =
      unmatchedIndices.find((i) => i > currentIndex) ?? unmatchedIndices[0]
    if (nextUnmatched == null || nextUnmatched === currentIndex) return
    const nextOp = operations[nextUnmatched]
    if (!nextOp) return
    const nextFile = getOpFilename(nextOp, fallbackFilename)
    if (!nextFile) return
    const nextBackendIdx = getOpBackendIndex(nextOp, nextUnmatched)
    queryClient.prefetchQuery({
      queryKey: [
        'rapprochement-workflow-suggestions',
        nextFile,
        nextBackendIdx,
        null,
        '',
      ],
      queryFn: () =>
        api.get(
          `/rapprochement/${encodeURIComponent(nextFile)}/${nextBackendIdx}/suggestions`,
        ),
      staleTime: 60_000,
    })
  }, [isOpen, mode, currentIndex, unmatchedIndices, operations, fallbackFilename, queryClient])

  // ── Free search across pending justificatifs ──
  const searchEnabled = isOpen && debouncedSearch.trim().length >= 2
  const searchQueryResult = useQuery<JustificatifInfo[]>({
    queryKey: ['justificatifs-en-attente-search', debouncedSearch],
    queryFn: () => {
      const p = new URLSearchParams()
      p.set('status', 'en_attente')
      p.set('search', debouncedSearch.trim())
      return api.get(`/justificatifs/?${p.toString()}`)
    },
    enabled: searchEnabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  // Recherche exclusive : retourne tous les en_attente correspondants
  // (le drawer décide d'afficher search OU suggestions, pas les deux)
  const searchResults: JustificatifInfo[] = useMemo(() => {
    if (!searchEnabled) return []
    return searchQueryResult.data ?? []
  }, [searchEnabled, searchQueryResult.data])

  const searchLoading = searchQueryResult.isLoading

  // ── Progress ──
  const progressPct = useMemo(() => {
    if (mode === 'single') return isCurrentDone ? 100 : 0
    const total = doneCount + unmatchedCount
    if (total === 0) return 0
    return Math.min(100, Math.round((doneCount / total) * 100))
  }, [mode, doneCount, unmatchedCount, isCurrentDone])

  // ── Navigation ──
  const goNext = useCallback(() => {
    if (mode !== 'all') return
    setCurrentIndex((i) => Math.min(operations.length - 1, i + 1))
  }, [mode, operations.length])

  const goPrev = useCallback(() => {
    if (mode !== 'all') return
    setCurrentIndex((i) => Math.max(0, i - 1))
  }, [mode])

  const skipToNextUnmatched = useCallback(() => {
    if (mode !== 'all') return
    const next = unmatchedIndices.find((i) => i > currentIndex)
    if (next !== undefined) {
      setCurrentIndex(next)
    } else {
      const first = unmatchedIndices[0]
      if (first !== undefined && first !== currentIndex) setCurrentIndex(first)
    }
  }, [mode, unmatchedIndices, currentIndex])

  // ── Attribution mutation ──
  const attribuerMutation = useMutation({
    mutationFn: (payload: AttribuerPayload) =>
      api.post('/rapprochement/associate-manual', payload),
    onSuccess: () => {
      setDoneCount((c) => c + 1)
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-workflow-suggestions'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-unmatched'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-op-suggestions'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-batch-hints'] })
      queryClient.invalidateQueries({ queryKey: ['rapprochement-batch-just-scores'] })
      queryClient.invalidateQueries({ queryKey: ['pipeline'] })
      queryClient.invalidateQueries({ queryKey: ['cloture'] })
    },
  })

  const attribuer = useCallback(async (): Promise<void> => {
    if (!currentOp || !selectedSuggestion || !currentFile) return
    try {
      await attribuerMutation.mutateAsync({
        justificatif_filename: selectedSuggestion.filename,
        operation_file: currentFile,
        operation_index: backendOpIndex,
        rapprochement_score: selectedSuggestion.score,
        ventilation_index:
          selectedVentilationIndex !== null ? selectedVentilationIndex : undefined,
      })
      toast.success('Justificatif attribué')
      if (mode === 'all') {
        // Defer so the just-invalidated operations prop can propagate
        setTimeout(() => skipToNextUnmatched(), 50)
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erreur lors de l'attribution",
      )
    }
  }, [
    currentOp,
    selectedSuggestion,
    currentFile,
    backendOpIndex,
    selectedVentilationIndex,
    mode,
    skipToNextUnmatched,
    attribuerMutation,
  ])

  return {
    // Navigation
    mode,
    setMode,
    currentOp,
    currentIndex,
    currentFile,
    totalOps,
    unmatchedCount,
    doneCount,
    progressPct,
    canPrev,
    canNext,
    goNext,
    goPrev,
    skipToNextUnmatched,

    // Ventilation
    currentOpVentilated,
    ventilationLines,
    selectedVentilationIndex,
    setSelectedVentilationIndex,

    // Suggestions
    suggestions,
    suggestionsLoading,
    selectedSuggestion,
    setSelectedSuggestion,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchLoading,
    isSearching: searchEnabled,

    // Actions
    attribuer,
    attribuerLoading: attribuerMutation.isPending,
    isCurrentDone,
  }
}
