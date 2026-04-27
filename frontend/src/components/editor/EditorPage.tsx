import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
} from '@tanstack/react-table'
import {
  Save, Bot, Plus, Trash2, Filter, FilterX, Loader2, Check, Search,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown,
  CheckSquare, Square, ArrowUpDown, ArrowUp, ArrowDown,
  AlertTriangle, Star, Paperclip, X, Download, RotateCcw, FileText,
  CheckCircle2, Circle, Scissors, Unlink, Users2, Expand, Ban, Camera, Link2,
} from 'lucide-react'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import ReconstituerButton from '@/components/ocr/ReconstituerButton'
import { LockCell } from '@/components/LockCell'
import { useBulkLock, type BulkLockItem } from '@/hooks/useBulkLock'
import { BulkLockBar } from '@/components/BulkLockBar'
import { Lock as LockIcon, LockOpen, Copy as FacsimileIcon } from 'lucide-react'
import { SnapshotCreateModal } from '@/components/snapshots/SnapshotCreateModal'
import { SnapshotsListDrawer } from '@/components/snapshots/SnapshotsListDrawer'
import { SnapshotViewerDrawer } from '@/components/snapshots/SnapshotViewerDrawer'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import PreviewSubDrawer from '@/components/ocr/PreviewSubDrawer'
import RapprochementWorkflowDrawer from '@/components/rapprochement/RapprochementWorkflowDrawer'
import ManualAssociationDrawer, { type TargetedOp } from '@/components/justificatifs/ManualAssociationDrawer'
import VentilationDrawer from '@/components/editor/VentilationDrawer'
import VentilationLines from '@/components/editor/VentilationLines'
import UrssafSplitWidget, { isUrssafOp } from '@/components/editor/UrssafSplitWidget'
import { ParticipantsCell } from '@/components/editor/ParticipantsCell'
import { useOperationFiles, useOperations, useYearOperations, useSaveOperations, useCategorizeOperations, useHasPdf, useCreateEmptyMonth } from '@/hooks/useOperations'
import { useCategories, useSettings } from '@/hooks/useApi'
import { useBatchHints } from '@/hooks/useRapprochement'
import { useDissociate, useDeleteJustificatif } from '@/hooks/useJustificatifs'
import { showDeleteConfirmToast, showDeleteSuccessToast } from '@/lib/deleteJustificatifToast'
import { useLettrageStats, useToggleLettrage, useBulkLettrage } from '@/hooks/useLettrage'
import { useHistoriqueBNC } from '@/hooks/useSimulation'
import { formatCurrency, formatFileTitle, cn, MOIS_FR, isReconstitue } from '@/lib/utils'
import AlerteBadge from '@/components/AlerteBadge'
import type { Operation, CategoryRaw } from '@/types'

// Editable cell component — uses local state to avoid re-render on every keystroke
function EditableCell({
  value,
  onChange,
  type = 'text',
  className = '',
  placeholder = '',
  options,
}: {
  value: string | number
  onChange: (val: string | number) => void
  type?: 'text' | 'number' | 'date' | 'select'
  className?: string
  placeholder?: string
  options?: { value: string; label: string }[]
}) {
  const [localValue, setLocalValue] = useState(value)
  const prevValueRef = useRef(value)

  // Sync local state when parent value changes (e.g. undo, categorize)
  if (prevValueRef.current !== value) {
    prevValueRef.current = value
    setLocalValue(value)
  }

  const commitValue = useCallback(() => {
    if (localValue !== value) {
      onChange(localValue)
    }
  }, [localValue, value, onChange])

  if (type === 'select' && options) {
    return (
      <select
        value={String(value || '')}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'bg-transparent border-0 text-text text-sm outline-none focus:ring-1 focus:ring-primary rounded px-1 py-0.5 w-full',
          className
        )}
      >
        <option value="">—</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  }

  return (
    <input
      type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
      step={type === 'number' ? '0.01' : undefined}
      value={localValue ?? ''}
      onChange={e => {
        if (type === 'number') {
          setLocalValue(parseFloat(e.target.value) || 0)
        } else {
          setLocalValue(e.target.value)
        }
      }}
      onBlur={commitValue}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          commitValue()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      placeholder={placeholder}
      className={cn(
        'bg-transparent border-0 text-text text-sm outline-none focus:ring-1 focus:ring-primary focus:bg-surface-hover rounded px-1 py-0.5 w-full transition-colors',
        className
      )}
    />
  )
}

// Modern toggle checkbox
function CheckboxCell({
  checked,
  onChange,
  colorClass = 'bg-primary',
  uncheckedColor,
  icon: Icon,
  iconClass,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  colorClass?: string
  uncheckedColor?: string
  icon?: React.ElementType
  iconClass?: string
}) {
  return (
    <div className="flex justify-center">
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'w-[22px] h-[22px] rounded-md flex items-center justify-center transition-all duration-150 border-2',
          checked
            ? cn(colorClass, 'border-transparent shadow-md ring-1 ring-white/20')
            : cn('bg-surface', uncheckedColor || 'border-text-muted/30', 'hover:border-text-muted/60 hover:bg-surface-hover')
        )}
      >
        {checked && Icon && <Icon size={13} className={cn('text-white drop-shadow-sm', iconClass)} />}
        {checked && !Icon && <Check size={13} className="text-white drop-shadow-sm" />}
      </button>
    </div>
  )
}

