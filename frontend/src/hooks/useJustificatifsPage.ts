import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useFiscalYearStore } from '../stores/useFiscalYearStore'
import { useOperationFiles, useOperations, useYearOperations } from './useOperations'
import { useSettings } from './useApi'
import { isReconstitue, matchesOperationType, type OperationTypeFilter } from '@/lib/utils'
import type { Operation, OperationFile, JustificatifExemptions } from '@/types'

function isOpExempt(op: Operation, exemptions: JustificatifExemptions | undefined): boolean {
  if (!exemptions) return false
  const cat = (op['Catégorie'] ?? '').trim()
  if (!cat) return false
  if (exemptions.categories.includes(cat)) return true
  const sub = (op['Sous-catégorie'] ?? '').trim()
  if (sub && exemptions.sous_categories[cat]?.includes(sub)) return true
  return false
}

type SortKey = 'date' | 'libelle' | 'debit' | 'credit' | 'categorie' | 'sous_categorie'
type SortOrder = 'asc' | 'desc'
type JustifFilter = 'all' | 'sans' | 'avec' | 'exempt' | 'locked' | 'facsimile'

export interface EnrichedOperation extends Operation {
  _originalIndex: number
  _filename: string
  _ventilationIndex?: number
  // Index signature pour permettre les casts vers Record<string, unknown>
  // (utilisé pour itérer dynamiquement sur les colonnes de filtre/tri).
  [key: string]: unknown
}

