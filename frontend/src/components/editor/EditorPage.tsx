import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  Save, Bot, Plus, Trash2, Filter, Loader2, Check, Search,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  CheckSquare, Square, ArrowUpDown, ArrowUp, ArrowDown,
  AlertTriangle, Star, Paperclip, X, Download, RotateCcw, FileText,
  CheckCircle2, Circle,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import RapprochementDrawer from '@/components/rapprochement/RapprochementDrawer'
import { useOperationFiles, useOperations, useSaveOperations, useCategorizeOperations, useHasPdf } from '@/hooks/useOperations'
import { useCategories } from '@/hooks/useApi'
import { useBatchHints } from '@/hooks/useRapprochement'
import { useLettrageStats, useToggleLettrage, useBulkLettrage } from '@/hooks/useLettrage'
import { formatCurrency, formatFileTitle, cn } from '@/lib/utils'
import AlerteBadge from '@/components/AlerteBadge'
import type { Operation, CategoryRaw } from '@/types'

// Editable cell component
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
      value={value ?? ''}
      onChange={e => {
        if (type === 'number') {
          onChange(parseFloat(e.target.value) || 0)
        } else {
          onChange(e.target.value)
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

// Checkbox cell
function CheckboxCell({
  checked,
  onChange,
  accentClass = 'accent-primary',
}: {
  checked: boolean
  onChange: (val: boolean) => void
  accentClass?: string
}) {
  return (
    <div className="flex justify-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className={cn('w-3.5 h-3.5 cursor-pointer', accentClass)}
      />
    </div>
  )
}

export default function EditorPage() {
  const [searchParams] = useSearchParams()
  const { data: files, isLoading: filesLoading } = useOperationFiles()
  const { data: categoriesData } = useCategories()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const { data: rawOperations, isLoading: opsLoading } = useOperations(selectedFile)

  const [operations, setOperations] = useState<Operation[]>([])
  const [hasChanges, setHasChanges] = useState(false)
  const [undoStack, setUndoStack] = useState<Operation[][]>([])

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([{ id: 'Date', desc: true }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  // UI state
  const [showFilters, setShowFilters] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [pageSize, setPageSize] = useState(50)

  // PDF preview state
  const { data: pdfStatus } = useHasPdf(selectedFile)
  const [pdfDrawerOpen, setPdfDrawerOpen] = useState(false)

  // Lettrage
  const { data: lettrageStats } = useLettrageStats(selectedFile)
  const toggleLettrageMutation = useToggleLettrage()
  const bulkLettrageMutation = useBulkLettrage()

  // Rapprochement state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerOpIndex, setDrawerOpIndex] = useState<number | null>(null)
  const { data: batchHints } = useBatchHints(selectedFile)

  const saveMutation = useSaveOperations()
  const categorizeMutation = useCategorizeOperations()
  const searchRef = useRef<HTMLInputElement>(null)

  // Auto-select file from query param or first file
  useEffect(() => {
    if (!files || files.length === 0) return
    if (selectedFile) return
    const fileParam = searchParams.get('file')
    if (fileParam && files.some(f => f.filename === fileParam)) {
      setSelectedFile(fileParam)
    } else {
      setSelectedFile(files[0].filename)
    }
  }, [files, selectedFile, searchParams])

  // Sync operations when loaded from API
  useEffect(() => {
    if (rawOperations) {
      setOperations([...rawOperations])
      setHasChanges(false)
      setUndoStack([])
      setRowSelection({})
    }
  }, [rawOperations])

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
  const addRow = useCallback(() => {
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
    }
    setOperations(prev => [newOp, ...prev])
    setHasChanges(true)
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
    saveMutation.mutate(
      { filename: selectedFile, operations },
      {
        onSuccess: () => {
          setHasChanges(false)
          setSaveSuccess(true)
          setTimeout(() => setSaveSuccess(false), 3000)
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
    // Selection checkbox
    {
      id: 'select',
      header: ({ table }) => (
        <div className="flex justify-center">
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            className="w-3.5 h-3.5 cursor-pointer accent-primary"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center">
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            className="w-3.5 h-3.5 cursor-pointer accent-primary"
          />
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
      size: 100,
      cell: ({ row }) => (
        <EditableCell
          type="number"
          value={row.original['Débit'] || ''}
          onChange={val => updateOperation(row.index, 'Débit', val)}
          className="text-right text-danger"
        />
      ),
      meta: { align: 'right' },
    },
    // Crédit
    {
      accessorKey: 'Crédit',
      header: 'Crédit',
      size: 100,
      cell: ({ row }) => (
        <EditableCell
          type="number"
          value={row.original['Crédit'] || ''}
          onChange={val => updateOperation(row.index, 'Crédit', val)}
          className="text-right text-success"
        />
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
        return (
          <div className="relative">
            {color && (
              <div
                className="absolute left-0 top-0 bottom-0 w-1 rounded-full"
                style={{ backgroundColor: color }}
              />
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
      filterFn: 'equals',
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
    // Justificatif — interactive paperclip
    {
      accessorKey: 'Justificatif',
      header: () => <Paperclip size={14} className="mx-auto" title="Justificatif" />,
      size: 40,
      cell: ({ row }) => {
        const hasJustif = row.original.Justificatif || false
        const hintScore = batchHints?.[String(row.index)]
        const hasStrongHint = !hasJustif && hintScore != null && hintScore >= 0.75
        return (
          <div className="flex justify-center">
            <button
              onClick={() => {
                setDrawerOpIndex(row.index)
                setDrawerOpen(true)
              }}
              className="relative p-0.5 rounded hover:bg-surface-hover transition-colors"
              title={
                hasJustif
                  ? `Associé${row.original.rapprochement_mode === 'auto' ? ' (auto)' : ''}`
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
          </div>
        )
      },
      enableSorting: false,
    },
    // Important
    {
      accessorKey: 'Important',
      header: () => <Star size={14} className="mx-auto text-warning" title="Important" />,
      size: 40,
      cell: ({ row }) => (
        <CheckboxCell
          checked={row.original.Important || false}
          onChange={val => updateOperation(row.index, 'Important', val)}
          accentClass="accent-warning"
        />
      ),
      enableSorting: false,
    },
    // A_revoir
    {
      accessorKey: 'A_revoir',
      header: () => <AlertTriangle size={14} className="mx-auto text-danger" title="À revoir" />,
      size: 40,
      cell: ({ row }) => (
        <CheckboxCell
          checked={row.original.A_revoir || false}
          onChange={val => updateOperation(row.index, 'A_revoir', val)}
          accentClass="accent-danger"
        />
      ),
      enableSorting: false,
    },
    // Lettrée
    {
      accessorKey: 'lettre',
      header: () => <CheckCircle2 size={14} className="mx-auto text-emerald-400" title="Pointée" />,
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
              className="p-0.5 rounded hover:bg-surface-hover transition-colors"
              title={isLettre ? 'Lettrée' : 'Non lettrée'}
            >
              {isLettre
                ? <CheckCircle2 size={14} className="text-emerald-400" />
                : <Circle size={14} className="text-text-muted/30" />
              }
            </button>
          </div>
        )
      },
      enableSorting: false,
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
    // Delete
    {
      id: 'actions',
      header: '',
      size: 40,
      cell: ({ row }) => (
        <button
          onClick={() => deleteRow(row.index)}
          className="text-text-muted hover:text-danger transition-colors p-1 rounded hover:bg-danger/10"
          title="Supprimer"
        >
          <Trash2 size={14} />
        </button>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [categoryNames, subcategoriesMap, categoryColors, updateOperation, deleteRow, batchHints, selectedFile])

  // TanStack Table instance
  const table = useReactTable({
    data: operations,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      rowSelection,
      pagination: { pageIndex: 0, pageSize },
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: 'includesString',
    enableRowSelection: true,
  })

  const selectedCount = Object.keys(rowSelection).length

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
            {/* Undo */}
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover disabled:opacity-30 transition-colors"
              title="Annuler (Ctrl+Z)"
            >
              <RotateCcw size={15} />
            </button>

            {/* Export CSV */}
            <button
              onClick={handleExportCSV}
              disabled={operations.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover disabled:opacity-30 transition-colors"
              title="Exporter en CSV"
            >
              <Download size={15} />
            </button>

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

            {/* IA (vides) */}
            <button
              onClick={() => handleCategorize('empty_only')}
              disabled={!selectedFile || categorizeMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover disabled:opacity-50 transition-colors"
            >
              <Bot size={15} />
              {categorizeMutation.isPending ? 'IA...' : 'IA (vides)'}
            </button>

            {/* IA (tout) */}
            <button
              onClick={() => handleCategorize('all')}
              disabled={!selectedFile || categorizeMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary/10 text-primary border border-primary/30 rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-colors"
            >
              <Bot size={15} />
              IA (tout)
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
          </div>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-3">
        {/* File selector */}
        <select
          value={selectedFile || ''}
          onChange={e => {
            setSelectedFile(e.target.value || null)
            setRowSelection({})
          }}
          className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text flex-1 max-w-xs"
        >
          <option value="">Sélectionner un fichier...</option>
          {files?.map(f => (
            <option key={f.filename} value={f.filename}>
              {formatFileTitle(f)} ({f.count} ops)
            </option>
          ))}
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

        {/* Add row */}
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover transition-colors"
        >
          <Plus size={15} />
          Ligne
        </button>

        {/* Batch delete */}
        {selectedCount > 0 && (
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
        <div className="bg-surface rounded-xl border border-border p-4 mb-3 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-text-muted mb-1.5 block font-medium">Catégorie</label>
            <select
              value={(table.getColumn('Catégorie')?.getFilterValue() as string) ?? ''}
              onChange={e => table.getColumn('Catégorie')?.setFilterValue(e.target.value || undefined)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text"
            >
              <option value="">Toutes les catégories</option>
              {categoryNames.map(c => <option key={c} value={c}>{c}</option>)}
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
          <div className="md:col-span-2">
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
      {opsLoading ? (
        <LoadingSpinner text="Chargement des opérations..." />
      ) : !selectedFile ? (
        <div className="bg-surface rounded-xl border border-border p-16 text-center">
          <div className="text-text-muted">
            <Paperclip size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg mb-2">Aucun fichier sélectionné</p>
            <p className="text-sm">Sélectionnez un fichier dans la liste ci-dessus pour commencer l'édition.</p>
          </div>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden flex-1 flex flex-col">
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
                {table.getRowModel().rows.map(row => (
                  <tr
                    key={row.id}
                    className={cn(
                      'border-b border-border/20 transition-colors',
                      row.getIsSelected() ? 'bg-primary/5' : 'hover:bg-surface-hover',
                      row.original.Important ? 'border-l-2 border-l-warning' : '',
                      row.original.A_revoir ? 'border-l-2 border-l-danger' : '',
                      row.original.lettre ? 'opacity-60' : '',
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
                ))}
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
          <div className="fixed right-0 top-0 h-full w-[700px] max-w-[90vw] bg-surface border-l border-border z-50 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText size={18} />
                Relevé PDF original
              </h2>
              <button
                onClick={() => setPdfDrawerOpen(false)}
                className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <iframe
              src={`/api/operations/${selectedFile}/pdf`}
              className="flex-1 w-full"
              title="Relevé PDF original"
            />
          </div>
        </>
      )}

      {/* Rapprochement Drawer */}
      <RapprochementDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerOpIndex(null) }}
        mode="operation"
        operationFile={selectedFile || undefined}
        operationIndex={drawerOpIndex ?? undefined}
        operation={drawerOpIndex !== null ? operations[drawerOpIndex] : undefined}
      />
    </div>
  )
}