export default function EditorPage() {
  const [searchParams] = useSearchParams()
  const { data: files, isLoading: filesLoading } = useOperationFiles()
  const { data: categoriesData } = useCategories()
  const { data: appSettings } = useSettings()
  const exemptions = appSettings?.justificatif_exemptions
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const { selectedYear, setYear } = useFiscalYearStore()
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [allYearMode, setAllYearMode] = useState(false)
  const { data: rawOperations, isLoading: opsLoading } = useOperations(allYearMode ? null : selectedFile)

  // Années et mois disponibles pour le sélecteur en cascade
  const availableYears = useMemo(() => {
    if (!files) return []
    const years = [...new Set(files.filter(f => f.year).map(f => f.year!))]
    return years.sort((a, b) => a - b)
  }, [files])

  const monthsForYear = useMemo(() => {
    if (!files || !selectedYear) return []
    return files
      .filter(f => f.year === selectedYear)
      .sort((a, b) => (a.month ?? 0) - (b.month ?? 0))
  }, [files, selectedYear])

  const totalYearOps = useMemo(() => monthsForYear.reduce((s, f) => s + f.count, 0), [monthsForYear])

  // Year-wide operations (all files for selected year)
  const { data: yearOperations, isLoading: yearOpsLoading } = useYearOperations(monthsForYear, allYearMode)

  const [operations, setOperations] = useState<Operation[]>([])
  const [hasChanges, setHasChanges] = useState(false)
  const [undoStack, setUndoStack] = useState<Operation[][]>([])

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([{ id: 'Date', desc: false }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({ source: false })

  // Bulk-lock state (indépendant de rowSelection)
  const [lockSelectedOps, setLockSelectedOps] = useState<Set<string>>(new Set())

  // Special filter from Pipeline navigation
  const [filterUncategorized, setFilterUncategorized] = useState(false)

  // Filtre pills header : avec | sans | exempt | locked | unlocked | facsimile | null
  type HeaderFilter = 'avec' | 'sans' | 'exempt' | 'locked' | 'unlocked' | 'facsimile' | null
  const [headerFilter, setHeaderFilter] = useState<HeaderFilter>(null)

  // UI state
  const [showFilters, setShowFilters] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [pageIndex, setPageIndex] = useState(0)

  // Reset pagination when file or filters change
  useEffect(() => { setPageIndex(0) }, [selectedFile, allYearMode, globalFilter])

  // Reset headerFilter au changement de fichier / année
  useEffect(() => {
    setHeaderFilter(null)
  }, [selectedFile, allYearMode])

  // PDF preview state
  const { data: pdfStatus } = useHasPdf(selectedFile)
  const [pdfDrawerOpen, setPdfDrawerOpen] = useState(false)
  const [previewJustifFile, setPreviewJustifFile] = useState<string | null>(null)
  const [previewJustifOpIndex, setPreviewJustifOpIndex] = useState<number | null>(null)
  const [showJustifPreviewSub, setShowJustifPreviewSub] = useState(false)
  const [pdfDrawerWidth, setPdfDrawerWidth] = useState(700)
  const pdfResizing = useRef(false)

  // Reset le sub-drawer quand on change de justificatif ou qu'on ferme le main
  useEffect(() => {
    if (!previewJustifFile) setShowJustifPreviewSub(false)
  }, [previewJustifFile])

  // BNC estimé pour le widget URSSAF split
  const { data: historiqueBNC } = useHistoriqueBNC()
  const bncEstime = useMemo(() => {
    if (!historiqueBNC || !selectedYear) return 0
    const yearData = (historiqueBNC as any)?.annual?.find((y: any) => y.year === selectedYear)
    return yearData?.bnc ?? 0
  }, [historiqueBNC, selectedYear])

  // Lettrage
  const { data: lettrageStats } = useLettrageStats(selectedFile)
  const toggleLettrageMutation = useToggleLettrage()
  const bulkLettrageMutation = useBulkLettrage()

  // Rapprochement state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerOpIndex, setDrawerOpIndex] = useState<number | null>(null)
  const [drawerInitialVentIdx, setDrawerInitialVentIdx] = useState<number | null>(null)
  const [ventilationOpen, setVentilationOpen] = useState(false)
  const [ventilationOpIndex, setVentilationOpIndex] = useState<number | null>(null)
  const { data: batchHints } = useBatchHints(selectedFile)

  const saveMutation = useSaveOperations()
  const dissociateMutation = useDissociate()
  const deleteJustifMutation = useDeleteJustificatif()
  const categorizeMutation = useCategorizeOperations()
  const bulkLockMutation = useBulkLock()
  const createEmptyMonth = useCreateEmptyMonth()
  const searchRef = useRef<HTMLInputElement>(null)

  // Split button "+ Ligne ▾" — dropdown menu (Opération bancaire / Note de frais)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!addMenuOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [addMenuOpen])

  // ─── Bulk-lock helpers (indépendant de rowSelection TanStack) ───
  const lockKeyFor = useCallback((op: Operation, rowIndex: number) => {
    const filename = op._sourceFile ?? selectedFile ?? ''
    const index = op._index ?? rowIndex
    return `${filename}:${index}`
  }, [selectedFile])

  const lockableOps = useMemo(
    () => operations.filter(op => !!op.Justificatif && (op.ventilation?.length ?? 0) === 0),
    [operations]
  )

  // Compteurs live du header : se mettent à jour dès que `operations` change
  // (après save, undo, categorize, associate, unlock…). Pas de refetch requis.
  // « sans » exclut les ops exemptées (CARMF/URSSAF/Perso/...) — celles-là
  // n'ont pas besoin de justif, les compter comme "manquants" serait un faux
  // positif. Une pill dédiée « exemptées » montre leur nombre séparément.
  const headerCounters = useMemo(() => {
    let withJ = 0
    let withoutJ = 0
    let exempt = 0
    let locked = 0
    let unlocked = 0  // avec justif mais pas verrouillée (à valider)
    let facsimile = 0 // justif reconstitué (fac-similé)
    const exCats = exemptions?.categories ?? []
    const exSubCats = exemptions?.sous_categories ?? {}
    for (const op of operations) {
      const cat = (op['Catégorie'] ?? '').trim()
      const sub = (op['Sous-catégorie'] ?? '').trim()
      const isExempt = !!cat && (
        exCats.includes(cat) ||
        (!!sub && (exSubCats[cat] ?? []).includes(sub))
      )
      const vlines = op.ventilation ?? []
      const isVentilated = vlines.length > 0
      const hasJustif = isVentilated
        ? vlines.every(vl => !!vl.justificatif)
        : !!op.Justificatif || !!op['Lien justificatif']
      if (hasJustif) withJ++
      else if (isExempt) exempt++
      else withoutJ++
      if (op.locked === true) locked++
      else if (hasJustif) unlocked++ // non verrouillée mais associée

      // Fac-similé : détecte sur le parent OU dans une sous-ligne ventilée
      const lien = op['Lien justificatif'] || ''
      const hasFs = isReconstitue(lien)
        || (isVentilated && vlines.some(vl => !!vl.justificatif && isReconstitue(vl.justificatif)))
      if (hasFs) facsimile++
    }
    return { withJ, withoutJ, exempt, locked, unlocked, facsimile, total: operations.length }
  }, [operations, exemptions])

  const toggleLockSelection = useCallback((key: string) => {
    setLockSelectedOps(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const toggleAllLockSelection = useCallback(() => {
    setLockSelectedOps(prev => {
      const keys = lockableOps.map((op, i) => lockKeyFor(op, i))
      const allSelected = keys.length > 0 && keys.every(k => prev.has(k))
      if (allSelected) return new Set()
      return new Set(keys)
    })
  }, [lockableOps, lockKeyFor])

  const clearLockSelection = useCallback(() => setLockSelectedOps(new Set()), [])

  const lockSelectedCount = lockSelectedOps.size
  const isAllLockSelected = lockableOps.length > 0 &&
    lockableOps.every((op, i) => lockSelectedOps.has(lockKeyFor(op, i)))
  const isSomeLockSelected = !isAllLockSelected &&
    lockableOps.some((op, i) => lockSelectedOps.has(lockKeyFor(op, i)))
  const lockSelectedAllLocked = useMemo(() => {
    if (lockSelectedOps.size === 0) return false
    const selected = operations.filter((op, i) => lockSelectedOps.has(lockKeyFor(op, i)))
    return selected.length > 0 && selected.every(op => !!op.locked)
  }, [lockSelectedOps, operations, lockKeyFor])

  // Reset sélection bulk-lock au changement de fichier ou de mode
  useEffect(() => {
    setLockSelectedOps(new Set())
  }, [selectedFile, allYearMode])

  const handleBulkLock = useCallback(async () => {
    const targetLocked = !lockSelectedAllLocked
    const items: BulkLockItem[] = Array.from(lockSelectedOps).map(key => {
      const [filename, idxStr] = key.split(':')
      return { filename, index: Number(idxStr), locked: targetLocked }
    })
    if (items.length === 0) return
    const verb = targetLocked ? 'verrouillée' : 'déverrouillée'
    try {
      const res = await bulkLockMutation.mutateAsync(items)
      const s = res.success_count, e = res.error_count
      toast.success(
        e > 0
          ? `${s} ${verb}${s > 1 ? 's' : ''}, ${e} erreur${e > 1 ? 's' : ''}`
          : `${s} opération${s > 1 ? 's' : ''} ${verb}${s > 1 ? 's' : ''}`
      )
      clearLockSelection()
    } catch {
      toast.error(targetLocked ? 'Échec du verrouillage en masse' : 'Échec du déverrouillage en masse')
    }
  }, [lockSelectedOps, lockSelectedAllLocked, bulkLockMutation, clearLockSelection])

  // Auto-select month/file from query param or last available for the store year
  useEffect(() => {
    if (!files || files.length === 0) return
    if (selectedFile) return

    // URL param ?file=xxx → pré-sélectionner année + mois + fichier
    const fileParam = searchParams.get('file')
    if (fileParam) {
      const match = files.find(f => f.filename === fileParam)
      if (match) {
        if (match.year) setYear(match.year)
        setSelectedMonth(match.month ?? null)
        setSelectedFile(match.filename)
        return
      }
    }

    // Auto-sélection du mois/fichier pour l'année du store
    const monthsOfYear = files
      .filter(f => f.year === selectedYear)
      .sort((a, b) => (a.month ?? 0) - (b.month ?? 0))
    if (monthsOfYear.length > 0) {
      const last = monthsOfYear[monthsOfYear.length - 1]
      setSelectedMonth(last.month ?? null)
      setSelectedFile(last.filename)
    } else if (files.length > 0) {
      // Fallback : fichiers sans year/month
      setSelectedFile(files[0].filename)
    }
  }, [files, searchParams, selectedYear])

  // URL param ?filter=uncategorized → activer le filtre "non catégorisées"
  const filterParamApplied = useRef(false)
  useEffect(() => {
    if (filterParamApplied.current) return
    const filterParam = searchParams.get('filter')
    if (filterParam === 'uncategorized') {
      setFilterUncategorized(true)
      setShowFilters(true)
      setColumnFilters(prev => {
        const without = prev.filter(f => f.id !== 'Catégorie')
        return [...without, { id: 'Catégorie', value: '__uncategorized__' }]
      })
      filterParamApplied.current = true
    }
  }, [searchParams])

  // Ref pour éviter la boucle de catégorisation auto
  const lastAutoCategorizedFile = useRef<string | null>(null)

  // Sync operations when loaded from API
  useEffect(() => {
    const data = allYearMode ? yearOperations : rawOperations
    if (data) {
      setOperations([...data])
      setHasChanges(false)
      setUndoStack([])
      setRowSelection({})
    }
  }, [rawOperations, yearOperations, allYearMode])

  // Auto-catégorisation IA au chargement d'un fichier (vides uniquement)
  useEffect(() => {
    if (!selectedFile || !rawOperations || rawOperations.length === 0) return
    if (lastAutoCategorizedFile.current === selectedFile) return

    // Vérifier s'il y a des opérations sans catégorie
    const hasEmpty = rawOperations.some(
      op => !op['Catégorie'] || op['Catégorie'] === '' || op['Catégorie'] === 'Autres'
    )
    if (!hasEmpty) {
      lastAutoCategorizedFile.current = selectedFile
      return
    }

    lastAutoCategorizedFile.current = selectedFile
    categorizeMutation.mutate(
      { filename: selectedFile, mode: 'empty_only' },
      { onSuccess: () => setHasChanges(false) }
    )
  }, [selectedFile, rawOperations])

  // Highlight navigation: ?file=X&highlight=Y → navigate to correct page + highlight row
  const highlightDoneRef = useRef(false)

  useEffect(() => {
    const highlightIndex = searchParams.get('highlight')
    if (highlightIndex == null || !operations || operations.length === 0 || highlightDoneRef.current) return
    const idx = parseInt(highlightIndex)
    if (isNaN(idx)) return
    highlightDoneRef.current = true

    // Jump to the page containing this row so it's in the DOM
    const sortedRows = table.getSortedRowModel().rows
    const rowPos = sortedRows.findIndex(r => (r.original._index ?? r.index) === idx)
    if (rowPos >= 0) {
      setPageIndex(Math.floor(rowPos / pageSize))
    }

    // Wait for render, then scroll into view + flash highlight
    const tryHighlight = (attempts: number) => {
      const row = document.querySelector(`[data-row-index="${idx}"]`) as HTMLElement | null
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' })
        row.classList.add('flash-highlight')
      } else if (attempts > 0) {
        setTimeout(() => tryHighlight(attempts - 1), 200)
      }
    }
    setTimeout(() => tryHighlight(10), 300)
  }, [operations, searchParams])

  // Category lists
  const categoryNames = useMemo(() => {
    if (!categoriesData) return []
    return [...new Set(categoriesData.raw.map((c: CategoryRaw) => c['Catégorie']))].filter(Boolean).sort()
  }, [categoriesData])

  const subcategoriesMap = useMemo(() => {
    if (!categoriesData) return new Map<string, string[]>()
    const map = new Map<string, string[]>()
    for (const c of categoriesData.raw) {
      const cat = c['Catégorie']
      const sub = c['Sous-catégorie']
      if (cat && sub && sub !== 'null') {
        if (!map.has(cat)) map.set(cat, [])
        const list = map.get(cat)!
        if (!list.includes(sub)) list.push(sub)
      }
    }
    // Sort each subcategory list
    for (const [, list] of map) list.sort()
    return map
  }, [categoriesData])

  // Category color map
  const categoryColors = useMemo(() => {
    if (!categoriesData) return new Map<string, string>()
    const map = new Map<string, string>()
    for (const c of categoriesData.raw) {
      if (c['Catégorie'] && c.Couleur) {
        map.set(c['Catégorie'], c.Couleur)
      }
    }
    return map
  }, [categoriesData])

  // Update operation field with undo support
  const updateOperation = useCallback((rowIndex: number, field: keyof Operation, value: unknown) => {
    setOperations(prev => {
      setUndoStack(stack => [...stack.slice(-20), prev]) // keep last 20 undo states
      const updated = [...prev]
      updated[rowIndex] = { ...updated[rowIndex], [field]: value }
      return updated
    })
    setHasChanges(true)
  }, [])

  // Undo
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    setUndoStack(stack => stack.slice(0, -1))
    setOperations(prev)
    setHasChanges(true)
  }, [undoStack])

  // Add row
  const addRow = useCallback((source?: string) => {
    setUndoStack(stack => [...stack.slice(-20), operations])
    const newOp: Operation = {
      Date: new Date().toISOString().slice(0, 10),
      'Libellé': '',
      'Débit': 0,
      'Crédit': 0,
      'Catégorie': '',
      'Sous-catégorie': '',
      Justificatif: false,
      Important: false,
      A_revoir: false,
      Commentaire: '',
      ...(source ? { source } : {}),
    }
    setOperations(prev => [newOp, ...prev])
    setHasChanges(true)
    // Reset filters/sorting/pagination so the new row is visible
    setColumnFilters([])
    setGlobalFilter('')
    setSorting([{ id: 'Date', desc: true }])
    setPageIndex(0)
    setFilterUncategorized(false)
  }, [operations])

  // Delete selected rows
  const deleteSelectedRows = useCallback(() => {
    const selectedIndices = Object.keys(rowSelection).map(Number)
    if (selectedIndices.length === 0) return
    setUndoStack(stack => [...stack.slice(-20), operations])
    setOperations(prev => prev.filter((_, i) => !selectedIndices.includes(i)))
    setRowSelection({})
    setHasChanges(true)
  }, [rowSelection, operations])

  // Delete single row
  const deleteRow = useCallback((index: number) => {
    setUndoStack(stack => [...stack.slice(-20), operations])
    setOperations(prev => prev.filter((_, i) => i !== index))
    setHasChanges(true)
  }, [operations])

  // Save
  const handleSave = useCallback(() => {
    if (!selectedFile) return
    // Nettoyage défensif : les champs `_sourceFile` / `_index` sont des artefacts
    // frontend (enrichis par useYearOperations en mode year-wide). Ils ne doivent
    // JAMAIS être persistés dans le fichier d'opérations — sinon un clic lock
    // ultérieur utilise un `_sourceFile` potentiellement obsolète (fichier disparu
    // après un merge) et PATCH → 404 silencieux.
    const cleanedOps = operations.map(op => {
      if ('_sourceFile' in op || '_index' in op) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _sourceFile, _index, ...rest } = op as Operation & { _sourceFile?: string; _index?: number }
        return rest as Operation
      }
      return op
    })
    saveMutation.mutate(
      { filename: selectedFile, operations: cleanedOps },
      {
        onSuccess: (result: any) => {
          setHasChanges(false)
          setSaveSuccess(true)
          setTimeout(() => setSaveSuccess(false), 3000)
          if (result?.auto_pointed > 0) {
            toast.success(`${result.auto_pointed} opération${result.auto_pointed > 1 ? 's' : ''} auto-pointée${result.auto_pointed > 1 ? 's' : ''}`)
          }
        },
      }
    )
  }, [selectedFile, operations, saveMutation])

  // Categorize
  const handleCategorize = useCallback((mode: string) => {
    if (!selectedFile) return
    categorizeMutation.mutate(
      { filename: selectedFile, mode },
      { onSuccess: () => setHasChanges(false) }
    )
  }, [selectedFile, categorizeMutation])

  // Export CSV
  const handleExportCSV = useCallback(() => {
    if (operations.length === 0) return
    const headers = ['Date', 'Libellé', 'Débit', 'Crédit', 'Catégorie', 'Sous-catégorie', 'Commentaire']
    const rows = operations.map(op =>
      headers.map(h => {
        const val = op[h as keyof Operation]
        return typeof val === 'string' && val.includes(',') ? `"${val}"` : String(val ?? '')
      }).join(',')
    )
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = selectedFile?.replace('.json', '.csv') || 'operations.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [operations, selectedFile])

  // Stats
  const stats = useMemo(() => {
    const totalDebit = operations.reduce((s, op) => s + (op['Débit'] || 0), 0)
    const totalCredit = operations.reduce((s, op) => s + (op['Crédit'] || 0), 0)
    const categorized = operations.filter(op => op['Catégorie'] && op['Catégorie'] !== 'Autres').length
    const important = operations.filter(op => op.Important).length
    const aRevoir = operations.filter(op => op.A_revoir).length
    const withJustif = operations.filter(op => op.Justificatif).length
    return {
      totalDebit, totalCredit,
      solde: totalCredit - totalDebit,
      categorized, uncategorized: operations.length - categorized,
      important, aRevoir, withJustif,
    }
  }, [operations])

  // TanStack Table columns
  const columns = useMemo<ColumnDef<Operation, unknown>[]>(() => [
    // Hidden column for source filter (Type d'opération)
    {
      id: 'source',
      accessorFn: (row) => row.source ?? '',
      enableSorting: false,
      enableHiding: true,
      filterFn: (row, columnId, filterValue) => {
        const val = (row.getValue<string>(columnId) || '').trim()
        if (filterValue === 'note_de_frais') return val === 'note_de_frais'
        if (filterValue === 'bancaire') return val === ''
        return true
      },
      header: () => null,
      cell: () => null,
      size: 0,
    },
    // Selection checkbox
    {
      id: 'select',
      header: ({ table }) => (
        <div className="flex justify-center">
          <button
            onClick={table.getToggleAllPageRowsSelectedHandler()}
            className={cn(
              'w-[22px] h-[22px] rounded-md flex items-center justify-center transition-all duration-150 border-2',
              table.getIsAllPageRowsSelected()
                ? 'bg-primary border-transparent shadow-md ring-1 ring-white/20'
                : 'bg-surface border-text-muted/30 hover:border-text-muted/60 hover:bg-surface-hover'
            )}
          >
            {table.getIsAllPageRowsSelected() && <Check size={13} className="text-white drop-shadow-sm" />}
          </button>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center">
          <button
            onClick={row.getToggleSelectedHandler()}
            className={cn(
              'w-[22px] h-[22px] rounded-md flex items-center justify-center transition-all duration-150 border-2',
              row.getIsSelected()
                ? 'bg-primary border-transparent shadow-md ring-1 ring-white/20'
                : 'bg-surface border-text-muted/30 hover:border-text-muted/60 hover:bg-surface-hover'
            )}
          >
            {row.getIsSelected() && <Check size={13} className="text-white drop-shadow-sm" />}
          </button>
        </div>
      ),
      size: 40,
      enableSorting: false,
    },
    // Date
    {
      accessorKey: 'Date',
      header: 'Date',
      size: 130,
      cell: ({ row }) => (
        <EditableCell
          type="date"
          value={row.original.Date?.slice(0, 10) || ''}
          onChange={val => updateOperation(row.index, 'Date', val)}
        />
      ),
    },
    // Libellé
    {
      accessorKey: 'Libellé',
      header: 'Libellé',
      size: 280,
      cell: ({ row }) => (
        <EditableCell
          value={row.original['Libellé'] || ''}
          onChange={val => updateOperation(row.index, 'Libellé', val)}
          className="min-w-[200px]"
        />
      ),
    },
    // Débit
    {
      accessorKey: 'Débit',
      header: 'Débit',
      size: 110,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-0.5">
          <EditableCell
            type="number"
            value={row.original['Débit'] || ''}
            onChange={val => updateOperation(row.index, 'Débit', val)}
            className="text-right text-danger"
          />
          {row.original['Débit'] ? <span className="text-danger/60 text-xs shrink-0">€</span> : null}
        </div>
      ),
      meta: { align: 'right' },
    },
    // Crédit
    {
      accessorKey: 'Crédit',
      header: 'Crédit',
      size: 110,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-0.5">
          <EditableCell
            type="number"
            value={row.original['Crédit'] || ''}
            onChange={val => updateOperation(row.index, 'Crédit', val)}
            className="text-right text-success"
          />
          {row.original['Crédit'] ? <span className="text-success/60 text-xs shrink-0">€</span> : null}
        </div>
      ),
      meta: { align: 'right' },
    },
    // Catégorie
    {
      accessorKey: 'Catégorie',
      header: 'Catégorie',
      size: 160,
      cell: ({ row }) => {
        const cat = row.original['Catégorie'] || ''
        const color = categoryColors.get(cat)
        const isNoteDeFrais = row.original.source === 'note_de_frais'
        return (
          <div className="relative flex flex-col">
            {color && (
              <div
                className="absolute left-0 top-0 bottom-0 w-1 rounded-full"
                style={{ backgroundColor: color }}
              />
            )}
            {isNoteDeFrais && (
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '10px',
                  fontWeight: 500,
                  padding: '1px 6px',
                  borderRadius: '4px',
                  background: '#FAEEDA',
                  color: '#854F0B',
                  marginBottom: '2px',
                  lineHeight: '16px',
                  alignSelf: 'flex-start',
                }}
              >
                Note de frais
              </span>
            )}
            <EditableCell
              type="select"
              value={cat}
              onChange={val => {
                updateOperation(row.index, 'Catégorie', val)
                // Reset subcategory when category changes
                updateOperation(row.index, 'Sous-catégorie', '')
              }}
              options={categoryNames.map(c => ({ value: c, label: c }))}
              className="pl-3"
            />
          </div>
        )
      },
      filterFn: (row, columnId, filterValue) => {
        const val = row.getValue<string>(columnId) || ''
        if (filterValue === '__uncategorized__') {
          return !val || val === 'Autres'
        }
        return val === filterValue
      },
    },
    // Sous-catégorie (linked to category)
    {
      accessorKey: 'Sous-catégorie',
      header: 'Sous-cat.',
      size: 140,
      cell: ({ row }) => {
        const cat = row.original['Catégorie'] || ''
        const subs = subcategoriesMap.get(cat) || []
        if (subs.length > 0) {
          return (
            <EditableCell
              type="select"
              value={row.original['Sous-catégorie'] || ''}
              onChange={val => updateOperation(row.index, 'Sous-catégorie', val)}
              options={subs.map(s => ({ value: s, label: s }))}
            />
          )
        }
        return (
          <EditableCell
            value={row.original['Sous-catégorie'] || ''}
            onChange={val => updateOperation(row.index, 'Sous-catégorie', val)}
            placeholder="..."
          />
        )
      },
    },
    // Participants (visible uniquement pour Repas confrères)
    {
      id: 'participants',
      header: () => <span title="Participants" className="inline-flex"><Users2 size={14} className="mx-auto" /></span>,
      size: 44,
      cell: ({ row }) => {
        if (row.original['Sous-catégorie'] !== 'Repas confrères') return null
        return (
          <ParticipantsCell
            value={row.original.participants}
            onSave={(val) => updateOperation(row.index, 'participants', val)}
            disabled={allYearMode}
          />
        )
      },
      enableSorting: false,
    },
    // Justificatif — interactive paperclip + reconstituer
    {
      accessorKey: 'Justificatif',
      header: () => <span title="Justificatif" className="inline-flex"><Paperclip size={14} className="mx-auto" /></span>,
      size: 56,
      // Filtre custom : interprète les valeurs magiques déclenchées par les pills du header.
      // - __header_avec__ : op avec justificatif (parent ou toutes vl ventilées)
      // - __header_sans__ : op sans justificatif ET non exemptée
      // - __header_exempt__ : op exemptée (catégorie ou sous-cat dans exemptions)
      // - __header_locked__ : op verrouillée
      filterFn: (row, _columnId, filterValue) => {
        const op = row.original
        if (filterValue === '__header_locked__') {
          return op.locked === true
        }
        if (filterValue === '__header_unlocked__') {
          // Non verrouillée ET associée (to-review set)
          if (op.locked === true) return false
          const vl = op.ventilation ?? []
          const hasJustif = vl.length > 0
            ? vl.every(v => !!v.justificatif)
            : !!op.Justificatif || !!op['Lien justificatif']
          return hasJustif
        }
        if (filterValue === '__header_facsimile__') {
          const vl = op.ventilation ?? []
          const lien = op['Lien justificatif'] || ''
          return isReconstitue(lien)
            || (vl.length > 0 && vl.some(v => !!v.justificatif && isReconstitue(v.justificatif)))
        }
        if (filterValue === '__header_exempt__') {
          const cat = (op['Catégorie'] ?? '').trim()
          const sub = (op['Sous-catégorie'] ?? '').trim()
          if (!cat || !exemptions) return false
          return (
            exemptions.categories.includes(cat) ||
            (!!sub && (exemptions.sous_categories?.[cat] ?? []).includes(sub))
          )
        }
        if (filterValue === '__header_avec__' || filterValue === '__header_sans__') {
          const vlines = op.ventilation ?? []
          const isVentilated = vlines.length > 0
          const hasJustif = isVentilated
            ? vlines.every(vl => !!vl.justificatif)
            : !!op.Justificatif || !!op['Lien justificatif']
          if (filterValue === '__header_avec__') return hasJustif
          // sans : no justif AND not exempt
          if (hasJustif) return false
          const cat = (op['Catégorie'] ?? '').trim()
          const sub = (op['Sous-catégorie'] ?? '').trim()
          const isExempt = !!cat && !!exemptions && (
            exemptions.categories.includes(cat) ||
            (!!sub && (exemptions.sous_categories?.[cat] ?? []).includes(sub))
          )
          return !isExempt
        }
        return true
      },
      cell: ({ row }) => {
        const hasJustif = row.original.Justificatif || false
        const hintScore = batchHints?.[String(row.index)]
        const hasStrongHint = !hasJustif && hintScore != null && hintScore >= 0.75
        const isPerso = (row.original['Catégorie'] || '').toLowerCase() === 'perso'
        // Opération perso : pas de justificatif requis → cercle rouge barré (non interactif)
        if (isPerso) {
          return (
            <div className="flex items-center justify-center">
              <span
                className="p-0.5 text-red-400/80"
                title="Opération perso — aucun justificatif requis"
                aria-label="Aucun justificatif requis (perso)"
              >
                <Ban size={14} />
              </span>
            </div>
          )
        }
        return (
          <div className="flex items-center justify-center gap-0.5 group/justif">
            <button
              onClick={() => {
                if (hasJustif) {
                  const lien = row.original['Lien justificatif'] || ''
                  const basename = lien.split('/').pop() || ''
                  if (basename) {
                    setPreviewJustifFile(basename)
                    setPreviewJustifOpIndex(row.index)
                  }
                } else {
                  setDrawerOpIndex(row.index)
                  setDrawerOpen(true)
                }
              }}
              className="relative p-0.5 rounded hover:bg-surface-hover transition-colors"
              title={
                hasJustif
                  ? `Associé${row.original.rapprochement_mode === 'auto' ? ' (auto)' : ''} — cliquer pour voir`
                  : hasStrongHint
                    ? `Correspondance ${Math.round(hintScore! * 100)}%`
                    : 'Aucun justificatif'
              }
            >
              <Paperclip
                size={14}
                className={cn(
                  hasJustif ? 'text-emerald-400' : 'text-text-muted/40',
                  hasStrongHint && 'text-amber-400',
                )}
              />
              {hasStrongHint && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              )}
            </button>
            {hasJustif && isReconstitue(row.original['Lien justificatif'] || '') && (
              <span className="text-[10px]" title="Fac-similé reconstitué">😈</span>
            )}
            {!hasJustif && selectedFile && (
              <div className="opacity-0 group-hover/justif:opacity-100 transition-opacity">
                <ReconstituerButton
                  operationFile={selectedFile}
                  operationIndex={row.index}
                  libelle={row.original['Libellé'] || ''}
                  size="sm"
                />
              </div>
            )}
          </div>
        )
      },
      sortingFn: (a, b) => Number(a.original.Justificatif || 0) - Number(b.original.Justificatif || 0),
    },
    // Locked — cadenas + sélection bulk-lock (identique à JustificatifsPage)
    {
      id: 'locked',
      size: 44,
      enableSorting: false,
      enableColumnFilter: false,
      header: () => {
        if (allYearMode || lockableOps.length === 0) return null
        return (
          <button
            onClick={toggleAllLockSelection}
            title={isAllLockSelected
              ? 'Tout désélectionner'
              : `Sélectionner tout pour verrouillage en masse (${lockableOps.length})`}
            className={cn(
              'w-7 h-7 rounded-full inline-flex items-center justify-center transition-all',
              isAllLockSelected
                ? 'bg-warning/20 text-warning ring-2 ring-warning/60'
                : isSomeLockSelected
                  ? 'bg-warning/10 text-warning ring-1 ring-warning/40'
                  : 'text-text-muted hover:text-warning hover:bg-warning/10'
            )}
          >
            <LockIcon size={14} />
          </button>
        )
      },
      cell: ({ row }) => {
        const op = row.original
        // CRITIQUE en mode single-file : on IGNORE `op._sourceFile` même s'il existe —
        // c'est un artefact du mode year-wide qui a parfois été persisté dans les fichiers
        // d'opérations (ex. après un merge de fichiers qui a écrit les champs internes).
        // Le `_sourceFile` peut pointer vers un fichier qui n'existe plus → PATCH 404.
        // En single-file le fichier courant est TOUJOURS `selectedFile`.
        const filename = allYearMode ? (op._sourceFile ?? selectedFile ?? '') : (selectedFile ?? '')
        // CRITIQUE : `row.index` est la position VISIBLE post-filtre/tri/pagination.
        // Pour cibler la bonne op dans le fichier source (PATCH backend), on utilise
        // `row.id` qui vaut par défaut l'index dans la data array source (operations).
        // Sans ça, cliquer lock après un tri envoie le mauvais index au backend
        // → verrouille une autre op (ou renvoie une op non-lockable) silencieusement.
        // `_index` n'est valable qu'en year-wide (enrichi par useYearOperations).
        const index = allYearMode ? (op._index ?? Number(row.id)) : Number(row.id)
        if (!filename) return null
        const isLockable = !!op.Justificatif && (op.ventilation?.length ?? 0) === 0 && !allYearMode
        const selectionActive = lockSelectedCount > 0
        const key = `${filename}:${index}`
        const isChecked = lockSelectedOps.has(key)

        // Cas 1 : non lockable (year-wide, ventilée, sans justif) → LockCell unitaire
        if (!isLockable) {
          return (
            <div className="flex items-center justify-center">
              <LockCell
                filename={filename}
                index={index}
                locked={!!op.locked}
                hasJustificatif={!!op.Justificatif}
              />
            </div>
          )
        }
        // Cas 2 : sélection active → checkbox 22px warning seule
        if (selectionActive) {
          return (
            <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => toggleLockSelection(key)}
                className={cn(
                  'w-[22px] h-[22px] rounded border-2 inline-flex items-center justify-center transition-colors',
                  isChecked ? 'bg-warning border-warning' : 'border-border hover:border-warning'
                )}
              >
                {isChecked && <Check size={14} className="text-white" />}
              </button>
            </div>
          )
        }
        // Cas 3 : repos → LockCell cliquable + checkbox 18px au hover à côté
        return (
          <div className="inline-flex items-center gap-1.5 justify-center" onClick={e => e.stopPropagation()}>
            <LockCell
              filename={filename}
              index={index}
              locked={!!op.locked}
              hasJustificatif={!!op.Justificatif}
            />
            <button
              onClick={() => toggleLockSelection(key)}
              className="hidden group-hover:inline-flex w-[18px] h-[18px] rounded border-2 items-center justify-center transition-colors border-border/60 hover:border-warning hover:bg-warning/10"
              title="Sélectionner pour verrouillage en masse"
            />
          </div>
        )
      },
    },
    // Important
    {
      accessorKey: 'Important',
      header: () => <span title="Important" className="inline-flex"><Star size={14} className="mx-auto text-warning" /></span>,
      size: 40,
      cell: ({ row }) => (
        <CheckboxCell
          checked={row.original.Important || false}
          onChange={val => updateOperation(row.index, 'Important', val)}
          colorClass="bg-warning"
          uncheckedColor="border-warning/20"
          icon={Star}
        />
      ),
      sortingFn: (a, b) => Number(a.original.Important || 0) - Number(b.original.Important || 0),
    },
    // A_revoir
    {
      accessorKey: 'A_revoir',
      header: () => <span title="À revoir" className="inline-flex"><AlertTriangle size={14} className="mx-auto text-danger" /></span>,
      size: 40,
      cell: ({ row }) => (
        <CheckboxCell
          checked={row.original.A_revoir || false}
          onChange={val => updateOperation(row.index, 'A_revoir', val)}
          colorClass="bg-danger"
          uncheckedColor="border-danger/20"
          icon={AlertTriangle}
        />
      ),
      sortingFn: (a, b) => Number(a.original.A_revoir || 0) - Number(b.original.A_revoir || 0),
    },
    // Lettrée
    {
      accessorKey: 'lettre',
      header: () => <span title="Pointée" className="inline-flex"><CheckCircle2 size={14} className="mx-auto text-emerald-400" /></span>,
      size: 40,
      cell: ({ row }) => {
        const isLettre = row.original.lettre || false
        return (
          <div className="flex justify-center">
            <button
              onClick={() => {
                if (selectedFile) {
                  toggleLettrageMutation.mutate({ filename: selectedFile, index: row.index })
                }
              }}
              className={cn(
                'w-[22px] h-[22px] rounded-md flex items-center justify-center transition-all duration-150 border-2',
                isLettre
                  ? 'bg-emerald-500 border-transparent shadow-md ring-1 ring-white/20'
                  : 'bg-surface border-text-muted/30 hover:border-text-muted/60 hover:bg-surface-hover'
              )}
              title={isLettre ? 'Lettrée' : 'Non lettrée'}
            >
              {isLettre && <CheckCircle2 size={13} className="text-white drop-shadow-sm" />}
            </button>
          </div>
        )
      },
      sortingFn: (a, b) => Number(a.original.lettre || 0) - Number(b.original.lettre || 0),
    },
    // Commentaire
    {
      accessorKey: 'Commentaire',
      header: 'Commentaire',
      size: 150,
      cell: ({ row }) => (
        <EditableCell
          value={row.original.Commentaire || ''}
          onChange={val => updateOperation(row.index, 'Commentaire', val)}
          placeholder="..."
        />
      ),
      enableSorting: false,
    },
    // Alertes
    {
      id: 'alertes',
      header: 'Alertes',
      size: 120,
      cell: ({ row }) => {
        const alertes = row.original.alertes || []
        if (alertes.length === 0) return null
        return (
          <div className="flex gap-1 flex-wrap">
            {alertes.map((type) => (
              <AlerteBadge key={type} type={type} size="sm" />
            ))}
          </div>
        )
      },
      enableSorting: false,
    },
    // Ventilation + Delete
    {
      id: 'actions',
      header: '',
      size: 90,
      cell: ({ row }) => (
        <div className="flex items-center gap-0.5">
          {!allYearMode && isUrssafOp(row.original) && selectedFile && (
            <UrssafSplitWidget
              op={row.original}
              filename={selectedFile}
              index={row.index}
              year={selectedYear || new Date().getFullYear()}
              bnc_estime={bncEstime}
              onSplitSaved={() => {}}
            />
          )}
          {!allYearMode && (
            <button
              onClick={() => {
                setVentilationOpIndex(row.index)
                setVentilationOpen(true)
              }}
              className={cn(
                'p-1 rounded transition-colors',
                (row.original.ventilation?.length ?? 0) > 0
                  ? 'text-primary hover:bg-primary/10'
                  : 'text-text-muted hover:text-primary hover:bg-primary/10'
              )}
              title="Ventiler"
            >
              <Scissors size={14} />
            </button>
          )}
          <button
            onClick={() => deleteRow(row.index)}
            className="text-text-muted hover:text-danger transition-colors p-1 rounded hover:bg-danger/10"
            title="Supprimer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [categoryNames, subcategoriesMap, categoryColors, updateOperation, deleteRow, batchHints, selectedFile, bncEstime, selectedYear, allYearMode])

  // TanStack Table instance
  const table = useReactTable({
    data: operations,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      rowSelection,
      columnVisibility,
      pagination: { pageIndex, pageSize },
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater
      setPageIndex(next.pageIndex)
      setPageSize(next.pageSize)
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: 'includesString',
    enableRowSelection: true,
  })

  const selectedCount = Object.keys(rowSelection).length

  // ─── Snapshots state ───
  const [snapshotCreateOpen, setSnapshotCreateOpen] = useState(false)
  const [snapshotsListOpen, setSnapshotsListOpen] = useState(false)
  const [snapshotViewerId, setSnapshotViewerId] = useState<string | null>(null)

  // ─── Manual association drawer (2-colonnes ops | justificatifs) ───
  const [manualAssocDrawerOpen, setManualAssocDrawerOpen] = useState(false)

  /**
   * Construit la liste `TargetedOp` depuis `rowSelection` pour le drawer.
   * Filtre silencieux les crédits (recettes n'ayant pas besoin de justif).
   * Désactivé en year-wide : lecture seule + refs multi-files ambiguës.
   */
  const manualAssocTargetedOps = useMemo<TargetedOp[]>(() => {
    if (selectedCount === 0 || allYearMode || !selectedFile) return []
    const out: TargetedOp[] = []
    for (const rowId of Object.keys(rowSelection)) {
      const row = table.getRow(rowId)
      if (!row) continue
      const op = row.original
      const index = op._index ?? Number(rowId)
      if (Number.isNaN(index)) continue
      const debit = op['Débit'] ?? 0
      if (debit <= 0) continue
      out.push({
        filename: selectedFile,
        index,
        libelle: op['Libellé'] ?? '',
        montant: debit,
        date: op.Date ?? '',
        categorie: op['Catégorie'],
        sousCategorie: op['Sous-catégorie'],
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection, selectedCount, allYearMode, selectedFile])

  /**
   * Mois dérivé pour le drawer — soit le mois du fichier sélectionné (single-file),
   * soit null en year-wide pour ouvrir en scope année.
   */
  const manualAssocMonth = useMemo<number | null>(() => {
    if (allYearMode) return null
    if (!selectedFile) return null
    const finfo = files?.find(f => f.filename === selectedFile)
    return finfo?.month ?? null
  }, [allYearMode, selectedFile, files])

  /**
   * Construit les ops_refs pour les lignes cochées via TanStack rowSelection.
   * Skip les sous-lignes ventilées (snapshots = ops parentes).
   */
  const selectedOpsRefs = useMemo(() => {
    if (selectedCount === 0) return [] as { file: string; index: number }[]
    return Object.keys(rowSelection)
      .map(rowId => {
        const row = table.getRow(rowId)
        if (!row) return null
        const op = row.original
        const file = op._sourceFile ?? selectedFile ?? ''
        // CRITIQUE : `row.index` est la position visible (post-filtre/tri) — NE PAS utiliser.
        // - En year-wide : `op._index` est enrichi par `useYearOperations` (position dans fichier source)
        // - En single-file : `rowId` est par défaut l'index dans `operations` array = index dans fichier source
        const index = op._index ?? Number(rowId)
        if (!file || Number.isNaN(index)) return null
        return { file, index }
      })
      .filter(Boolean) as { file: string; index: number }[]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection, operations, selectedFile])

  /**
   * Suggère un nom basé sur le contexte courant (mois, catégorie filtrée, count).
   */
  const suggestedSnapshotName = useMemo(() => {
    const parts: string[] = []
    if (allYearMode && selectedYear) parts.push(`${selectedYear} (toute l'année)`)
    else if (selectedFile) {
      const finfo = files?.find(f => f.filename === selectedFile)
      if (finfo?.month && finfo?.year) {
        parts.push(`${MOIS_FR[finfo.month - 1]} ${finfo.year}`)
      }
    }
    const catFilter = columnFilters.find(f => f.id === 'Catégorie')?.value as string | undefined
    if (catFilter && catFilter !== '__uncategorized__') parts.push(catFilter)
    if (globalFilter.trim()) parts.push(`« ${globalFilter.trim()} »`)
    parts.push(`(${selectedCount} ops)`)
    return parts.join(' — ')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allYearMode, selectedYear, selectedFile, files, columnFilters, globalFilter, selectedCount])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (hasChanges) handleSave()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hasChanges, handleSave, handleUndo])

  if (filesLoading) return <LoadingSpinner text="Chargement des fichiers..." />

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Édition"
        description="Modifier et catégoriser vos opérations bancaires"
        actions={
          <div className="flex gap-2 items-center">
            {/* Compteurs live + pills cliquables pour filtrer la table */}
            {operations.length > 0 && (() => {
              const togglePill = (target: NonNullable<HeaderFilter>) => {
                const next = headerFilter === target ? null : target
                setHeaderFilter(next)
                const magic =
                  next === 'avec' ? '__header_avec__' :
                  next === 'sans' ? '__header_sans__' :
                  next === 'exempt' ? '__header_exempt__' :
                  next === 'locked' ? '__header_locked__' :
                  next === 'unlocked' ? '__header_unlocked__' :
                  next === 'facsimile' ? '__header_facsimile__' :
                  undefined
                table.getColumn('Justificatif')?.setFilterValue(magic)
              }
              const pillBase = 'inline-flex items-center gap-1 px-2 py-1 rounded-md border transition-all cursor-pointer hover:brightness-110'
              return (
                <div className="flex items-center gap-1.5 mr-1 text-[11px] font-medium">
                  <button
                    onClick={() => togglePill('avec')}
                    className={cn(
                      pillBase,
                      'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                      headerFilter === 'avec' && 'ring-2 ring-emerald-400 bg-emerald-500/30',
                    )}
                    title={`${headerCounters.withJ} avec justificatif · cliquer pour filtrer`}
                  >
                    <Paperclip size={11} />
                    <span className="tabular-nums">{headerCounters.withJ}</span>
                  </button>
                  <button
                    onClick={() => togglePill('sans')}
                    className={cn(
                      pillBase,
                      'bg-amber-500/15 text-amber-300 border-amber-500/30',
                      headerFilter === 'sans' && 'ring-2 ring-amber-400 bg-amber-500/30',
                    )}
                    title={`${headerCounters.withoutJ} sans justificatif (hors exemptions) · cliquer pour filtrer`}
                  >
                    <Paperclip size={11} className="opacity-50" />
                    <span className="tabular-nums">{headerCounters.withoutJ}</span>
                  </button>
                  {headerCounters.exempt > 0 && (
                    <button
                      onClick={() => togglePill('exempt')}
                      className={cn(
                        pillBase,
                        'bg-sky-500/15 text-sky-300 border-sky-500/30',
                        headerFilter === 'exempt' && 'ring-2 ring-sky-400 bg-sky-500/30',
                      )}
                      title={`${headerCounters.exempt} exemptée${headerCounters.exempt > 1 ? 's' : ''} · cliquer pour filtrer`}
                    >
                      <CheckCircle2 size={11} />
                      <span className="tabular-nums">{headerCounters.exempt}</span>
                    </button>
                  )}
                  <button
                    onClick={() => togglePill('locked')}
                    className={cn(
                      pillBase,
                      'bg-warning/15 text-warning border-warning/30',
                      headerFilter === 'locked' && 'ring-2 ring-warning bg-warning/30',
                    )}
                    title={`${headerCounters.locked} verrouillée${headerCounters.locked > 1 ? 's' : ''} · cliquer pour filtrer`}
                  >
                    <LockIcon size={11} />
                    <span className="tabular-nums">{headerCounters.locked}</span>
                  </button>
                  {headerCounters.unlocked > 0 && (
                    <button
                      onClick={() => togglePill('unlocked')}
                      className={cn(
                        pillBase,
                        'bg-rose-500/15 text-rose-300 border-rose-500/30',
                        headerFilter === 'unlocked' && 'ring-2 ring-rose-400 bg-rose-500/30',
                      )}
                      title={`${headerCounters.unlocked} associée${headerCounters.unlocked > 1 ? 's' : ''} mais non verrouillée${headerCounters.unlocked > 1 ? 's' : ''} (à valider) · cliquer pour filtrer`}
                    >
                      <LockOpen size={11} />
                      <span className="tabular-nums">{headerCounters.unlocked}</span>
                    </button>
                  )}
                  {headerCounters.facsimile > 0 && (
                    <button
                      onClick={() => togglePill('facsimile')}
                      className={cn(
                        pillBase,
                        'bg-purple-500/15 text-purple-300 border-purple-500/30',
                        headerFilter === 'facsimile' && 'ring-2 ring-purple-400 bg-purple-500/30',
                      )}
                      title={`${headerCounters.facsimile} fac-similé${headerCounters.facsimile > 1 ? 's' : ''} (justif reconstitué) · cliquer pour filtrer`}
                    >
                      <FacsimileIcon size={11} />
                      <span className="tabular-nums">{headerCounters.facsimile}</span>
                    </button>
                  )}
                  <span className="text-text-muted/60 text-[10px] px-1">
                    / {headerCounters.total}
                  </span>
                </div>
              )
            })()}

            {/* Badge "Voir toutes" — visible uniquement quand au moins un filtre est actif.
                Reset complet : pills header, filtres colonnes (cat/sous-cat/source), recherche, ?filter=uncategorized. */}
            {(headerFilter !== null || columnFilters.length > 0 || globalFilter.trim() !== '' || filterUncategorized) && (
              <button
                onClick={() => {
                  setHeaderFilter(null)
                  setColumnFilters([])
                  setGlobalFilter('')
                  setFilterUncategorized(false)
                  table.getColumn('Justificatif')?.setFilterValue(undefined)
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-warning/15 text-warning border border-warning/40 rounded-lg hover:bg-warning/25 transition-colors"
                title="Effacer tous les filtres et voir toutes les opérations"
              >
                <FilterX size={13} />
                Voir toutes
              </button>
            )}

            {allYearMode && (
              <span className="text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 rounded-lg">
                Lecture seule — Année complète
              </span>
            )}

            {!allYearMode && (
              <>
                {/* Undo */}
                <button
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className="flex items-center gap-1.5 px-2.5 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover disabled:opacity-30 transition-colors"
                  title="Annuler (Ctrl+Z)"
                >
                  <RotateCcw size={15} />
                </button>
              </>
            )}

            {/* Export CSV */}
            <button
              onClick={handleExportCSV}
              disabled={operations.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover disabled:opacity-30 transition-colors"
              title="Exporter en CSV"
            >
              <Download size={15} />
            </button>

            {/* Snapshots — bouton liste */}
            <button
              onClick={() => setSnapshotsListOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-warning/10 hover:border-warning/40 hover:text-warning transition-colors"
              title="Mes snapshots (sélections sauvegardées)"
            >
              <Camera size={15} />
            </button>

            {/* Snapshot — créer depuis sélection courante (visible si rowSelection > 0) */}
            {selectedCount > 0 && (
              <button
                onClick={() => setSnapshotCreateOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-warning/15 text-warning border border-warning/40 rounded-lg hover:bg-warning/25 transition-colors"
                title="Créer un snapshot avec les opérations cochées"
              >
                <Camera size={15} /> Snapshot ({selectedCount})
              </button>
            )}

            {/* Association manuelle — standalone header */}
            <button
              onClick={() => setManualAssocDrawerOpen(true)}
              disabled={allYearMode}
              className="flex items-center gap-1.5 px-2.5 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={allYearMode ? "Indisponible en mode Toute l'année" : 'Association manuelle des justificatifs'}
            >
              <Link2 size={15} />
            </button>

            {/* Association manuelle — depuis sélection (N ops) */}
            {selectedCount > 0 && !allYearMode && (
              <button
                onClick={() => setManualAssocDrawerOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-primary/15 text-primary border border-primary/40 rounded-lg hover:bg-primary/25 transition-colors"
                title="Associer des justificatifs aux opérations cochées"
              >
                <Link2 size={15} /> Associer justif. ({selectedCount})
              </button>
            )}

            {!allYearMode && (
              <>
                {/* Lettrage stats */}
                {lettrageStats && selectedFile && (
                  <span className="text-xs font-mono text-text-muted px-2 py-2 bg-surface border border-border rounded-lg">
                    <CheckCircle2 size={12} className="inline mr-1 text-emerald-400" />
                    {lettrageStats.lettrees}/{lettrageStats.total} L
                  </span>
                )}

                {/* Tout lettrer */}
                {lettrageStats && lettrageStats.non_lettrees > 0 && selectedFile && (
                  <button
                    onClick={() => {
                      const indices = operations.map((_, i) => i)
                      bulkLettrageMutation.mutate({ filename: selectedFile, indices, lettre: true })
                    }}
                    disabled={bulkLettrageMutation.isPending}
                    className="flex items-center gap-1.5 px-2.5 py-2 text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                    title="Lettrer toutes les opérations"
                  >
                    <CheckCircle2 size={15} />
                    Tout L
                  </button>
                )}

                {/* Recatégoriser IA (force toutes les lignes) */}
                <button
                  onClick={() => handleCategorize('all')}
                  disabled={!selectedFile || categorizeMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary/10 text-primary border border-primary/30 rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-colors"
                >
                  <Bot size={15} />
                  {categorizeMutation.isPending ? 'IA...' : 'Recatégoriser IA'}
                </button>

                {/* Save */}
                <button
                  onClick={handleSave}
                  disabled={!hasChanges || saveMutation.isPending}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-all',
                    saveSuccess
                      ? 'bg-success text-white'
                      : hasChanges
                        ? 'bg-primary text-white hover:bg-primary-dark shadow-lg shadow-primary/25'
                        : 'bg-primary/50 text-white/70 cursor-not-allowed'
                  )}
                >
                  {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> :
                   saveSuccess ? <Check size={15} /> : <Save size={15} />}
                  {saveSuccess ? 'OK!' : 'Sauvegarder'}
                </button>
              </>
            )}
          </div>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-3">
        {/* Year selector */}
        <select
          value={selectedYear}
          onChange={e => {
            const yr = e.target.value ? Number(e.target.value) : null
            if (yr) setYear(yr)
            setSelectedMonth(null)
            setSelectedFile(null)
            setAllYearMode(false)
            setRowSelection({})
            // Auto-sélectionner le premier mois de l'année
            if (yr && files) {
              const first = files.filter(f => f.year === yr).sort((a, b) => (a.month ?? 0) - (b.month ?? 0))[0]
              if (first) {
                setSelectedMonth(first.month ?? null)
                setSelectedFile(first.filename)
              }
            }
          }}
          className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text w-28"
        >
          <option value="">Année...</option>
          {availableYears.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        {/* Month selector — 12 mois exposés, mois sans fichier déclenchent la création */}
        <select
          value={allYearMode ? '__ALL__' : (selectedFile ?? '')}
          onChange={async e => {
            const val = e.target.value
            if (val === '__ALL__') {
              setAllYearMode(true)
              setSelectedFile(null)
              setSelectedMonth(null)
              setRowSelection({})
              return
            }
            if (val.startsWith('__CREATE_') && selectedYear) {
              const m = Number(val.slice('__CREATE_'.length, -2)) // e.g. "__CREATE_4__" -> 4
              if (!m || m < 1 || m > 12) return
              const confirmMsg = `Aucun relevé pour ${MOIS_FR[m - 1]} ${selectedYear}. Créer un fichier d'opérations vide pour ce mois ?`
              if (!window.confirm(confirmMsg)) {
                // Revert le select à sa valeur précédente en forçant un re-render via state
                return
              }
              try {
                const res = await createEmptyMonth.mutateAsync({ year: selectedYear, month: m })
                toast.success(`Fichier vide créé pour ${MOIS_FR[m - 1]} ${selectedYear}`)
                setAllYearMode(false)
                setSelectedFile(res.filename)
                setSelectedMonth(m)
                setRowSelection({})
              } catch (err) {
                toast.error(`Échec de la création : ${(err as Error).message}`)
              }
              return
            }
            setAllYearMode(false)
            const fname = val || null
            setSelectedFile(fname)
            setRowSelection({})
            if (fname && files) {
              const match = files.find(f => f.filename === fname)
              if (match) setSelectedMonth(match.month ?? null)
            }
          }}
          disabled={!selectedYear}
          className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text flex-1 max-w-xs disabled:opacity-50"
        >
          <option value="">Mois...</option>
          {monthsForYear.length > 1 && (
            <option value="__ALL__">Toute l'année ({totalYearOps} ops)</option>
          )}
          {selectedYear && Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
            const existing = monthsForYear.find(f => f.month === m)
            if (existing) {
              return (
                <option key={`file-${existing.filename}`} value={existing.filename}>
                  {MOIS_FR[m - 1]} ({existing.count} ops)
                </option>
              )
            }
            return (
              <option key={`create-${m}`} value={`__CREATE_${m}__`}>
                {MOIS_FR[m - 1]} — vide · créer
              </option>
            )
          })}
        </select>

        {/* PDF original */}
        <button
          onClick={() => setPdfDrawerOpen(true)}
          disabled={!pdfStatus?.has_pdf}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors',
            pdfStatus?.has_pdf
              ? 'bg-surface border-border hover:bg-surface-hover text-text'
              : 'bg-surface border-border text-text-muted/40 cursor-not-allowed'
          )}
          title={pdfStatus?.has_pdf ? 'Voir le relevé PDF original' : 'Pas de PDF source associé'}
        >
          <FileText size={15} />
          <span className="hidden lg:inline">PDF</span>
        </button>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            ref={searchRef}
            type="text"
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            placeholder="Rechercher (Ctrl+F)..."
            className="w-full bg-surface border border-border rounded-lg pl-9 pr-8 py-2 text-sm text-text focus:ring-1 focus:ring-primary outline-none"
          />
          {globalFilter && (
            <button
              onClick={() => setGlobalFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors',
            showFilters ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-surface border-border hover:bg-surface-hover'
          )}
        >
          <Filter size={15} />
          Filtres
        </button>

        {/* Add row — split button (Opération bancaire / Note de frais) */}
        {!allYearMode && (
          <div ref={addMenuRef} className="relative inline-flex">
            <button
              onClick={() => addRow()}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-surface border border-border rounded-l-lg hover:bg-surface-hover transition-colors"
            >
              <Plus size={15} />
              Ligne
            </button>
            <button
              onClick={() => setAddMenuOpen(v => !v)}
              className={cn(
                'flex items-center px-2 py-2 text-sm bg-surface border border-l-0 border-border rounded-r-lg hover:bg-surface-hover transition-colors',
                addMenuOpen && 'bg-surface-hover'
              )}
              aria-label="Autres types de ligne"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
            >
              <ChevronDown size={14} />
            </button>
            {addMenuOpen && (
              <div
                role="menu"
                className="absolute top-full right-0 mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg z-20 py-1"
              >
                <button
                  role="menuitem"
                  onClick={() => { addRow(); setAddMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text hover:bg-surface-hover text-left"
                >
                  <Plus size={14} />
                  Opération bancaire
                </button>
                <button
                  role="menuitem"
                  onClick={() => { addRow('note_de_frais'); setAddMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text hover:bg-surface-hover text-left"
                >
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: '10px',
                      fontWeight: 500,
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: '#FAEEDA',
                      color: '#854F0B',
                      lineHeight: '16px',
                    }}
                  >
                    Note de frais
                  </span>
                  <span>CB perso</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Batch delete */}
        {!allYearMode && selectedCount > 0 && (
          <button
            onClick={deleteSelectedRows}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-danger/10 text-danger border border-danger/30 rounded-lg hover:bg-danger/20 transition-colors"
          >
            <Trash2 size={15} />
            Supprimer ({selectedCount})
          </button>
        )}
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-surface rounded-xl border border-border p-4 mb-3 grid grid-cols-1 md:grid-cols-6 gap-4">
          <div>
            <label className="text-xs text-text-muted mb-1.5 block font-medium">Catégorie</label>
            <select
              value={(table.getColumn('Catégorie')?.getFilterValue() as string) ?? ''}
              onChange={e => {
                const val = e.target.value
                setFilterUncategorized(val === '__uncategorized__')
                table.getColumn('Catégorie')?.setFilterValue(val || undefined)
                table.getColumn('Sous-catégorie')?.setFilterValue(undefined)
              }}
              className={cn(
                'w-full bg-background border rounded-lg px-3 py-2 text-sm text-text',
                filterUncategorized ? 'border-warning text-warning' : 'border-border'
              )}
            >
              <option value="">Toutes les catégories</option>
              <option value="__uncategorized__">⚠ Non catégorisées</option>
              {categoryNames.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1.5 block font-medium">Sous-catégorie</label>
            {(() => {
              const selectedCat = (table.getColumn('Catégorie')?.getFilterValue() as string) ?? ''
              const subs = selectedCat ? (subcategoriesMap.get(selectedCat) || []) : []
              return (
                <select
                  value={(table.getColumn('Sous-catégorie')?.getFilterValue() as string) ?? ''}
                  onChange={e => table.getColumn('Sous-catégorie')?.setFilterValue(e.target.value || undefined)}
                  disabled={!selectedCat || subs.length === 0}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text disabled:opacity-40"
                >
                  <option value="">{!selectedCat ? 'Choisir catégorie...' : subs.length === 0 ? 'Aucune sous-cat.' : 'Toutes'}</option>
                  {subs.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )
            })()}
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1.5 block font-medium">Type d'opération</label>
            <select
              value={(table.getColumn('source')?.getFilterValue() as string) ?? ''}
              onChange={e => {
                const val = e.target.value
                table.getColumn('source')?.setFilterValue(val || undefined)
              }}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text"
            >
              <option value="">Tous les types</option>
              <option value="bancaire">Opérations bancaires</option>
              <option value="note_de_frais">Notes de frais</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1.5 block font-medium">Afficher</label>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text"
            >
              {[25, 50, 100, 200].map(size => (
                <option key={size} value={size}>{size} lignes</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2 md:col-start-5">
            <label className="text-xs text-text-muted mb-1.5 block font-medium">Statistiques</label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-background rounded-lg p-2 flex justify-between">
                <span className="text-text-muted">Total</span>
                <span className="font-mono">{operations.length} ops</span>
              </div>
              <div className="bg-background rounded-lg p-2 flex justify-between">
                <span className="text-text-muted">Catégorisées</span>
                <span className="font-mono text-success">{stats.categorized} / {operations.length}</span>
              </div>
              <div className="bg-background rounded-lg p-2 flex justify-between">
                <span className="text-text-muted">Important</span>
                <span className="font-mono text-warning">{stats.important}</span>
              </div>
              <div className="bg-background rounded-lg p-2 flex justify-between">
                <span className="text-text-muted">À revoir</span>
                <span className="font-mono text-danger">{stats.aRevoir}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Categorize result banner */}
      {categorizeMutation.isSuccess && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-3 mb-3 text-sm text-success flex items-center gap-2">
          <Check size={16} />
          IA : {(categorizeMutation.data as { modified: number }).modified} opérations catégorisées automatiquement
        </div>
      )}

      {/* Main table */}
      {(opsLoading || yearOpsLoading) ? (
        <LoadingSpinner text={allYearMode ? "Chargement de l'année complète..." : "Chargement des opérations..."} />
      ) : !selectedFile && !allYearMode ? (
        <div className="bg-surface rounded-xl border border-border p-16 text-center">
          <div className="text-text-muted">
            <Paperclip size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg mb-2">Aucun fichier sélectionné</p>
            <p className="text-sm">Sélectionnez un fichier dans la liste ci-dessus pour commencer l'édition.</p>
          </div>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden flex-1 flex flex-col">
          {/* Uncategorized filter banner */}
          {filterUncategorized && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-warning/10 border-b border-warning/30">
              <div className="flex items-center gap-2 text-sm text-warning">
                <AlertTriangle size={15} />
                <span className="font-medium">
                  Filtre actif : opérations non catégorisées ({table.getRowModel().rows.length} résultats)
                </span>
              </div>
              <button
                onClick={() => {
                  setFilterUncategorized(false)
                  table.getColumn('Catégorie')?.setFilterValue(undefined)
                }}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text px-2 py-1 rounded-md hover:bg-surface-hover transition-colors"
              >
                <X size={14} />
                Retirer le filtre
              </button>
            </div>
          )}
          {/* Bandeau stats filtrées — visible si filtre actif (global, colonne ou uncategorized) */}
          {(() => {
            const filtered = table.getFilteredRowModel().rows
            const filtersActive = !!globalFilter.trim() || columnFilters.length > 0 || filterUncategorized
            if (!filtersActive || filtered.length === operations.length) return null
            const totalDebit = filtered.reduce((s, r) => s + (r.original['Débit'] || 0), 0)
            const totalCredit = filtered.reduce((s, r) => s + (r.original['Crédit'] || 0), 0)
            const solde = totalCredit - totalDebit
            return (
              <div className="flex items-center justify-between px-4 py-2 bg-primary/10 border-b border-primary/30 text-xs">
                <div className="flex items-center gap-2 text-primary">
                  <Filter size={13} />
                  <span className="font-semibold">
                    {filtered.length} opération{filtered.length > 1 ? 's' : ''} filtrée{filtered.length > 1 ? 's' : ''}
                  </span>
                  <span className="text-text-muted">sur {operations.length} totales</span>
                </div>
                <div className="flex items-center gap-5 font-mono">
                  <span className="text-text-muted">
                    Débits : <span className="text-danger font-semibold">{formatCurrency(totalDebit)}</span>
                  </span>
                  <span className="text-text-muted">
                    Crédits : <span className="text-success font-semibold">{formatCurrency(totalCredit)}</span>
                  </span>
                  <span className="text-text-muted">
                    Solde : <span className={cn('font-semibold', solde >= 0 ? 'text-success' : 'text-danger')}>
                      {formatCurrency(solde)}
                    </span>
                  </span>
                </div>
              </div>
            )
          })()}
          {/* Table */}
          <div className="overflow-x-auto flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface z-10 shadow-sm">
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id} className="border-b border-border">
                    {headerGroup.headers.map(header => {
                      const meta = header.column.columnDef.meta as { align?: string } | undefined
                      return (
                        <th
                          key={header.id}
                          className={cn(
                            'py-2.5 px-2 text-text-muted font-medium text-xs uppercase tracking-wider',
                            header.column.getCanSort() ? 'cursor-pointer select-none hover:text-text' : '',
                            meta?.align === 'right' ? 'text-right' : 'text-left'
                          )}
                          style={{ width: header.getSize() }}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <span className="flex items-center gap-1">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getCanSort() && (
                              header.column.getIsSorted() === 'asc' ? <ArrowUp size={12} className="text-primary" /> :
                              header.column.getIsSorted() === 'desc' ? <ArrowDown size={12} className="text-primary" /> :
                              <ArrowUpDown size={12} className="opacity-20" />
                            )}
                          </span>
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map(row => {
                  const hasVentilation = (row.original.ventilation?.length ?? 0) > 0
                  const totalCols = row.getVisibleCells().length
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        data-row-index={row.original._index ?? row.index}
                        className={cn(
                          'group border-b border-border/20 transition-colors editor-row',
                          drawerOpen && drawerOpIndex === row.index
                            ? 'bg-warning/15 outline outline-2 outline-warning/40 outline-offset-[-2px] rounded'
                            : row.getIsSelected() ? 'bg-warning/10' : '',
                          row.original.Important ? 'border-l-2 border-l-warning' : '',
                          row.original.A_revoir ? 'border-l-2 border-l-danger' : '',
                          row.original.lettre ? 'opacity-60' : '',
                          lockSelectedOps.has(`${row.original._sourceFile ?? selectedFile ?? ''}:${row.original._index ?? row.index}`) && 'bg-warning/10',
                        )}
                      >
                        {row.getVisibleCells().map(cell => {
                          const meta = cell.column.columnDef.meta as { align?: string } | undefined
                          return (
                            <td
                              key={cell.id}
                              className={cn(
                                'py-1 px-2',
                                meta?.align === 'right' ? 'text-right' : ''
                              )}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          )
                        })}
                      </tr>
                      {hasVentilation && (
                        <VentilationLines
                          lines={row.original.ventilation!}
                          colSpan={totalCols}
                          categoryColors={categoryColors}
                          onClick={() => {
                            if (!allYearMode) {
                              setVentilationOpIndex(row.index)
                              setVentilationOpen(true)
                            }
                          }}
                          onJustifClick={(justificatif) => {
                            setPreviewJustifFile(justificatif)
                            setPreviewJustifOpIndex(row.index)
                          }}
                          onAttributeClick={(vlIdx) => {
                            setDrawerOpIndex(row.index)
                            setDrawerInitialVentIdx(vlIdx)
                            setDrawerOpen(true)
                          }}
                        />
                      )}
                    </React.Fragment>
                  )
                })}
                {/* Ligne TOTAL éphémère — affichée uniquement si filtre actif (jamais sauvegardée) */}
                {(() => {
                  const filteredRows = table.getFilteredRowModel().rows
                  const filtersActive = !!globalFilter.trim() || columnFilters.length > 0 || filterUncategorized
                  if (!filtersActive || filteredRows.length === 0 || filteredRows.length === operations.length) return null
                  const totalDebit = filteredRows.reduce((s, r) => s + (r.original['Débit'] || 0), 0)
                  const totalCredit = filteredRows.reduce((s, r) => s + (r.original['Crédit'] || 0), 0)
                  const solde = totalCredit - totalDebit
                  const visibleCols = table.getVisibleLeafColumns()
                  return (
                    <tr
                      className="sticky bottom-0 z-20 border-y-2 border-warning bg-gradient-to-r from-warning/30 via-warning/25 to-warning/30 font-bold text-text shadow-[0_-6px_16px_-4px_rgba(245,158,11,0.5)]"
                    >
                      {visibleCols.map((col, colIdx) => {
                        const id = col.id
                        const isFirst = colIdx === 0
                        const isLast = colIdx === visibleCols.length - 1
                        let content: React.ReactNode = null
                        if (id === 'Date') {
                          content = (
                            <span className="inline-flex items-center gap-1.5 text-sm uppercase tracking-wider text-warning">
                              <span className="text-base">∑</span>
                              <span>Total</span>
                            </span>
                          )
                        } else if (id === 'Libellé') {
                          content = (
                            <span className="text-xs italic text-warning/90">
                              {filteredRows.length} opération{filteredRows.length > 1 ? 's' : ''} filtrée{filteredRows.length > 1 ? 's' : ''}
                            </span>
                          )
                        } else if (id === 'Débit') {
                          content = totalDebit > 0
                            ? <span className="text-danger tabular-nums text-sm">{formatCurrency(totalDebit)}</span>
                            : <span className="text-text-muted/40">—</span>
                        } else if (id === 'Crédit') {
                          content = totalCredit > 0
                            ? <span className="text-success tabular-nums text-sm">{formatCurrency(totalCredit)}</span>
                            : <span className="text-text-muted/40">—</span>
                        } else if (id === 'Catégorie') {
                          content = (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold tabular-nums whitespace-nowrap',
                                solde >= 0
                                  ? 'bg-success/20 text-success ring-1 ring-success/40'
                                  : 'bg-danger/20 text-danger ring-1 ring-danger/40'
                              )}
                            >
                              Solde&nbsp;:&nbsp;{formatCurrency(solde)}
                            </span>
                          )
                        }
                        return (
                          <td
                            key={id}
                            className={cn(
                              'py-3 px-2',
                              isFirst && 'border-l-4 border-l-warning',
                              isLast && 'border-r-4 border-r-warning'
                            )}
                          >
                            {content}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </div>

          {/* Footer with pagination + totals */}
          <div className="border-t border-border px-4 py-2.5 flex justify-between items-center text-sm bg-surface">
            {/* Pagination */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
                className="p-1 rounded hover:bg-surface-hover disabled:opacity-30 transition-colors"
              >
                <ChevronsLeft size={16} />
              </button>
              <button
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="p-1 rounded hover:bg-surface-hover disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-text-muted text-xs px-2">
                Page {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
              </span>
              <button
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="p-1 rounded hover:bg-surface-hover disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
                className="p-1 rounded hover:bg-surface-hover disabled:opacity-30 transition-colors"
              >
                <ChevronsRight size={16} />
              </button>
              <span className="text-text-muted text-xs ml-2">
                {table.getFilteredRowModel().rows.length} ops
                {globalFilter && ` (filtrées sur ${operations.length})`}
              </span>
            </div>

            {/* Totals */}
            <div className="flex gap-6 text-xs font-mono">
              <span>
                Débits: <span className="text-danger font-semibold">{formatCurrency(stats.totalDebit)}</span>
              </span>
              <span>
                Crédits: <span className="text-success font-semibold">{formatCurrency(stats.totalCredit)}</span>
              </span>
              <span>
                Solde: <span className={cn('font-semibold', stats.solde >= 0 ? 'text-success' : 'text-danger')}>
                  {formatCurrency(stats.solde)}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes indicator */}
      {hasChanges && (
        <div className="fixed bottom-4 right-4 bg-warning/90 text-black px-4 py-2 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 z-50">
          <AlertTriangle size={16} />
          Modifications non sauvegardées
          <button
            onClick={handleSave}
            className="ml-2 bg-black/20 hover:bg-black/30 px-2 py-0.5 rounded text-xs transition-colors"
          >
            Sauvegarder (Ctrl+S)
          </button>
        </div>
      )}

      {/* PDF Preview Drawer */}
      {pdfDrawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setPdfDrawerOpen(false)} />
          <div
            className="fixed right-0 top-0 h-full bg-surface border-l border-border z-50 flex flex-col shadow-2xl"
            style={{ width: Math.min(Math.max(pdfDrawerWidth, 400), 1200) }}
          >
            {/* Resize handle */}
            <div
              className="absolute left-0 top-0 h-full w-2 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
              onMouseDown={(e) => {
                e.preventDefault()
                pdfResizing.current = true
                const startX = e.clientX
                const startW = pdfDrawerWidth
                const onMove = (ev: MouseEvent) => {
                  if (!pdfResizing.current) return
                  const delta = startX - ev.clientX
                  setPdfDrawerWidth(Math.min(Math.max(startW + delta, 400), 1200))
                }
                const onUp = () => {
                  pdfResizing.current = false
                  document.removeEventListener('mousemove', onMove)
                  document.removeEventListener('mouseup', onUp)
                }
                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
              }}
            />
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText size={18} />
                Relevé PDF original
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (selectedFile) {
                      api.post(`/operations/${selectedFile}/pdf/open-native`)
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-sm transition-colors"
                  title="Ouvrir dans Aperçu (macOS)"
                >
                  <Download size={14} />
                  Ouvrir dans Aperçu
                </button>
                <button
                  onClick={() => setPdfDrawerOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <iframe
              src={`/api/operations/${selectedFile}/pdf`}
              className="flex-1 w-full"
              title="Relevé PDF original"
            />
          </div>
        </>
      )}

      {/* Preview justificatif attribué */}
      {previewJustifFile && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setPreviewJustifFile(null)} />
          <div className="fixed top-0 right-0 h-full w-[600px] max-w-[95vw] bg-background border-l border-border z-50 flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={18} className="text-emerald-400 shrink-0" />
                <p className="text-sm font-semibold text-text truncate">{previewJustifFile}</p>
              </div>
              <button onClick={() => setPreviewJustifFile(null)} className="p-1 text-text-muted hover:text-text">
                <X size={18} />
              </button>
            </div>
            <div className="relative flex-1 min-h-0 bg-white group/pdfpreview">
              <object
                data={`/api/justificatifs/${encodeURIComponent(previewJustifFile)}/preview`}
                type="application/pdf"
                className="w-full h-full"
              >
                <p className="text-center text-text-muted text-sm p-8">Aperçu PDF non disponible</p>
              </object>
              {/* Overlay cliquable transparent — couvre tout le PDF pour déclencher l'agrandissement */}
              <button
                onClick={() => setShowJustifPreviewSub(true)}
                className="absolute inset-0 w-full h-full cursor-pointer bg-transparent hover:bg-black/5 transition-colors z-10"
                title="Cliquer pour agrandir à gauche"
                aria-label="Agrandir le justificatif"
              />
              {/* Badge "Agrandir" visible au hover, centré pour indiquer la zone cliquable */}
              <span className="pointer-events-none absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-white/95 text-black rounded-md shadow-lg border border-border/50 opacity-80 group-hover/pdfpreview:opacity-100 transition-opacity z-20">
                <Expand size={12} />
                Agrandir
              </span>
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
              <button
                onClick={() => {
                  if (previewJustifFile) {
                    api.post(`/justificatifs/${previewJustifFile}/open-native`)
                  }
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-text border border-border rounded-lg hover:bg-surface-hover transition-colors"
              >
                <Download size={14} />
                Ouvrir dans Aperçu
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (selectedFile && previewJustifOpIndex !== null) {
                      dissociateMutation.mutate(
                        { operation_file: selectedFile, operation_index: previewJustifOpIndex },
                        {
                          onSuccess: () => {
                            toast.success('Justificatif dissocié')
                            setPreviewJustifFile(null)
                            setPreviewJustifOpIndex(null)
                          },
                        }
                      )
                    }
                  }}
                  disabled={dissociateMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-400 border border-red-400/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  <Unlink size={14} />
                  {dissociateMutation.isPending ? 'Dissociation...' : 'Dissocier'}
                </button>
                <button
                  onClick={() => {
                    if (!previewJustifFile) return
                    const op = previewJustifOpIndex !== null ? operations[previewJustifOpIndex] : null
                    const libelle = op?.['Libellé'] ?? null
                    showDeleteConfirmToast(previewJustifFile, libelle, () => {
                      deleteJustifMutation.mutate(previewJustifFile!, {
                        onSuccess: (result) => {
                          showDeleteSuccessToast(result)
                          setPreviewJustifFile(null)
                          setPreviewJustifOpIndex(null)
                        },
                        onError: (err: Error) => toast.error(`Erreur : ${err.message}`),
                      })
                    })
                  }}
                  disabled={deleteJustifMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-400 border border-red-400/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  {deleteJustifMutation.isPending ? 'Suppression...' : 'Supprimer'}
                </button>
              </div>
            </div>
          </div>
          {/* Sous-drawer preview grand format à gauche du main drawer */}
          <PreviewSubDrawer
            filename={showJustifPreviewSub ? previewJustifFile : null}
            mainDrawerOpen={!!previewJustifFile}
            mainDrawerWidth={600}
            width={700}
            onOpenNative={(name) => {
              api.post(`/justificatifs/${name}/open-native`)
            }}
            onClose={() => setShowJustifPreviewSub(false)}
          />
        </>
      )}

      {/* Attribution justificatif Drawer (workflow unifié) */}
      <RapprochementWorkflowDrawer
        isOpen={drawerOpen}
        operations={operations}
        initialIndex={drawerOpIndex ?? undefined}
        initialVentilationIndex={drawerInitialVentIdx ?? undefined}
        fallbackFilename={selectedFile ?? undefined}
        onClose={() => {
          setDrawerOpen(false)
          setDrawerOpIndex(null)
          setDrawerInitialVentIdx(null)
        }}
      />

      {/* Ventilation Drawer */}
      <VentilationDrawer
        open={ventilationOpen}
        onClose={() => { setVentilationOpen(false); setVentilationOpIndex(null) }}
        filename={selectedFile}
        opIndex={ventilationOpIndex}
        operation={ventilationOpIndex !== null ? operations[ventilationOpIndex] : null}
      />

      {/* Barre d'actions flottante bulk-lock (masquée en year-wide) */}
      {!allYearMode && (
        <BulkLockBar
          count={lockSelectedCount}
          loading={bulkLockMutation.isPending}
          shifted={false}
          allLocked={lockSelectedAllLocked}
          onLock={handleBulkLock}
          onClose={clearLockSelection}
        />
      )}

      {/* Snapshots — modal création + drawers */}
      <SnapshotCreateModal
        open={snapshotCreateOpen}
        onClose={() => setSnapshotCreateOpen(false)}
        ops_refs={selectedOpsRefs}
        suggestedName={suggestedSnapshotName}
        context_year={selectedYear ?? null}
        context_month={(() => {
          const finfo = files?.find(f => f.filename === selectedFile)
          return finfo?.month ?? null
        })()}
        context_filters={{
          globalFilter: globalFilter || undefined,
          columnFilters: columnFilters.length > 0 ? columnFilters : undefined,
          allYearMode: allYearMode || undefined,
        }}
        onCreated={() => setRowSelection({})}
      />
      <SnapshotsListDrawer
        open={snapshotsListOpen}
        onClose={() => setSnapshotsListOpen(false)}
        onView={(snap) => { setSnapshotViewerId(snap.id); setSnapshotsListOpen(false) }}
      />
      <SnapshotViewerDrawer
        open={snapshotViewerId !== null}
        snapshotId={snapshotViewerId}
        onClose={() => setSnapshotViewerId(null)}
      />

      {/* Association manuelle drawer (outil 2-colonnes ops|justificatifs) */}
      <ManualAssociationDrawer
        open={manualAssocDrawerOpen}
        onClose={() => {
          setManualAssocDrawerOpen(false)
          setRowSelection({})
        }}
        year={selectedYear ?? new Date().getFullYear()}
        month={manualAssocMonth}
        targetedOps={manualAssocTargetedOps}
      />
    </div>
  )
}
