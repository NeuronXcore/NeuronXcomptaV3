import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { RefreshCw, AlertTriangle, FileX, Tag, Copy, Eye, X, Download, FileText, FileSpreadsheet, Loader2, ChevronDown, Paperclip, Link2, ExternalLink } from 'lucide-react'
import ReconstituerButton from '@/components/ocr/ReconstituerButton'
import { useImmobilisations } from '@/hooks/useAmortissements'
import { useImmobilisationDrawerStore } from '@/stores/immobilisationDrawerStore'
import ImmoBadge from '@/components/shared/ImmoBadge'
import DotationBadge from '@/components/shared/DotationBadge'
import ForfaitBadge from '@/components/shared/ForfaitBadge'
import RapprochementWorkflowDrawer from '@/components/rapprochement/RapprochementWorkflowDrawer'
import ManualAssociationDrawer, { type TargetedOp } from '@/components/justificatifs/ManualAssociationDrawer'
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
import { formatCurrency, formatDate, cn, MOIS_FR, matchesOperationType, type OperationTypeFilter } from '@/lib/utils'
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: summary, isLoading: isSummaryLoading } = useAlertesSummary()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const { selectedYear, setYear } = useFiscalYearStore()
  const { data: immosList } = useImmobilisations()
  const immosMap = useMemo(
    () => Object.fromEntries((immosList ?? []).map((i) => [i.id, i])),
    [immosList],
  )
  const openImmoDrawer = useImmobilisationDrawerStore((s) => s.open)
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
  const [sourceFilter, setSourceFilter] = useState<OperationTypeFilter>('all')
  const [alerteTypeFilter, setAlerteTypeFilter] = useState<AlerteType | 'all'>('all')
  const { data: categoriesData } = useCategories()

  // ── Drawers d'association
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false)
  const [workflowInitialIndex, setWorkflowInitialIndex] = useState<number | null>(null)
  const [manualDrawerOpen, setManualDrawerOpen] = useState(false)

  // ── Multi-sélection (clé `filename:index`) — pour batch via ManualAssociationDrawer
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set())

  const invalidateAlertesCaches = () => {
    queryClient.invalidateQueries({ queryKey: ['alertes'] })
    queryClient.invalidateQueries({ queryKey: ['alertes-summary'] })
    queryClient.invalidateQueries({ queryKey: ['operations'] })
    queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
  }

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
    if (sourceFilter !== 'all') {
      ops = ops.filter((op) => matchesOperationType(op, sourceFilter))
    }
    if (alerteTypeFilter !== 'all') {
      ops = ops.filter((op) => (op.alertes || []).includes(alerteTypeFilter))
    }
    return ops.sort((a, b) => alertePriority(a) - alertePriority(b))
  }, [operations, categoryFilter, subcategoryFilter, sourceFilter, alerteTypeFilter])

  // ── Mois de référence (utilisé pour ManualAssociationDrawer + actions contextuelles)
  const selectedMonth = useMemo(() => {
    if (!selectedFile || !summary?.par_fichier) return null
    const entry = summary.par_fichier.find(f => f.filename === selectedFile)
    return entry?.month ?? null
  }, [selectedFile, summary])

  // ── Filtres actifs (pour bandeau stats + ligne TOTAL synthétique)
  const filtersActive = useMemo(
    () => Boolean(
      categoryFilter || subcategoryFilter ||
      sourceFilter !== 'all' || alerteTypeFilter !== 'all',
    ),
    [categoryFilter, subcategoryFilter, sourceFilter, alerteTypeFilter],
  )

  // ── Totaux des ops affichées (post-filtres) — pour ligne TOTAL sticky
  const filteredTotals = useMemo(() => {
    let totalDebit = 0
    let totalCredit = 0
    for (const op of sortedOps) {
      totalDebit += Number(op['Débit'] || 0)
      totalCredit += Number(op['Crédit'] || 0)
    }
    return {
      count: sortedOps.length,
      totalDebit,
      totalCredit,
      solde: totalCredit - totalDebit,
    }
  }, [sortedOps])

  // ── Compteur « justif manquant » par fichier (pour badge mois 📎 N)
  const justifMissingByFile = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    const breakdown = summary?.par_fichier_par_type
    if (!breakdown) return map
    for (const filename of Object.keys(breakdown)) {
      const counts = breakdown[filename] || {}
      const n = Number(counts.justificatif_manquant || 0)
      if (n > 0) map[filename] = n
    }
    return map
  }, [summary])

  // ── Auto-clear de la sélection si filtres / fichier / année change
  useEffect(() => {
    setSelectedOps(new Set())
  }, [selectedFile, categoryFilter, subcategoryFilter, sourceFilter, alerteTypeFilter])

  // ── Reset alerte type filter quand on change de fichier
  useEffect(() => {
    setAlerteTypeFilter('all')
  }, [selectedFile])

  // ── Helpers sélection
  const opKey = (op: Operation): string =>
    `${selectedFile ?? ''}:${op._index ?? 0}`

  const opIsLockable = (op: Operation): boolean =>
    (op.alertes || []).includes('justificatif_manquant')

  const lockableOpsInView = useMemo(
    () => sortedOps.filter(opIsLockable),
    [sortedOps],
  )

  const allLockableSelected = useMemo(() => {
    if (lockableOpsInView.length === 0) return false
    return lockableOpsInView.every((op) => selectedOps.has(opKey(op)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockableOpsInView, selectedOps, selectedFile])

  const someLockableSelected = useMemo(() => {
    if (selectedOps.size === 0) return false
    return lockableOpsInView.some((op) => selectedOps.has(opKey(op)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockableOpsInView, selectedOps, selectedFile])

  const toggleOpSelection = (op: Operation) => {
    const key = opKey(op)
    setSelectedOps((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAllLockableSelection = () => {
    setSelectedOps((prev) => {
      const next = new Set(prev)
      if (allLockableSelected) {
        for (const op of lockableOpsInView) next.delete(opKey(op))
      } else {
        for (const op of lockableOpsInView) next.add(opKey(op))
      }
      return next
    })
  }

  // ── Construction targetedOps pour ManualAssociationDrawer (multi-sélection)
  const manualTargetedOps = useMemo<TargetedOp[]>(() => {
    if (!selectedFile) return []
    const out: TargetedOp[] = []
    for (const op of (operations || [])) {
      if (!selectedOps.has(opKey(op))) continue
      const debit = Number(op['Débit'] || 0)
      const credit = Number(op['Crédit'] || 0)
      const montant = debit > 0 ? debit : credit
      if (montant <= 0) continue
      out.push({
        filename: selectedFile,
        index: op._index ?? 0,
        libelle: op['Libellé'] || '',
        montant,
        date: op.Date || '',
        categorie: op['Catégorie'] || undefined,
        sousCategorie: op['Sous-catégorie'] || undefined,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operations, selectedOps, selectedFile])

  // ── Ops enrichies pour RapprochementWorkflowDrawer (filename + originalIndex)
  // Le drawer lit `_filename` + `_originalIndex` pour le PATCH backend.
  type EnrichedOp = Operation & { _filename?: string; _originalIndex?: number }
  const enrichedSortedOps = useMemo<EnrichedOp[]>(() => {
    if (!selectedFile) return sortedOps as EnrichedOp[]
    return sortedOps.map((op) => ({
      ...op,
      _filename: selectedFile,
      _originalIndex: op._index ?? 0,
    }))
  }, [sortedOps, selectedFile])

  const handleOpenWorkflow = (op: Operation) => {
    if (!selectedFile) return
    const idx = sortedOps.findIndex(
      (o) => (o._index ?? -1) === (op._index ?? -2),
    )
    if (idx < 0) return
    setWorkflowInitialIndex(idx)
    setWorkflowDrawerOpen(true)
  }

  const handleRowClick = (op: Operation) => {
    // Si l'op a une alerte « justificatif manquant », ouvrir le workflow d'association.
    // Sinon, garder le comportement legacy (drawer détail / résolution).
    if ((op.alertes || []).includes('justificatif_manquant')) {
      handleOpenWorkflow(op)
      return
    }
    setDrawerOp(op)
  }

  const handleOpenInJustificatifs = (op: Operation) => {
    if (!selectedFile || op._index == null) return
    const params = new URLSearchParams({
      file: selectedFile,
      highlight: String(op._index),
      filter: 'sans',
    })
    navigate(`/justificatifs?${params.toString()}`)
  }

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
        const op = row.original
        const isNoteDeFrais = op.source === 'note_de_frais'
        const immoId = op.immobilisation_id
        const isDotation = op.source === 'amortissement'
        const forfaitSource = (
          op.source === 'blanchissage'
          || op.source === 'repas'
          || op.source === 'vehicule'
        )
          ? op.source as 'blanchissage' | 'repas' | 'vehicule'
          : null
        const opYear = parseInt((op.Date || '').slice(0, 4)) || new Date().getFullYear()
        const hasBadges = isNoteDeFrais || !!immoId || isDotation || !!forfaitSource
        return (
          <div className="flex flex-col">
            {hasBadges && (
              <div className="flex flex-wrap gap-1 mb-1">
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
                      lineHeight: '16px',
                      alignSelf: 'flex-start',
                    }}
                  >
                    Note de frais
                  </span>
                )}
                {immoId && (
                  <ImmoBadge
                    immobilisationId={immoId}
                    orphan={!immosMap[immoId]}
                    onClick={() => openImmoDrawer(immoId)}
                  />
                )}
                {isDotation && (
                  <DotationBadge
                    year={opYear}
                    onClick={() => navigate(
                      `/visualization?year=${opYear}&category=${encodeURIComponent('Dotations aux amortissements')}`
                    )}
                  />
                )}
                {forfaitSource && (
                  <ForfaitBadge
                    source={forfaitSource}
                    onClick={() => navigate(`/charges-forfaitaires?tab=${forfaitSource}`)}
                  />
                )}
              </div>
            )}
            <span>{op['Libellé']}</span>
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
            {/* Bouton batch — visible seulement si selection multi */}
            {selectedOps.size > 0 && (
              <button
                onClick={() => setManualDrawerOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-warning text-white rounded-lg hover:bg-warning/90"
              >
                <Link2 size={16} />
                Associer en lot ({selectedOps.size})
              </button>
            )}

            {/* Bouton Association manuelle (multi sans pré-sélection) */}
            <button
              onClick={() => setManualDrawerOpen(true)}
              disabled={!selectedFile}
              className="flex items-center gap-2 px-4 py-2 bg-surface border border-border text-text rounded-lg hover:bg-surface-hover disabled:opacity-50"
              title="Association manuelle libre"
            >
              <Link2 size={16} />
              Association manuelle
            </button>

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
              {filesForYear.map((f) => {
                const justifMissing = justifMissingByFile[f.filename] || 0
                const isActive = selectedFile === f.filename
                return (
                  <button
                    key={f.filename}
                    onClick={() => setSelectedFile(f.filename)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-sm border transition-colors flex items-center gap-2',
                      isActive
                        ? 'bg-primary text-white border-primary'
                        : 'bg-surface border-border text-text-muted hover:text-text hover:border-primary/50',
                    )}
                  >
                    <span>{MOIS_FR[(f.month ?? 1) - 1]}</span>
                    <span className="text-xs opacity-75">({f.nb_alertes})</span>
                    {justifMissing > 0 && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border',
                          isActive
                            ? 'bg-white/20 border-white/30 text-white'
                            : 'bg-orange-500/15 border-orange-500/30 text-orange-400',
                        )}
                        title={`${justifMissing} justificatif(s) manquant(s) ce mois`}
                      >
                        <Paperclip size={9} strokeWidth={2.5} />
                        {justifMissing}
                      </span>
                    )}
                  </button>
                )
              })}
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

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as OperationTypeFilter)}
            className={cn(
              'bg-surface border rounded-lg px-3 py-2 text-sm min-w-[180px]',
              sourceFilter !== 'all' ? 'border-amber-500/50 text-amber-400' : 'border-border text-text',
            )}
            title="Type d'opération"
          >
            <option value="all">Tous les types</option>
            <option value="bancaire">Opérations bancaires</option>
            <option value="note_de_frais">Notes de frais</option>
            <option value="immobilisation">Immobilisations</option>
            <option value="dotation">Dotations</option>
            <option value="forfait">Forfaits</option>
          </select>

          {(categoryFilter || subcategoryFilter || sourceFilter !== 'all' || alerteTypeFilter !== 'all') && (
            <button
              onClick={() => {
                setCategoryFilter('')
                setSubcategoryFilter('')
                setSourceFilter('all')
                setAlerteTypeFilter('all')
              }}
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

      {/* Pills statistiques cliquables — filtres rapides par type d'alerte */}
      {selectedFile && summary?.par_type && (operations || []).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-muted uppercase tracking-wider mr-1">Filtrer par type :</span>
          {([
            { type: 'justificatif_manquant' as AlerteType, label: 'Justif manquant', icon: FileX, color: 'orange' },
            { type: 'a_categoriser' as AlerteType, label: 'À catégoriser', icon: Tag, color: 'yellow' },
            { type: 'montant_a_verifier' as AlerteType, label: 'Montant suspect', icon: AlertTriangle, color: 'red' },
            { type: 'doublon_suspect' as AlerteType, label: 'Doublon', icon: Copy, color: 'purple' },
            { type: 'confiance_faible' as AlerteType, label: 'Confiance faible', icon: AlertTriangle, color: 'blue' },
          ]).map((pill) => {
            const count = summary.par_type[pill.type] ?? 0
            const isActive = alerteTypeFilter === pill.type
            const Icon = pill.icon
            const colorClasses: Record<string, { active: string; inactive: string; ring: string }> = {
              orange: { active: 'bg-orange-500/25 text-orange-300 border-orange-500/50', inactive: 'bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/20', ring: 'ring-orange-400/50' },
              yellow: { active: 'bg-yellow-500/25 text-yellow-300 border-yellow-500/50', inactive: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20', ring: 'ring-yellow-400/50' },
              red: { active: 'bg-red-500/25 text-red-300 border-red-500/50', inactive: 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20', ring: 'ring-red-400/50' },
              purple: { active: 'bg-purple-500/25 text-purple-300 border-purple-500/50', inactive: 'bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20', ring: 'ring-purple-400/50' },
              blue: { active: 'bg-blue-500/25 text-blue-300 border-blue-500/50', inactive: 'bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20', ring: 'ring-blue-400/50' },
            }
            const c = colorClasses[pill.color]
            return (
              <button
                key={pill.type}
                onClick={() => setAlerteTypeFilter(isActive ? 'all' : pill.type)}
                disabled={count === 0}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                  isActive ? `${c.active} ring-2 ${c.ring}` : c.inactive,
                  count === 0 && 'opacity-40 cursor-not-allowed',
                )}
                title={isActive ? 'Cliquez pour désactiver le filtre' : `Filtrer ${pill.label}`}
              >
                <Icon size={12} />
                {pill.label}
                <span className="font-bold">({count})</span>
              </button>
            )
          })}
          {alerteTypeFilter !== 'all' && (
            <button
              onClick={() => setAlerteTypeFilter('all')}
              className="text-xs text-text-muted hover:text-text underline ml-1"
            >
              Tout voir
            </button>
          )}
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
                      {/* Header checkbox tri-état Select All — uniquement si au moins une op lockable */}
                      <th
                        className="pl-3 pr-1 py-3 text-left"
                        style={{ width: 36 }}
                      >
                        {lockableOpsInView.length > 0 && (
                          <button
                            onClick={toggleAllLockableSelection}
                            className={cn(
                              'w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-colors',
                              allLockableSelected && 'bg-warning border-warning',
                              !allLockableSelected && someLockableSelected && 'border-warning/60 bg-warning/30',
                              !allLockableSelected && !someLockableSelected && 'border-border opacity-50 hover:opacity-100 hover:border-warning',
                            )}
                            title={
                              allLockableSelected
                                ? 'Tout désélectionner'
                                : `Sélectionner les ${lockableOpsInView.length} opérations sans justificatif`
                            }
                            aria-label="Sélectionner tout"
                          >
                            {allLockableSelected && (
                              <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                                <path d="M2 6.5L4.5 9L10 3.5" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                            {!allLockableSelected && someLockableSelected && (
                              <span className="block w-2 h-0.5 bg-warning rounded" />
                            )}
                          </button>
                        )}
                      </th>
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
                  {table.getRowModel().rows.map((row) => {
                    const op = row.original
                    const isLockable = opIsLockable(op)
                    const isSelected = selectedOps.has(opKey(op))
                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          'border-b border-border/50 hover:bg-surface-hover cursor-pointer transition-colors group',
                          isSelected && 'bg-warning/10',
                        )}
                        onClick={() => handleRowClick(op)}
                      >
                        {/* Cellule checkbox — visible uniquement si lockable */}
                        <td
                          className="pl-3 pr-1 py-3 align-middle"
                          style={{ width: 36 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isLockable ? (
                            <button
                              onClick={() => toggleOpSelection(op)}
                              className={cn(
                                'w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-colors',
                                isSelected
                                  ? 'bg-warning border-warning'
                                  : 'border-border opacity-40 group-hover:opacity-100 hover:border-warning',
                              )}
                              aria-label={isSelected ? 'Désélectionner' : 'Sélectionner pour batch'}
                              title={isSelected ? 'Désélectionner' : 'Sélectionner pour association en lot'}
                            >
                              {isSelected && (
                                <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                                  <path d="M2 6.5L4.5 9L10 3.5" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </button>
                          ) : null}
                        </td>
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-3 text-sm text-text">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                  {/* Ligne TOTAL synthétique — affichée si filtres actifs ET ops présentes */}
                  {filtersActive && filteredTotals.count > 0 && (
                    <tr className="sticky bottom-0 z-20 bg-gradient-to-r from-warning/30 via-warning/25 to-warning/30 border-y-2 border-warning shadow-[0_-2px_6px_rgba(0,0,0,0.2)]">
                      <td className="pl-3 pr-1 py-3 border-l-4 border-warning"></td>
                      <td className="px-4 py-3 text-sm font-bold text-text">
                        <span className="text-warning mr-1.5">∑</span>
                        <span className="uppercase tracking-wider text-xs">Total</span>
                      </td>
                      <td className="px-4 py-3 text-xs italic text-text-muted">
                        {filteredTotals.count} opération{filteredTotals.count > 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3 text-sm text-text font-semibold tabular-nums">
                        {filteredTotals.totalDebit > 0 ? formatCurrency(filteredTotals.totalDebit) : ''}
                      </td>
                      <td className="px-4 py-3 text-sm text-text font-semibold tabular-nums">
                        {filteredTotals.totalCredit > 0 ? formatCurrency(filteredTotals.totalCredit) : ''}
                      </td>
                      <td className="px-4 py-3" colSpan={2}>
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ring-1 tabular-nums',
                            filteredTotals.solde >= 0
                              ? 'bg-success/20 ring-success/40 text-success'
                              : 'bg-danger/20 ring-danger/40 text-danger',
                          )}
                        >
                          Solde {formatCurrency(filteredTotals.solde)}
                        </span>
                      </td>
                    </tr>
                  )}
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

              {/* Quick actions — navigation cross-page */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    handleOpenInJustificatifs(drawerOp)
                    setDrawerOp(null)
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-surface border border-border text-text rounded-lg hover:bg-surface-hover w-full"
                  title="Ouvrir cette opération dans la page Justificatifs"
                >
                  <ExternalLink size={14} />
                  Ouvrir dans Justificatifs
                </button>
                {(drawerOp.alertes || []).includes('justificatif_manquant') && (
                  <button
                    onClick={() => {
                      const op = drawerOp
                      setDrawerOp(null)
                      handleOpenWorkflow(op)
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 whitespace-nowrap"
                    title="Associer un justificatif à cette opération"
                  >
                    <Link2 size={14} />
                    Associer
                  </button>
                )}
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

      {/* Drawer rapprochement workflow (mono-op, scoré) — au clic d'une ligne sans justif */}
      <RapprochementWorkflowDrawer
        isOpen={workflowDrawerOpen}
        operations={enrichedSortedOps}
        initialIndex={workflowInitialIndex ?? undefined}
        fallbackFilename={selectedFile ?? undefined}
        onClose={() => {
          setWorkflowDrawerOpen(false)
          setWorkflowInitialIndex(null)
          invalidateAlertesCaches()
        }}
        onAttribution={() => invalidateAlertesCaches()}
      />

      {/* Drawer association manuelle (3 panneaux, filtres) — batch ou libre */}
      <ManualAssociationDrawer
        open={manualDrawerOpen}
        onClose={() => {
          setManualDrawerOpen(false)
          invalidateAlertesCaches()
        }}
        year={selectedYear}
        month={selectedMonth}
        targetedOps={manualTargetedOps.length > 0 ? manualTargetedOps : undefined}
      />
    </div>
  )
}
