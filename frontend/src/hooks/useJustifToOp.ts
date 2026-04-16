import { useEffect, useMemo, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/api/client'
import type { JustificatifInfo, RapprochementSuggestion } from '@/types'
import { useManualAssociate, useJustificatifSuggestions } from './useRapprochement'
import { useToggleLock } from './useToggleLock'

interface UseJustifToOpArgs {
  open: boolean
  initialFilename?: string
  onClose: () => void
}

export interface UnlockTarget {
  filename: string
  index: number
}

export function useJustifToOp({ open, initialFilename, onClose }: UseJustifToOpArgs) {
  const queryClient = useQueryClient()

  // ─── State ───
  const [selectedFilename, setSelectedFilename] = useState<string | null>(
    initialFilename ?? null,
  )
  const [previewFilename, setPreviewFilename] = useState<string | null>(initialFilename ?? null)
  const [justifSearch, setJustifSearch] = useState('')

  // Édition inline OCR (champs initialisés au changement de selectedFilename)
  const [editDate, setEditDate] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editSupplier, setEditSupplier] = useState('')
  const [isSavingOcr, setIsSavingOcr] = useState(false)

  // Modale unlock
  const [unlockTarget, setUnlockTarget] = useState<UnlockTarget | null>(null)

  // ─── Sync initialFilename à l'ouverture ───
  useEffect(() => {
    if (!open) return
    if (initialFilename) {
      setSelectedFilename(initialFilename)
      setPreviewFilename(initialFilename)
    }
  }, [open, initialFilename])

  // ─── Cleanup à la fermeture ───
  useEffect(() => {
    if (!open) {
      setJustifSearch('')
      setEditDate('')
      setEditAmount('')
      setEditSupplier('')
      setUnlockTarget(null)
    }
  }, [open])

  // ─── Query liste justificatifs en attente ───
  const justifListQuery = useQuery<JustificatifInfo[]>({
    queryKey: ['justif-en-attente'],
    queryFn: () => api.get<JustificatifInfo[]>('/justificatifs/?status=en_attente'),
    enabled: open,
    staleTime: 30_000,
  })

  const justifList = justifListQuery.data ?? []

  // Filtre client (filename + supplier OCR)
  const filteredJustifs = useMemo(() => {
    const q = justifSearch.trim().toLowerCase()
    if (!q) return justifList
    return justifList.filter(j => {
      const f = j.filename.toLowerCase()
      const s = (j.ocr_supplier || '').toLowerCase()
      return f.includes(q) || s.includes(q)
    })
  }, [justifList, justifSearch])

  // Justif sélectionné (objet complet)
  const selectedJustif = useMemo<JustificatifInfo | null>(() => {
    if (!selectedFilename) return null
    return justifList.find(j => j.filename === selectedFilename) ?? null
  }, [selectedFilename, justifList])

  // ─── Initialise les champs édition OCR au changement de justif sélectionné ───
  useEffect(() => {
    if (!selectedJustif) {
      setEditDate('')
      setEditAmount('')
      setEditSupplier('')
      return
    }
    setEditDate(selectedJustif.ocr_date ?? '')
    setEditAmount(selectedJustif.ocr_amount != null ? String(selectedJustif.ocr_amount) : '')
    setEditSupplier(selectedJustif.ocr_supplier ?? '')
  }, [selectedJustif])

  // ─── Auto-sélection 1re ligne si selectedFilename obsolète après refetch ───
  useEffect(() => {
    if (!open || filteredJustifs.length === 0) return
    const stillValid = selectedFilename && filteredJustifs.some(j => j.filename === selectedFilename)
    if (!stillValid) {
      setSelectedFilename(filteredJustifs[0].filename)
    }
  }, [open, filteredJustifs, selectedFilename])

  // ─── Suggestions ops candidates ───
  const suggestionsQuery = useJustificatifSuggestions(selectedFilename)
  const suggestions: RapprochementSuggestion[] = suggestionsQuery.data ?? []
  const isLoadingSuggestions = suggestionsQuery.isLoading

  // ─── Mutation association ───
  const associateMutation = useManualAssociate()

  const goToNextJustif = useCallback((): boolean => {
    if (!selectedFilename || filteredJustifs.length === 0) return false
    const idx = filteredJustifs.findIndex(j => j.filename === selectedFilename)
    if (idx === -1 || idx >= filteredJustifs.length - 1) {
      return false
    }
    const next = filteredJustifs[idx + 1]
    setSelectedFilename(next.filename)
    setPreviewFilename(next.filename)
    return true
  }, [selectedFilename, filteredJustifs])

  const goToPrevJustif = useCallback((): boolean => {
    if (!selectedFilename || filteredJustifs.length === 0) return false
    const idx = filteredJustifs.findIndex(j => j.filename === selectedFilename)
    if (idx <= 0) return false
    const prev = filteredJustifs[idx - 1]
    setSelectedFilename(prev.filename)
    setPreviewFilename(prev.filename)
    return true
  }, [selectedFilename, filteredJustifs])

  const associate = useCallback(
    (suggestion: RapprochementSuggestion): Promise<boolean> => {
      if (!selectedFilename) return Promise.resolve(false)
      return associateMutation
        .mutateAsync({
          justificatif_filename: selectedFilename,
          operation_file: suggestion.operation_file,
          operation_index: suggestion.operation_index,
          rapprochement_score: suggestion.score?.total ?? undefined,
          ventilation_index: suggestion.ventilation_index ?? null,
        })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['justif-en-attente'] })
          toast.success('Justificatif associé')
          return true
        })
        .catch((err: unknown) => {
          const status = (err as { response?: { status?: number } })?.response?.status
          if (status === 423) {
            toast.error("Opération verrouillée — déverrouillez d'abord")
          } else {
            toast.error("Erreur lors de l'association")
          }
          return false
        })
    },
    [selectedFilename, associateMutation, queryClient],
  )

  // ─── Mutation unlock ───
  const unlockMutation = useToggleLock()

  const requestUnlock = useCallback((op: RapprochementSuggestion) => {
    setUnlockTarget({ filename: op.operation_file, index: op.operation_index })
  }, [])

  const cancelUnlock = useCallback(() => {
    setUnlockTarget(null)
  }, [])

  const confirmUnlock = useCallback(() => {
    if (!unlockTarget) return
    unlockMutation.mutate(
      { filename: unlockTarget.filename, index: unlockTarget.index, locked: false },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: ['rapprochement-just-suggestions', selectedFilename],
          })
          toast.success('Opération déverrouillée')
          setUnlockTarget(null)
        },
        onError: () => {
          toast.error('Erreur lors du déverrouillage')
          setUnlockTarget(null)
        },
      },
    )
  }, [unlockTarget, unlockMutation, queryClient, selectedFilename])

  // ─── Édition OCR inline ───
  const initialEditDate = selectedJustif?.ocr_date ?? ''
  const initialEditAmount = selectedJustif?.ocr_amount != null ? String(selectedJustif.ocr_amount) : ''
  const initialEditSupplier = selectedJustif?.ocr_supplier ?? ''

  const canSaveOcr = useMemo(() => {
    if (!selectedFilename) return false
    return (
      editDate.trim() !== initialEditDate.trim() ||
      editAmount.trim() !== initialEditAmount.trim() ||
      editSupplier.trim() !== initialEditSupplier.trim()
    )
  }, [
    selectedFilename,
    editDate,
    editAmount,
    editSupplier,
    initialEditDate,
    initialEditAmount,
    initialEditSupplier,
  ])

  const saveOcrEdit = useCallback(async (): Promise<void> => {
    if (!selectedFilename || !canSaveOcr) return
    setIsSavingOcr(true)
    try {
      const payload: Record<string, unknown> = {}
      if (editDate.trim() !== initialEditDate.trim()) {
        payload.best_date = editDate.trim() || null
      }
      if (editAmount.trim() !== initialEditAmount.trim()) {
        const parsed = editAmount.trim() ? parseFloat(editAmount.replace(',', '.')) : null
        payload.best_amount = parsed != null && isNaN(parsed) ? null : parsed
      }
      if (editSupplier.trim() !== initialEditSupplier.trim()) {
        payload.supplier = editSupplier.trim() || null
      }
      await api.patch(`/ocr/${encodeURIComponent(selectedFilename)}/extracted-data`, payload)
      // Recharger les suggestions et la liste
      await queryClient.invalidateQueries({
        queryKey: ['rapprochement-just-suggestions', selectedFilename],
      })
      await queryClient.invalidateQueries({ queryKey: ['justif-en-attente'] })
      await queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
      toast.success('Données OCR corrigées — suggestions rechargées')
    } catch {
      toast.error('Erreur lors de la correction OCR')
    } finally {
      setIsSavingOcr(false)
    }
  }, [
    selectedFilename,
    canSaveOcr,
    editDate,
    editAmount,
    editSupplier,
    initialEditDate,
    initialEditAmount,
    initialEditSupplier,
    queryClient,
  ])

  // ─── Toggle preview ───
  const togglePreview = useCallback((filename: string) => {
    setPreviewFilename(prev => (prev === filename ? null : filename))
  }, [])

  // ─── Stats ───
  const currentIdx = useMemo(() => {
    if (!selectedFilename) return -1
    return filteredJustifs.findIndex(j => j.filename === selectedFilename)
  }, [selectedFilename, filteredJustifs])

  // Avertir si plus rien à traiter (utilisé par le composant pour fermer)
  const isEmpty = !justifListQuery.isLoading && filteredJustifs.length === 0

  return {
    // Liste
    filteredJustifs,
    isLoadingJustifs: justifListQuery.isLoading,
    isEmpty,
    justifSearch,
    setJustifSearch,
    // Sélection
    selectedFilename,
    selectedJustif,
    setSelectedFilename,
    currentIdx,
    // Suggestions
    suggestions,
    isLoadingSuggestions,
    // Mutations
    associate,
    associateLoading: associateMutation.isPending,
    goToNextJustif,
    goToPrevJustif,
    // Preview
    previewFilename,
    togglePreview,
    setPreviewFilename,
    // Édition OCR
    editDate,
    setEditDate,
    editAmount,
    setEditAmount,
    editSupplier,
    setEditSupplier,
    canSaveOcr,
    saveOcrEdit,
    isSavingOcr,
    // Unlock
    unlockTarget,
    requestUnlock,
    cancelUnlock,
    confirmUnlock,
    unlockLoading: unlockMutation.isPending,
    // Onclose passé pour goToNextJustif → fin de liste
    onClose,
  }
}
