import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useFiscalYearStore } from '../stores/useFiscalYearStore'
import { useOperationFiles, useOperations, useYearOperations } from './useOperations'
import type { Operation, OperationFile } from '@/types'

type SortKey = 'date' | 'libelle' | 'debit' | 'credit' | 'categorie' | 'sous_categorie'
type SortOrder = 'asc' | 'desc'
type JustifFilter = 'all' | 'sans' | 'avec'

export interface EnrichedOperation extends Operation {
  _originalIndex: number
  _filename: string
}

export function useJustificatifsPage() {
  const [searchParams] = useSearchParams()
  const { selectedYear: year, setYear } = useFiscalYearStore()
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [justifFilter, setJustifFilter] = useState<JustifFilter>('sans')
  const [selectedOpIndex, setSelectedOpIndex] = useState<number | null>(null)
  const [selectedOpFilename, setSelectedOpFilename] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Fichiers disponibles
  const { data: files = [] } = useOperationFiles()

  // Synchroniser le mois depuis URL ?file= (pipeline → justificatifs)
  const fileParam = searchParams.get('file')
  useEffect(() => {
    if (!fileParam || files.length === 0) return
    const match = files.find(f => f.filename === fileParam)
    if (match) {
      if (match.year && match.year !== year) setYear(match.year)
      if (match.month !== selectedMonth) setSelectedMonth(match.month ?? null)
    }
  }, [fileParam, files]) // eslint-disable-line react-hooks/exhaustive-deps

  // Années et mois disponibles
  const availableYears = useMemo(() => {
    return [...new Set(files.map(f => f.year).filter((y): y is number => y !== undefined))].sort((a, b) => b - a)
  }, [files])

  // Année effective : fallback sur la première disponible si year n'existe pas dans les données
  const effectiveYear = availableYears.includes(year) ? year : (availableYears[0] ?? year)

  const monthsForYear = useMemo(() => {
    return files
      .filter(f => f.year === effectiveYear)
      .sort((a, b) => (a.month ?? 0) - (b.month ?? 0))
  }, [files, effectiveYear])

  // Fichier sélectionné
  const selectedFile = useMemo((): OperationFile | null => {
    // Priorité au fileParam URL si présent et valide
    if (fileParam) {
      const match = files.find(f => f.filename === fileParam)
      if (match) return match
    }
    if (selectedMonth === null || selectedMonth === 0) return monthsForYear[0] ?? null
    return monthsForYear.find(f => f.month === selectedMonth) ?? null
  }, [fileParam, files, monthsForYear, selectedMonth])

  // Chargement opérations
  const isYearWide = selectedMonth === 0
  const { data: singleOps } = useOperations(
    !isYearWide && selectedFile ? selectedFile.filename : null
  )
  const { data: yearOps, isLoading: yearLoading } = useYearOperations(
    monthsForYear,
    isYearWide
  )

  const rawOperations = isYearWide ? (yearOps ?? []) : (singleOps ?? [])

  // Enrichir avec index original et filename
  const enrichedOps = useMemo((): EnrichedOperation[] => {
    if (isYearWide) {
      const byFile = new Map<string, number>()
      return rawOperations.map((op) => {
        const fname = op._sourceFile ?? ''
        const idx = byFile.get(fname) ?? 0
        byFile.set(fname, idx + 1)
        return { ...op, _originalIndex: idx, _filename: fname } as EnrichedOperation
      })
    }
    const fname = selectedFile?.filename ?? ''
    return rawOperations.map((op, idx) => ({
      ...op,
      _originalIndex: idx,
      _filename: fname,
    })) as EnrichedOperation[]
  }, [rawOperations, isYearWide, selectedFile])

  // Filtrage + tri + recherche
  const operations = useMemo((): EnrichedOperation[] => {
    let ops = [...enrichedOps]

    if (justifFilter === 'sans') {
      ops = ops.filter(op => !op['Lien justificatif'])
    } else if (justifFilter === 'avec') {
      ops = ops.filter(op => !!op['Lien justificatif'])
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      ops = ops.filter(op =>
        (op['Libellé'] ?? '').toLowerCase().includes(q) ||
        (op['Catégorie'] ?? '').toLowerCase().includes(q) ||
        (op['Sous-catégorie'] ?? '').toLowerCase().includes(q)
      )
    }

    ops.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'date': cmp = (a.Date ?? '').localeCompare(b.Date ?? ''); break
        case 'libelle': cmp = (a['Libellé'] ?? '').localeCompare(b['Libellé'] ?? ''); break
        case 'debit': cmp = (a['Débit'] ?? 0) - (b['Débit'] ?? 0); break
        case 'credit': cmp = (a['Crédit'] ?? 0) - (b['Crédit'] ?? 0); break
        case 'categorie': cmp = (a['Catégorie'] ?? '').localeCompare(b['Catégorie'] ?? ''); break
        case 'sous_categorie': cmp = (a['Sous-catégorie'] ?? '').localeCompare(b['Sous-catégorie'] ?? ''); break
      }
      return sortOrder === 'asc' ? cmp : -cmp
    })

    return ops
  }, [enrichedOps, justifFilter, search, sortKey, sortOrder])

  // Stats
  const stats = useMemo(() => {
    const total = enrichedOps.length
    const avec = enrichedOps.filter(op => !!op['Lien justificatif']).length
    const sans = total - avec
    const taux = total > 0 ? Math.round((avec / total) * 100) : 0
    return { total, avec, sans, taux }
  }, [enrichedOps])

  // Toggle tri
  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }, [sortKey])

  // Ouvrir drawer pour une opération
  const openDrawer = useCallback((op: EnrichedOperation) => {
    setSelectedOpIndex(op._originalIndex)
    setSelectedOpFilename(op._filename)
    setDrawerOpen(true)
  }, [])

  // Navigation post-attribution
  const goToNextWithout = useCallback(() => {
    const currentIdx = operations.findIndex(
      op => op._originalIndex === selectedOpIndex && op._filename === selectedOpFilename
    )
    if (currentIdx === -1) {
      setDrawerOpen(false)
      setSelectedOpIndex(null)
      setSelectedOpFilename(null)
      return
    }
    for (let i = currentIdx + 1; i < operations.length; i++) {
      if (!operations[i]['Lien justificatif']) {
        setSelectedOpIndex(operations[i]._originalIndex)
        setSelectedOpFilename(operations[i]._filename)
        return
      }
    }
    setDrawerOpen(false)
    setSelectedOpIndex(null)
    setSelectedOpFilename(null)
  }, [selectedOpIndex, selectedOpFilename, operations])

  // --- Effects en dernier (après tous les hooks) ---

  // Reset mois quand l'année change
  useEffect(() => {
    setSelectedMonth(null)
  }, [year])

  return {
    year: effectiveYear, setYear, selectedMonth, setSelectedMonth,
    search, setSearch,
    sortKey, sortOrder, toggleSort,
    justifFilter, setJustifFilter,
    selectedOpIndex, selectedOpFilename,
    drawerOpen, setDrawerOpen,
    availableYears, monthsForYear, selectedFile,
    operations, stats,
    isYearWide, isLoading: yearLoading,
    openDrawer, goToNextWithout,
  }
}
