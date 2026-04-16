import { useMemo, useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '@/api/client'
import type { Operation, JustificatifSuggestion, JustificatifInfo, OperationFile } from '@/types'
import { useOperationFiles, useOperations, useYearOperations } from './useOperations'
import { useManualAssociate } from './useRapprochement'

/**
 * TargetedOp : forme minimale d'opération passée depuis l'appelant quand
 * l'utilisateur cible explicitement un sous-ensemble (multi-sélection).
 * Le débit est toujours positif ; les lignes créditrices sont filtrées en amont.
 */
export interface TargetedOp {
  filename: string
  index: number
  libelle: string
  montant: number // débit (>0), jamais une valeur absolue de crédit
  date: string // ISO
  categorie?: string
  sousCategorie?: string
  ventilationIndex?: number | null
}

export type ManualAssocMode = 'targeted' | 'all'

interface UseManualAssociationArgs {
  open: boolean
  year: number
  month: number | null // null = toute l'année
  targetedOps?: TargetedOp[]
}

/**
 * Op enrichie pour l'affichage côté drawer (unifie mode targeted / mode all).
 * Toutes les ops passent par cette forme pour simplifier le rendu.
 */
export interface DrawerOp {
  key: string // `${filename}:${index}` (ou `${filename}:${index}:${vlIdx}` si ventilation)
  filename: string
  index: number
  ventilationIndex: number | null
  libelle: string
  montant: number
  date: string
  categorie?: string
  sousCategorie?: string
}

/** Shape commune pour l'affichage des suggestions (normal + mode élargi). */
export interface DrawerSuggestion {
  filename: string
  ocr_date: string | null
  ocr_montant: number | null
  ocr_fournisseur: string | null
  score: number | null // null en mode élargi (pas de scoring)
  score_detail?: JustificatifSuggestion['score_detail']
  size_human?: string
}

function buildOpKey(filename: string, index: number, vlIdx: number | null): string {
  return vlIdx != null ? `${filename}:${index}:${vlIdx}` : `${filename}:${index}`
}

/**
 * Heuristique : une op a besoin d'un justificatif si elle est débitrice ET
 * n'a pas déjà de lien. Ventilation : si ventilée, on inclut les sous-lignes
 * non justifiées (le parent a `Catégorie === 'Ventilé'` et n'est pas cible direct).
 */
function isOpWithoutJustif(op: Operation): boolean {
  const debit = op['Débit'] ?? 0
  if (debit <= 0) return false
  const lien = op['Lien justificatif'] ?? ''
  if (lien.trim() !== '') return false
  return true
}

function mapInfoToSuggestion(info: JustificatifInfo): DrawerSuggestion {
  return {
    filename: info.filename,
    ocr_date: info.ocr_date ?? null,
    ocr_montant: info.ocr_amount ?? null,
    ocr_fournisseur: info.ocr_supplier ?? null,
    score: null,
    score_detail: undefined,
    size_human: info.size_human,
  }
}

function mapJustifSuggestion(s: JustificatifSuggestion): DrawerSuggestion {
  return {
    filename: s.filename,
    ocr_date: s.ocr_date || null,
    ocr_montant: s.ocr_montant,
    ocr_fournisseur: s.ocr_fournisseur || null,
    score: s.score,
    score_detail: s.score_detail,
    size_human: s.size_human,
  }
}

/** Parse "jj/mm/aaaa" → timestamp ou null si invalide. */
function parseFrDate(str: string): number | null {
  const m = str.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const dt = new Date(Number(y), Number(mo) - 1, Number(d))
  if (isNaN(dt.getTime())) return null
  return dt.getTime()
}

/** Parse "1439" ou "1439,50" ou "1439.5" → number ou null. */
function parseAmount(str: string): number | null {
  const cleaned = str.trim().replace(/\s/g, '').replace(',', '.')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

export function useManualAssociation({ open, year, month, targetedOps }: UseManualAssociationArgs) {
  // ─── Filtrage défensif des crédits côté hook ───
  const sanitizedTargetedOps = useMemo(() => {
    if (!targetedOps) return []
    return targetedOps.filter(t => t.montant > 0)
  }, [targetedOps])

  const hasTargeted = sanitizedTargetedOps.length > 0

  // ─── Mode (targeted | all) ───
  const [mode, setMode] = useState<ManualAssocMode>(hasTargeted ? 'targeted' : 'all')

  // Sync mode au changement de targetedOps (ex. ré-ouverture drawer)
  useEffect(() => {
    if (!open) return
    setMode(hasTargeted ? 'targeted' : 'all')
  }, [open, hasTargeted])

  // ─── Chargement des fichiers de l'année ───
  const { data: allFiles = [] } = useOperationFiles()

  const filesForYear = useMemo(
    () => allFiles.filter((f: OperationFile) => f.year === year),
    [allFiles, year],
  )

  // Fichier unique correspondant au mois sélectionné (mode 'all' + month != null)
  const selectedFile = useMemo(() => {
    if (month == null) return null
    return filesForYear.find((f: OperationFile) => f.month === month) ?? null
  }, [filesForYear, month])

  // ─── Chargement des ops ───
  // Mode single-file (mois sélectionné)
  const singleOpsQuery = useOperations(mode === 'all' && month != null ? selectedFile?.filename ?? null : null)
  // Mode year-wide (mois = null)
  const yearOpsQuery = useYearOperations(
    filesForYear,
    open && mode === 'all' && month == null,
  )

  // ─── Construction de la liste d'ops à afficher à gauche ───
  const opsList: DrawerOp[] = useMemo(() => {
    if (mode === 'targeted') {
      return sanitizedTargetedOps.map(t => ({
        key: buildOpKey(t.filename, t.index, t.ventilationIndex ?? null),
        filename: t.filename,
        index: t.index,
        ventilationIndex: t.ventilationIndex ?? null,
        libelle: t.libelle,
        montant: t.montant,
        date: t.date,
        categorie: t.categorie,
        sousCategorie: t.sousCategorie,
      }))
    }
    // mode === 'all'
    if (month != null) {
      if (!selectedFile || !singleOpsQuery.data) return []
      const out: DrawerOp[] = []
      singleOpsQuery.data.forEach((op, idx) => {
        if (!isOpWithoutJustif(op)) return
        // Ventilation : si l'op est ventilée (Catégorie === 'Ventilé'), on itère les sous-lignes non justifiées
        if (op['Catégorie'] === 'Ventilé' && Array.isArray(op.ventilation) && op.ventilation.length > 0) {
          op.ventilation.forEach(vl => {
            if (vl.justificatif && vl.justificatif.trim() !== '') return
            if ((vl.montant ?? 0) <= 0) return
            out.push({
              key: buildOpKey(selectedFile.filename, idx, vl.index),
              filename: selectedFile.filename,
              index: idx,
              ventilationIndex: vl.index,
              libelle: `${op['Libellé'] ?? ''} · ${vl.libelle || `L${vl.index + 1}`}`,
              montant: vl.montant,
              date: op.Date ?? '',
              categorie: vl.categorie,
              sousCategorie: vl.sous_categorie,
            })
          })
          return
        }
        out.push({
          key: buildOpKey(selectedFile.filename, idx, null),
          filename: selectedFile.filename,
          index: idx,
          ventilationIndex: null,
          libelle: op['Libellé'] ?? '',
          montant: op['Débit'] ?? 0,
          date: op.Date ?? '',
          categorie: op['Catégorie'],
          sousCategorie: op['Sous-catégorie'],
        })
      })
      return out
    }
    // mode === 'all' + month === null → year-wide
    if (!yearOpsQuery.data) return []
    const out: DrawerOp[] = []
    yearOpsQuery.data.forEach(op => {
      if (!isOpWithoutJustif(op)) return
      const srcFile = op._sourceFile ?? ''
      const srcIdx = op._index ?? -1
      if (!srcFile || srcIdx < 0) return
      if (op['Catégorie'] === 'Ventilé' && Array.isArray(op.ventilation) && op.ventilation.length > 0) {
        op.ventilation.forEach(vl => {
          if (vl.justificatif && vl.justificatif.trim() !== '') return
          if ((vl.montant ?? 0) <= 0) return
          out.push({
            key: buildOpKey(srcFile, srcIdx, vl.index),
            filename: srcFile,
            index: srcIdx,
            ventilationIndex: vl.index,
            libelle: `${op['Libellé'] ?? ''} · ${vl.libelle || `L${vl.index + 1}`}`,
            montant: vl.montant,
            date: op.Date ?? '',
            categorie: vl.categorie,
            sousCategorie: vl.sous_categorie,
          })
        })
        return
      }
      out.push({
        key: buildOpKey(srcFile, srcIdx, null),
        filename: srcFile,
        index: srcIdx,
        ventilationIndex: null,
        libelle: op['Libellé'] ?? '',
        montant: op['Débit'] ?? 0,
        date: op.Date ?? '',
        categorie: op['Catégorie'],
        sousCategorie: op['Sous-catégorie'],
      })
    })
    return out
  }, [mode, sanitizedTargetedOps, month, selectedFile, singleOpsQuery.data, yearOpsQuery.data])

  const isLoadingOps = useMemo(() => {
    if (mode === 'targeted') return false
    if (month != null) return singleOpsQuery.isLoading
    return yearOpsQuery.isLoading
  }, [mode, month, singleOpsQuery.isLoading, yearOpsQuery.isLoading])

  // ─── Recherche panel gauche ───
  const [opSearch, setOpSearch] = useState('')

  const filteredOpsList = useMemo(() => {
    const q = opSearch.trim().toLowerCase()
    if (!q) return opsList
    return opsList.filter(o => o.libelle.toLowerCase().includes(q))
  }, [opsList, opSearch])

  // ─── Op sélectionnée ───
  const [selectedOpKey, setSelectedOpKey] = useState<string | null>(null)

  // Auto-sélection de la 1re op quand la liste change (ou au montage)
  useEffect(() => {
    if (!open) return
    if (!filteredOpsList.length) {
      setSelectedOpKey(null)
      return
    }
    const stillValid = selectedOpKey && filteredOpsList.some(o => o.key === selectedOpKey)
    if (!stillValid) {
      setSelectedOpKey(filteredOpsList[0].key)
    }
  }, [open, filteredOpsList, selectedOpKey])

  const selectedOp = useMemo<DrawerOp | null>(() => {
    if (!selectedOpKey) return null
    return opsList.find(o => o.key === selectedOpKey) ?? null
  }, [selectedOpKey, opsList])

  // ─── Filtres libres + preview ───
  const [filterDate, setFilterDate] = useState('')
  const [filterDateTol, setFilterDateTol] = useState(7)
  const [filterAmount, setFilterAmount] = useState('')
  const [filterAmountTol, setFilterAmountTol] = useState(50)
  const [broadMode, setBroadMode] = useState(false)
  const [previewFilename, setPreviewFilename] = useState<string | null>(null)

  // Reset filtres + preview au changement d'op
  useEffect(() => {
    setPreviewFilename(null)
    setFilterDate('')
    setFilterAmount('')
  }, [selectedOpKey])

  // Reset broadMode à la fermeture
  useEffect(() => {
    if (!open) {
      setBroadMode(false)
      setOpSearch('')
    }
  }, [open])

  // ─── Query suggestions ───
  const suggestionsQuery = useQuery<DrawerSuggestion[]>({
    queryKey: [
      'manual-assoc-suggestions',
      selectedOp?.filename ?? null,
      selectedOp?.index ?? null,
      selectedOp?.ventilationIndex ?? null,
      broadMode,
    ],
    queryFn: async () => {
      if (broadMode) {
        const items = await api.get<JustificatifInfo[]>('/justificatifs/?status=en_attente')
        return items.map(mapInfoToSuggestion)
      }
      if (!selectedOp) return []
      const p = new URLSearchParams()
      if (selectedOp.ventilationIndex != null) {
        p.set('ventilation_index', String(selectedOp.ventilationIndex))
      }
      const qs = p.toString()
      const items = await api.get<JustificatifSuggestion[]>(
        `/rapprochement/${encodeURIComponent(selectedOp.filename)}/${selectedOp.index}/suggestions${qs ? `?${qs}` : ''}`,
      )
      return items.map(mapJustifSuggestion)
    },
    enabled: open && (broadMode || !!selectedOp),
    staleTime: 30_000,
  })

  const suggestions = suggestionsQuery.data ?? []
  const isLoadingSuggestions = suggestionsQuery.isLoading

  // ─── Filtre libre frontend (spec prompt §3) ───
  const filteredSuggestions = useMemo(() => {
    let list = [...suggestions]
    const targetDate = filterDate ? parseFrDate(filterDate) : null
    if (targetDate != null) {
      const tolMs = filterDateTol * 86_400_000
      list = list.filter(s => {
        if (!s.ocr_date) return true // pas d'OCR date → on garde
        const sd = new Date(s.ocr_date).getTime()
        if (isNaN(sd)) return true
        return Math.abs(sd - targetDate) <= tolMs
      })
    }
    const targetAmount = filterAmount ? parseAmount(filterAmount) : null
    if (targetAmount != null) {
      list = list.filter(s => {
        if (s.ocr_montant == null) return true // pas d'OCR montant → on garde
        return Math.abs(s.ocr_montant - targetAmount) <= filterAmountTol
      })
    }
    return list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  }, [suggestions, filterDate, filterDateTol, filterAmount, filterAmountTol])

  const clearFilters = useCallback(() => {
    setFilterDate('')
    setFilterAmount('')
    // tolérances conservées
  }, [])

  // ─── Toggle preview ───
  const togglePreview = useCallback((filename: string) => {
    setPreviewFilename(prev => (prev === filename ? null : filename))
  }, [])

  // ─── Navigation liste ops ───
  /**
   * Passe à l'op suivante dans `filteredOpsList`. Retourne true si une op
   * suivante a été sélectionnée, false si la liste est épuisée (= le
   * composant doit appeler onClose côté parent).
   */
  const goToNextOp = useCallback((): boolean => {
    if (!selectedOpKey || !filteredOpsList.length) return false
    const currentIdx = filteredOpsList.findIndex(o => o.key === selectedOpKey)
    if (currentIdx === -1 || currentIdx >= filteredOpsList.length - 1) {
      return false
    }
    setSelectedOpKey(filteredOpsList[currentIdx + 1].key)
    return true
  }, [selectedOpKey, filteredOpsList])

  const goToPrevOp = useCallback((): boolean => {
    if (!selectedOpKey || !filteredOpsList.length) return false
    const currentIdx = filteredOpsList.findIndex(o => o.key === selectedOpKey)
    if (currentIdx <= 0) return false
    setSelectedOpKey(filteredOpsList[currentIdx - 1].key)
    return true
  }, [selectedOpKey, filteredOpsList])

  // ─── Mutation association ───
  const associateMutation = useManualAssociate()

  const associate = useCallback(
    (justifFilename: string, score?: number | null): Promise<boolean> => {
      if (!selectedOp) return Promise.resolve(false)
      return associateMutation
        .mutateAsync({
          justificatif_filename: justifFilename,
          operation_file: selectedOp.filename,
          operation_index: selectedOp.index,
          rapprochement_score: score ?? undefined,
          ventilation_index: selectedOp.ventilationIndex,
        })
        .then(() => {
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
    [selectedOp, associateMutation],
  )

  // ─── Stats ───
  const totalOps = opsList.length
  const currentIdx = useMemo(() => {
    if (!selectedOpKey) return -1
    return filteredOpsList.findIndex(o => o.key === selectedOpKey)
  }, [selectedOpKey, filteredOpsList])
  const remainingCount = currentIdx === -1 ? filteredOpsList.length : filteredOpsList.length - currentIdx

  return {
    // Mode
    mode,
    setMode,
    hasTargeted,
    targetedCount: sanitizedTargetedOps.length,
    // Ops
    opsList,
    filteredOpsList,
    isLoadingOps,
    opSearch,
    setOpSearch,
    // Sélection
    selectedOpKey,
    setSelectedOpKey,
    selectedOp,
    goToNextOp,
    goToPrevOp,
    // Filtres libres
    filterDate,
    setFilterDate,
    filterDateTol,
    setFilterDateTol,
    filterAmount,
    setFilterAmount,
    filterAmountTol,
    setFilterAmountTol,
    clearFilters,
    // Mode élargi
    broadMode,
    setBroadMode,
    // Suggestions
    suggestions,
    filteredSuggestions,
    isLoadingSuggestions,
    // Preview
    previewFilename,
    togglePreview,
    setPreviewFilename,
    // Mutation
    associate,
    associateLoading: associateMutation.isPending,
    // Stats
    totalOps,
    currentIdx,
    remainingCount,
  }
}
