import { useState, useMemo, useEffect, useRef } from 'react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { RefreshCw, AlertTriangle, FileX, Tag, Copy, Eye, X, Download, FileText, FileSpreadsheet, Loader2, ChevronDown } from 'lucide-react'
import ReconstituerButton from '@/components/ocr/ReconstituerButton'
import toast from 'react-hot-toast'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import AlerteBadge from '@/components/AlerteBadge'
import { useAlertesSummary, useAlertesFichier, useResolveAlerte, useRefreshAlertes, useExportCompteAttente, downloadCompteAttenteExport } from '@/hooks/useAlertes'
import { useCategories } from '@/hooks/useApi'
import { formatCurrency, formatDate, cn, MOIS_FR } from '@/lib/utils'
import type { Operation, AlerteType } from '@/types'

const ALERTE_PRIORITY: Record<AlerteType, number> = {
  montant_a_verifier: 0,
  justificatif_manquant: 1,
  doublon_suspect: 2,
  a_categoriser: 3,
  confiance_faible: 4,
}

function alertePriority(op: Operation): number {
  const alertes = op.alertes || []
  if (alertes.length === 0) return 99
  return Math.min(...alertes.map((a) => ALERTE_PRIORITY[a] ?? 5))
}

export default function AlertesPage() {
  const { data: summary, isLoading: isSummaryLoading } = useAlertesSummary()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const { selectedYear, setYear } = useFiscalYearStore()
  const { data: operations, isLoading: isOpsLoading } = useAlertesFichier(selectedFile)
  const resolveMutation = useResolveAlerte()
  const refreshMutation = useRefreshAlertes()
  const exportMutation = useExportCompteAttente()
  const [drawerOp, setDrawerOp] = useState<Operation | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [subcategoryFilter, setSubcategoryFilter] = useState<string>('')
  const { data: categoriesData } = useCategories()

  const hasAutoSelected = useRef(false)

  // Fermer le dropdown au clic extérieur
  useEffect(() => {
    if (!showExportMenu) return
    const handleClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showExportMenu])

  // Années et fichiers filtrés par année
  const availableYears = useMemo(() => {
    if (!summary?.par_fichier) return []
    const years = [...new Set(summary.par_fichier.filter(f => f.year).map(f => f.year!))]
    return years.sort((a, b) => a - b)
  }, [summary])

  const filesForYear = useMemo(() => {
    if (!summary?.par_fichier || !selectedYear) return []
    return summary.par_fichier
      .filter(f => f.year === selectedYear)
      .sort((a, b) => (a.month ?? 0) - (b.month ?? 0))
  }, [summary, selectedYear])

  // Auto-sélection du fichier pour l'année du store
  useEffect(() => {
    if (hasAutoSelected.current) return
    if (!summary?.par_fichier || summary.par_fichier.length === 0) return

    hasAutoSelected.current = true

    const filesOfYear = summary.par_fichier
      .filter(f => f.year === selectedYear)
      .sort((a, b) => (a.month ?? 0) - (b.month ?? 0))
    if (filesOfYear.length > 0) {
      setSelectedFile(filesOfYear[0].filename)
    } else if (summary.par_fichier.length > 0) {
      setSelectedFile(summary.par_fichier[0].filename)
    }
  }, [summary, selectedYear])

  // Sous-catégories par catégorie
  const subcategoriesMap = useMemo(() => {
    const map: Record<string, string[]> = {}
    if (categoriesData?.categories) {
      for (const cat of categoriesData.categories) {
        map[cat.name] = cat.subcategories.map((s) => s.name)
      }
    }
    return map
  }, [categoriesData])

  // Liste complète des catégories depuis le référentiel
  const allCategories = useMemo(() => {
    if (!categoriesData?.categories) return []
    return categoriesData.categories.map((c) => c.name).sort()
  }, [categoriesData])

  // Sous-catégories complètes pour la catégorie filtrée
  const allSubcategories = useMemo(() => {
    if (!categoryFilter) return []
    return subcategoriesMap[categoryFilter] || []
  }, [categoryFilter, subcategoriesMap])

  // Reset sous-catégorie quand la catégorie change
  useEffect(() => {
    setSubcategoryFilter('')
  }, [categoryFilter])

  const sortedOps = useMemo(() => {
    let ops = [...(operations || [])]
    if (categoryFilter) {
      ops = ops.filter((op) => op['Catégorie'] === categoryFilter)
    }
    if (subcategoryFilter) {
      ops = ops.filter((op) => op['Sous-catégorie'] === subcategoryFilter)
    }
    return ops.sort((a, b) => alertePriority(a) - alertePriority(b))
  }, [operations, categoryFilter, subcategoryFilter])

  const columns = useMemo<ColumnDef<Operation>[]>(() => [
    {
      accessorKey: 'Date',
      header: 'Date',
      size: 100,
      cell: ({ getValue }) => formatDate(getValue() as string),
    },
    {
      accessorKey: 'Libellé',
      header: 'Libellé',
      size: 300,
      cell: ({ row }) => {
        const isNoteDeFrais = row.original.source === 'note_de_frais'
        return (
          <div className="flex flex-col">
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
            <span>{row.original['Libellé']}</span>
          </div>
        )
      },
    },
    {
      accessorKey: 'Débit',
      header: 'Débit',
      size: 110,
      cell: ({ getValue }) => {
        const v = getValue() as number
        return v ? formatCurrency(v) : ''
      },
    },
    {
      accessorKey: 'Crédit',
      header: 'Crédit',
      size: 110,
      cell: ({ getValue }) => {
        const v = getValue() as number
        return v ? formatCurrency(v) : ''
      },
    },
    {
      id: 'alertes',
      header: 'Alertes',
      size: 200,
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
    {
      id: 'actions',
      header: '',
      size: 50,
      cell: ({ row }) => (
        <button
          onClick={(e) => { e.stopPropagation(); setDrawerOp(row.original) }}
          className="p-1 text-text-muted hover:text-text"
        >
          <Eye size={16} />
        </button>
      ),
      enableSorting: false,
    },
  ], [])

  const table = useReactTable({
    data: sortedOps,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const handleRefresh = () => {
    if (!selectedFile) return
    refreshMutation.mutate(
      { filename: selectedFile },
      {
        onSuccess: (data) => {
          const res = data as { nb_alertes: number; nb_operations: number }
          toast.success(`Recalcul terminé : ${res.nb_alertes} alerte(s) sur ${res.nb_operations} opérations`)
        },
        onError: () => toast.error('Erreur lors du recalcul'),
      },
    )
  }

  const handleResolve = (op: Operation, alerteType: AlerteType) => {
    if (!selectedFile || op._index == null) return
    resolveMutation.mutate(
      { filename: selectedFile, index: op._index, alerte_type: alerteType },
      {
        onSuccess: (data) => {
          toast.success('Alerte résolue')
          const updated = data as Operation
          if ((updated.alertes || []).length === 0) {
            setDrawerOp(null)
          } else {
            setDrawerOp(updated)
          }
        },
        onError: () => toast.error('Erreur lors de la résolution'),
      },
    )
  }

  // Mois sélectionné (pour le label dropdown)
  const selectedMonth = useMemo(() => {
    if (!selectedFile || !summary?.par_fichier) return null
    const entry = summary.par_fichier.find(f => f.filename === selectedFile)
    return entry?.month ?? null
  }, [selectedFile, summary])

  const handleExport = (format: 'pdf' | 'csv', wholeYear: boolean) => {
    setShowExportMenu(false)
    const params = wholeYear
      ? { year: selectedYear, format }
      : { year: selectedYear, month: selectedMonth ?? undefined, format }
    exportMutation.mutate(params, {
      onSuccess: (data) => {
        toast.success(`Export généré : ${data.nb_operations} opération(s)`)
        downloadCompteAttenteExport(data.filename)
      },
      onError: () => toast.error("Erreur lors de l'export"),
    })
  }

  if (isSummaryLoading) return <LoadingSpinner />

  const parType = summary?.par_type || {
    justificatif_manquant: 0,
    a_categoriser: 0,
    montant_a_verifier: 0,
    doublon_suspect: 0,
    confiance_faible: 0,
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Compte d'attente"
        description="Opérations nécessitant une action"
        actions={
          <div className="flex items-center gap-2">
            {/* Export dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(prev => !prev)}
                disabled={exportMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-surface border border-border text-text rounded-lg hover:bg-surface-hover disabled:opacity-50"
              >
                {exportMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                Exporter
                <ChevronDown size={14} />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 mt-1 w-64 bg-surface border border-border rounded-lg shadow-lg z-50 py-1">
                  {selectedMonth && (
                    <>
                      <button
                        onClick={() => handleExport('pdf', false)}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-text hover:bg-surface-hover"
                      >
                        <FileText size={16} className="text-red-400" />
                        PDF — {MOIS_FR[selectedMonth - 1]}
                      </button>
                      <button
                        onClick={() => handleExport('csv', false)}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-text hover:bg-surface-hover"
                      >
                        <FileSpreadsheet size={16} className="text-green-400" />
                        CSV — {MOIS_FR[selectedMonth - 1]}
                      </button>
                      <div className="border-t border-border my-1" />
                    </>
                  )}
                  <button
                    onClick={() => handleExport('pdf', true)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-text hover:bg-surface-hover"
                  >
                    <FileText size={16} className="text-red-400" />
                    PDF — Année {selectedYear}
                  </button>
                  <button
                    onClick={() => handleExport('csv', true)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-text hover:bg-surface-hover"
                  >
                    <FileSpreadsheet size={16} className="text-green-400" />
                    CSV — Année {selectedYear}
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleRefresh}
              disabled={!selectedFile || refreshMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshMutation.isPending ? 'animate-spin' : ''} />
              Rafraîchir
            </button>
          </div>
        }
      />

      {/* MetricCards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard
          title="Total en attente"
          value={String(summary?.total_en_attente ?? 0)}
          icon={<AlertTriangle size={20} className="text-warning" />}
        />
        <MetricCard
          title="Justif. manquants"
          value={String(parType.justificatif_manquant)}
          icon={<FileX size={20} className="text-orange-400" />}
        />
        <MetricCard
          title="À catégoriser"
          value={String(parType.a_categoriser)}
          icon={<Tag size={20} className="text-yellow-400" />}
        />
        <MetricCard
          title="Montants suspects"
          value={String(parType.montant_a_verifier)}
          icon={<AlertTriangle size={20} className="text-danger" />}
        />
        <MetricCard
          title="Doublons"
          value={String(parType.doublon_suspect)}
          icon={<Copy size={20} className="text-purple-400" />}
        />
      </div>

      {/* File selector — Année + Mois */}
      {summary?.par_fichier && summary.par_fichier.length > 0 && (
        <div className="flex items-center gap-3">
          {/* Year selector */}
          <select
            value={selectedYear}
            onChange={(e) => {
              const yr = e.target.value ? Number(e.target.value) : null
              if (yr) setYear(yr)
              setSelectedFile(null)
              // Auto-sélectionner le premier mois de l'année
              if (yr && summary?.par_fichier) {
                const first = summary.par_fichier
                  .filter(f => f.year === yr)
                  .sort((a, b) => (a.month ?? 0) - (b.month ?? 0))[0]
                if (first) setSelectedFile(first.filename)
              }
            }}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text w-28"
          >
            <option value="">Année...</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {/* Month buttons */}
          {filesForYear.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {filesForYear.map((f) => (
                <button
                  key={f.filename}
                  onClick={() => setSelectedFile(f.filename)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                    selectedFile === f.filename
                      ? 'bg-primary text-white border-primary'
                      : 'bg-surface border-border text-text-muted hover:text-text hover:border-primary/50',
                  )}
                >
                  {MOIS_FR[(f.month ?? 1) - 1]}
                  <span className="ml-2 text-xs opacity-75">({f.nb_alertes})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filtres catégorie / sous-catégorie */}
      {selectedFile && (operations || []).length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text min-w-[180px]"
          >
            <option value="">Toutes les catégories</option>
            {allCategories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <select
            value={subcategoryFilter}
            onChange={(e) => setSubcategoryFilter(e.target.value)}
            disabled={!categoryFilter}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text min-w-[180px] disabled:opacity-40"
          >
            <option value="">Toutes les sous-catégories</option>
            {allSubcategories.map((sub) => (
              <option key={sub} value={sub}>{sub}</option>
            ))}
          </select>

          {(categoryFilter || subcategoryFilter) && (
            <button
              onClick={() => { setCategoryFilter(''); setSubcategoryFilter('') }}
              className="flex items-center gap-1 px-2.5 py-2 text-xs text-text-muted hover:text-text rounded-lg hover:bg-surface transition-colors"
            >
              <X size={14} />
              Réinitialiser
            </button>
          )}

          <span className="text-xs text-text-muted ml-auto">
            {sortedOps.length} opération{sortedOps.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {summary?.par_fichier?.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          Aucune opération en compte d'attente
        </div>
      )}

      {/* Operations table */}
      {selectedFile && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {isOpsLoading ? (
            <div className="p-8">
              <LoadingSpinner text="Chargement des opérations..." />
            </div>
          ) : sortedOps.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              Aucune alerte pour ce fichier
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id} className="border-b border-border">
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider"
                          style={{ width: header.getSize() }}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/50 hover:bg-surface-hover cursor-pointer transition-colors"
                      onClick={() => setDrawerOp(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3 text-sm text-text">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Resolution drawer */}
      {drawerOp && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setDrawerOp(null)}
          />
          <div className="fixed right-0 top-0 h-full w-[500px] bg-surface border-l border-border z-50 overflow-y-auto shadow-xl transform transition-transform">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text">Détail de l'opération</h2>
                <button onClick={() => setDrawerOp(null)} className="text-text-muted hover:text-text">
                  <X size={20} />
                </button>
              </div>

              {/* Operation detail */}
              <div className="space-y-3 bg-background rounded-lg p-4">
                <div className="flex justify-between">
                  <span className="text-text-muted text-sm">Date</span>
                  <span className="text-text text-sm">{formatDate(drawerOp.Date)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted text-sm">Libellé</span>
                  <span className="text-text text-sm text-right max-w-[280px]">{drawerOp['Libellé']}</span>
                </div>
                {drawerOp['Débit'] ? (
                  <div className="flex justify-between">
                    <span className="text-text-muted text-sm">Débit</span>
                    <span className="text-danger text-sm">{formatCurrency(drawerOp['Débit'])}</span>
                  </div>
                ) : null}
                {drawerOp['Crédit'] ? (
                  <div className="flex justify-between">
                    <span className="text-text-muted text-sm">Crédit</span>
                    <span className="text-success text-sm">{formatCurrency(drawerOp['Crédit'])}</span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-text-muted text-sm">Catégorie</span>
                  <span className="text-text text-sm">{drawerOp['Catégorie'] || '—'}</span>
                </div>
              </div>

              {/* Active alerts */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-text">Alertes actives</h3>
                {(drawerOp.alertes || []).map((type) => (
                  <div
                    key={type}
                    className="flex items-center justify-between bg-background rounded-lg p-3"
                  >
                    <AlerteBadge type={type} size="md" />
                    <div className="flex items-center gap-2">
                      {type === 'justificatif_manquant' && selectedFile && drawerOp._index != null && (
                        <ReconstituerButton
                          operationFile={selectedFile}
                          operationIndex={drawerOp._index}
                          libelle={drawerOp['Libellé'] || ''}
                          size="sm"
                          onGenerated={() => refreshMutation.mutate({ filename: selectedFile })}
                        />
                      )}
                      <button
                        onClick={() => handleResolve(drawerOp, type)}
                        disabled={resolveMutation.isPending}
                        className="px-3 py-1 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
                      >
                        Marquer résolue
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Resolved alerts */}
              {drawerOp.alertes_resolues && drawerOp.alertes_resolues.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-text-muted">Alertes résolues</h3>
                  <div className="flex gap-1 flex-wrap opacity-50">
                    {drawerOp.alertes_resolues.map((type) => (
                      <AlerteBadge key={type} type={type} size="sm" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