export function useJustificatifsPage() {
  const [searchParams] = useSearchParams()
  const { selectedYear: year, setYear } = useFiscalYearStore()
  const { data: appSettings } = useSettings()
  const exemptions = appSettings?.justificatif_exemptions
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [justifFilter, setJustifFilter] = useState<JustifFilter>('sans')
  // Filtres catégorie/sous-catégorie — persistent à travers les changements
  // de mois et d'année (intentionnel : l'utilisateur peut parcourir les mois
  // tout en gardant le même filtre "Remplaçant / Hébergement" par exemple)
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [subcategoryFilter, setSubcategoryFilter] = useState<string>('')
  const [sourceFilter, setSourceFilter] = useState<OperationTypeFilter>('all')
  const [selectedOpIndex, setSelectedOpIndex] = useState<number | null>(null)
  const [selectedOpFilename, setSelectedOpFilename] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerInitialIndex, setDrawerInitialIndex] = useState<number | undefined>(undefined)

  // Multi-sélection pour batch fac-similé
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set())

  // Multi-sélection pour bulk-lock (indépendante de la batch fac-similé)
  const [lockSelectedOps, setLockSelectedOps] = useState<Set<string>>(new Set())

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

  // Sync filter via URL ?filter=sans|avec|all|facsimile (OCR Historique → justificatifs)
  const filterParam = searchParams.get('filter')
  useEffect(() => {
    if (filterParam && ['all', 'sans', 'avec', 'facsimile'].includes(filterParam)) {
      setJustifFilter(filterParam as JustifFilter)
    }
  }, [filterParam])

  // Sync year/month via URL ?year=YYYY&month=M (fallback quand file= n'est pas fourni)
  const yearParam = searchParams.get('year')
  const monthParam = searchParams.get('month')
  useEffect(() => {
    if (yearParam) {
      const y = parseInt(yearParam, 10)
      if (!isNaN(y) && y !== year) setYear(y)
    }
    if (monthParam) {
      const m = parseInt(monthParam, 10)
      if (!isNaN(m) && m !== selectedMonth) setSelectedMonth(m)
    }
  }, [yearParam, monthParam]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync opération surlignée via URL ?highlight=N&file=X (OCR Historique → Voir l'opération)
  const highlightParam = searchParams.get('highlight')
  useEffect(() => {
    if (!highlightParam || !fileParam) return
    const idx = parseInt(highlightParam, 10)
    if (!isNaN(idx)) {
      setSelectedOpIndex(idx)
      setSelectedOpFilename(fileParam)
    }
  }, [highlightParam, fileParam])

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

    // Helper : une op ventilée a-t-elle au moins un justificatif dans ses sous-lignes ?
    const hasVentilationJustif = (op: EnrichedOperation) => {
      const vl = (op as Record<string, unknown>).ventilation as Array<Record<string, unknown>> | undefined
      return vl?.some(l => !!l.justificatif) ?? false
    }
    const isVentilated = (op: EnrichedOperation) =>
      ((op as Record<string, unknown>).ventilation as unknown[] | undefined)?.length ?? 0 > 0

    if (justifFilter === 'sans') {
      ops = ops.filter(op => {
        if (isVentilated(op)) {
          // Ventilée : montrer si au moins une sous-ligne sans justificatif
          const vl = (op as Record<string, unknown>).ventilation as Array<Record<string, unknown>>
          return vl.some(l => !l.justificatif)
        }
        return !op['Lien justificatif'] && !isOpExempt(op, exemptions)
      })
    } else if (justifFilter === 'avec') {
      // Strict : op associée (hors exemptions — qui ont leur propre pill)
      ops = ops.filter(op => {
        if (isOpExempt(op, exemptions)) return false
        if (isVentilated(op)) {
          const vl = (op as Record<string, unknown>).ventilation as Array<Record<string, unknown>>
          return vl.every(l => !!l.justificatif)
        }
        return !!op['Lien justificatif']
      })
    } else if (justifFilter === 'exempt') {
      ops = ops.filter(op => isOpExempt(op, exemptions))
    } else if (justifFilter === 'locked') {
      ops = ops.filter(op => op.locked === true)
    } else if (justifFilter === 'facsimile') {
      ops = ops.filter(op => {
        if (isReconstitue(op['Lien justificatif'] || '')) return true
        // Fac-similé dans une sous-ligne ventilée
        const vl = (op as Record<string, unknown>).ventilation as Array<Record<string, unknown>> | undefined
        return !!vl?.some(l => typeof l.justificatif === 'string' && isReconstitue(l.justificatif as string))
      })
    }

    // Filtre catégorie (support spécial __uncategorized__ comme l'éditeur)
    if (categoryFilter === '__uncategorized__') {
      ops = ops.filter(op => {
        const cat = (op['Catégorie'] ?? '').trim()
        return !cat || cat === 'Autres'
      })
    } else if (categoryFilter) {
      ops = ops.filter(op => (op['Catégorie'] ?? '') === categoryFilter)
    }

    // Filtre sous-catégorie (uniquement si une catégorie réelle est sélectionnée)
    if (subcategoryFilter && categoryFilter && categoryFilter !== '__uncategorized__') {
      ops = ops.filter(op => (op['Sous-catégorie'] ?? '') === subcategoryFilter)
    }

    // Filtre source (Type d'opération) — étendu Prompt B2 : 5 valeurs
    if (sourceFilter !== 'all') {
      ops = ops.filter(op => matchesOperationType(op, sourceFilter))
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
  }, [enrichedOps, justifFilter, exemptions, categoryFilter, subcategoryFilter, sourceFilter, search, sortKey, sortOrder])

  // Stats : compteurs séparés pour chaque pill du header. Ventilées traitées
  // comme « avec » si toutes sous-lignes justifiées, sinon « sans ».
  const stats = useMemo(() => {
    const total = enrichedOps.length
    let avec = 0
    let sans = 0
    let exempt = 0
    let locked = 0
    let facsimile = 0
    for (const op of enrichedOps) {
      const isExempt = isOpExempt(op, exemptions)
      const vl = (op as Record<string, unknown>).ventilation as Array<Record<string, unknown>> | undefined
      const isVentilated = (vl?.length ?? 0) > 0
      const hasJustif = isVentilated
        ? vl!.every(l => !!l.justificatif)
        : !!op['Lien justificatif']
      if (isExempt) exempt++
      else if (hasJustif) avec++
      else sans++
      if (op.locked === true) locked++
      const parentFs = isReconstitue(op['Lien justificatif'] || '')
      const vlFs = isVentilated && vl!.some(l => typeof l.justificatif === 'string' && isReconstitue(l.justificatif as string))
      if (parentFs || vlFs) facsimile++
    }
    // Legacy : taux (avec + exempt) / total — conservé pour MetricCard existantes
    const taux = total > 0 ? Math.round(((avec + exempt) / total) * 100) : 0
    return { total, avec, sans, exempt, locked, facsimile, taux }
  }, [enrichedOps, exemptions])

  // Toggle tri
  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }, [sortKey])

  // Ouvrir drawer pour une opération (mode ciblé)
  const openDrawer = useCallback((op: EnrichedOperation) => {
    setSelectedOpIndex(op._originalIndex)
    setSelectedOpFilename(op._filename)
    const idx = operations.findIndex(
      o => o._originalIndex === op._originalIndex && o._filename === op._filename
    )
    setDrawerInitialIndex(idx >= 0 ? idx : undefined)
    setDrawerOpen(true)
  }, [operations])

  // Ouvrir drawer en mode flux (toutes les ops sans justif)
  const openDrawerFlow = useCallback(() => {
    setDrawerInitialIndex(undefined)
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

  // Clear sélection quand les filtres changent
  useEffect(() => {
    setSelectedOps(new Set())
    setLockSelectedOps(new Set())
  }, [year, selectedMonth, justifFilter, search, categoryFilter, subcategoryFilter, sourceFilter])

  // Helpers sélection batch
  const opKey = useCallback((op: EnrichedOperation) => {
    const base = `${op._filename}:${op._originalIndex}`
    return op._ventilationIndex != null ? `${base}:${op._ventilationIndex}` : base
  }, [])

  // Helper exposé pour vérifier si une op est exemptée (CARMF, URSSAF, Honoraires, Perso, …)
  const isOpExemptFn = useCallback(
    (op: Operation) => isOpExempt(op, exemptions),
    [exemptions]
  )

  const selectableOps = useMemo(
    () => operations.filter(op => !op['Lien justificatif'] && !isOpExempt(op, exemptions)),
    [operations, exemptions]
  )

  const toggleOp = useCallback((op: EnrichedOperation) => {
    setSelectedOps(prev => {
      const next = new Set(prev)
      const key = `${op._filename}:${op._originalIndex}`
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleAllFiltered = useCallback(() => {
    setSelectedOps(prev => {
      const keys = selectableOps.map(op => `${op._filename}:${op._originalIndex}`)
      const allSelected = keys.length > 0 && keys.every(k => prev.has(k))
      if (allSelected) return new Set()
      return new Set(keys)
    })
  }, [selectableOps])

  const clearSelection = useCallback(() => setSelectedOps(new Set()), [])

  const selectedCount = selectedOps.size

  const isAllFilteredSelected = selectableOps.length > 0 &&
    selectableOps.every(op => selectedOps.has(`${op._filename}:${op._originalIndex}`))

  const isSomeFilteredSelected = !isAllFilteredSelected &&
    selectableOps.some(op => selectedOps.has(`${op._filename}:${op._originalIndex}`))

  const getSelectedOperations = useCallback(() => {
    return operations.filter(op => selectedOps.has(`${op._filename}:${op._originalIndex}`))
  }, [operations, selectedOps])

  // --- Bulk-lock helpers (sélection indépendante, cible les ops AVEC justificatif) ---
  const lockableOps = useMemo(
    () => operations.filter(op =>
      !!op['Lien justificatif'] &&
      !isOpExempt(op, exemptions) &&
      op._ventilationIndex == null
    ),
    [operations, exemptions]
  )

  const lockKey = useCallback((op: EnrichedOperation) =>
    `${op._filename}:${op._originalIndex}`, [])

  const toggleLockSelection = useCallback((key: string) => {
    setLockSelectedOps(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleAllLockSelection = useCallback(() => {
    setLockSelectedOps(prev => {
      const keys = lockableOps.map(lockKey)
      const allSelected = keys.length > 0 && keys.every(k => prev.has(k))
      if (allSelected) return new Set()
      return new Set(keys)
    })
  }, [lockableOps, lockKey])

  const clearLockSelection = useCallback(() => setLockSelectedOps(new Set()), [])

  const lockSelectedCount = lockSelectedOps.size

  const isAllLockSelected = lockableOps.length > 0 &&
    lockableOps.every(op => lockSelectedOps.has(lockKey(op)))

  const isSomeLockSelected = !isAllLockSelected &&
    lockableOps.some(op => lockSelectedOps.has(lockKey(op)))

  // true si toutes les ops sélectionnées sont déjà verrouillées.
  // Utilisé par la BulkLockBar pour basculer Verrouiller ↔ Déverrouiller.
  const lockSelectedAllLocked = useMemo(() => {
    if (lockSelectedOps.size === 0) return false
    const selected = operations.filter(op => lockSelectedOps.has(lockKey(op)))
    return selected.length > 0 && selected.every(op => !!op.locked)
  }, [lockSelectedOps, operations, lockKey])

  return {
    year: effectiveYear, setYear, selectedMonth, setSelectedMonth,
    search, setSearch,
    sortKey, sortOrder, toggleSort,
    justifFilter, setJustifFilter,
    categoryFilter, setCategoryFilter, subcategoryFilter, setSubcategoryFilter,
    sourceFilter, setSourceFilter,
    selectedOpIndex, selectedOpFilename,
    drawerOpen, setDrawerOpen,
    drawerInitialIndex, setDrawerInitialIndex,
    availableYears, monthsForYear, selectedFile,
    operations, stats,
    isYearWide, isLoading: yearLoading,
    isOpExempt: isOpExemptFn,
    openDrawer, openDrawerFlow, goToNextWithout,
    // Multi-sélection batch
    selectedOps, opKey, toggleOp, toggleAllFiltered, clearSelection,
    selectedCount, isAllFilteredSelected, isSomeFilteredSelected,
    getSelectedOperations,
    // Multi-sélection bulk-lock
    lockSelectedOps, lockableOps, lockKey,
    toggleLockSelection, toggleAllLockSelection, clearLockSelection,
    lockSelectedCount, isAllLockSelected, isSomeLockSelected,
    lockSelectedAllLocked,
  }
}
