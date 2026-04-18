import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import RapprochementWorkflowDrawer from '@/components/rapprochement/RapprochementWorkflowDrawer'
import BatchOverviewDrawer from '@/components/templates/BatchOverviewDrawer'
import BatchReconstituerDrawer from '@/components/justificatifs/BatchReconstituerDrawer'
import ManualAssociationDrawer, { type TargetedOp } from '@/components/justificatifs/ManualAssociationDrawer'
import { BulkLockBar } from '@/components/BulkLockBar'
import { useBulkLock, type BulkLockItem } from '@/hooks/useBulkLock'
import { useJustificatifsPage } from '@/hooks/useJustificatifsPage'
import type { EnrichedOperation } from '@/hooks/useJustificatifsPage'
import { useSandbox } from '@/hooks/useSandbox'
import { useCategories } from '@/hooks/useApi'
import { useSaveOperations } from '@/hooks/useOperations'
import { useOperations } from '@/hooks/useOperations'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import { cn, formatCurrency, formatDate, MOIS_FR, isReconstitue } from '@/lib/utils'
import {
  FileText, Search, ScanLine, ChevronLeft, ChevronRight,
  CheckCircle2, Circle, ArrowUpDown, ArrowUp, ArrowDown,
  FileCheck, FileX, Percent, Hash, Zap, Loader2, X, Layers,
  Check, Minus, Stamp, Ban, FilterX,
} from 'lucide-react'
import { useRunAutoRapprochement } from '@/hooks/useRapprochement'
import { useDissociate, useDeleteJustificatif } from '@/hooks/useJustificatifs'
import { showDeleteConfirmToast, showDeleteSuccessToast } from '@/lib/deleteJustificatifToast'
import { Unlink, Paperclip, Trash2, Link2, Copy as FacsimileIcon } from 'lucide-react'
import { LockCell } from '@/components/LockCell'
import { Lock as LockIcon } from 'lucide-react'
import type { VentilationLine } from '@/types'
import type { CategoryRaw } from '@/types'

type SortKey = 'date' | 'libelle' | 'debit' | 'credit' | 'categorie' | 'sous_categorie'

export default function JustificatifsPage() {
  const navigate = useNavigate()

  const {
    year, setYear, selectedMonth, setSelectedMonth,
    search, setSearch,
    sortKey, sortOrder, toggleSort,
    justifFilter, setJustifFilter,
    categoryFilter, setCategoryFilter, subcategoryFilter, setSubcategoryFilter,
    sourceFilter, setSourceFilter,
    selectedOpIndex, selectedOpFilename,
    drawerOpen, setDrawerOpen,
    drawerInitialIndex,
    availableYears, monthsForYear, selectedFile,
    operations, stats,
    isYearWide, isLoading,
    isOpExempt,
    openDrawer, openDrawerFlow,
    selectedOps, opKey, toggleOp, toggleAllFiltered, clearSelection,
    selectedCount, isAllFilteredSelected, isSomeFilteredSelected,
    getSelectedOperations,
    lockSelectedOps, lockableOps, lockKey,
    toggleLockSelection, toggleAllLockSelection, clearLockSelection,
    lockSelectedCount, isAllLockSelected, isSomeLockSelected,
    lockSelectedAllLocked,
  } = useJustificatifsPage()

  // Batch fac-similé
  const [batchOverviewOpen, setBatchOverviewOpen] = useState(false)

  // Sandbox watchdog SSE
  const { lastEvent, isConnected } = useSandbox()

  // Categories for inline editing
  const { data: categoriesData } = useCategories()
  const saveMutation = useSaveOperations()
  const queryClient = useQueryClient()

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
    for (const [, list] of map) list.sort()
    return map
  }, [categoriesData])

  const handleCategoryChange = useCallback(async (op: EnrichedOperation, field: 'Catégorie' | 'Sous-catégorie', value: string) => {
    if (!op._filename) return
    try {
      // Load full operations for this file (from cache ou via fetch) puis update + save.
      // Fonctionne en mode single-file ET year-wide : les ops year-wide ont leur
      // `_filename` correctement peuplé via useJustificatifsPage.enrichedOps.
      const allOps = await queryClient.fetchQuery<EnrichedOperation[]>({
        queryKey: ['operations', op._filename],
        queryFn: () => api.get(`/operations/${op._filename}`),
      })
      if (!allOps) return
      const updated = [...allOps]
      const target = updated[op._originalIndex]
      if (!target) return
      target[field] = value
      // Reset sous-catégorie when catégorie changes
      if (field === 'Catégorie') {
        target['Sous-catégorie'] = ''
      }
      saveMutation.mutate(
        { filename: op._filename, operations: updated as any },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['operations', op._filename] })
            queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
          },
        }
      )
    } catch {
      toast.error('Erreur lors de la sauvegarde')
    }
  }, [queryClient, saveMutation])

  // Preview justificatif existant
  const [previewJustif, setPreviewJustif] = useState<string | null>(null)
  const [previewOpFile, setPreviewOpFile] = useState<string | null>(null)
  const [previewOpIndex, setPreviewOpIndex] = useState<number | null>(null)

  // ── Nettoyage URL params transient (preview/vl) ──
  // Historique : OCR > Voir l'opération navigue avec `?file=X&highlight=Y&filter=avec`
  // + éventuellement `&preview=JUSTIF.pdf`. La row est surlignée persistamment via
  // `isNavTarget` (cf. operations.map plus bas), donc on n'a PAS besoin d'auto-ouvrir
  // le drawer preview — qui chargeait un PDF (lent) à chaque navigation.
  // On nettoie simplement les params transient pour éviter de les garder dans l'URL.
  const [searchParams, setSearchParams] = useSearchParams()
  const previewParam = searchParams.get('preview')
  const previewConsumedRef = useRef(false)

  useEffect(() => {
    if (!previewParam || previewConsumedRef.current) return
    previewConsumedRef.current = true
    const next = new URLSearchParams(searchParams)
    next.delete('preview')
    next.delete('vl')
    setSearchParams(next, { replace: true })
  }, [previewParam, searchParams, setSearchParams])

  const dissociateMutation = useDissociate()
  const deleteJustifMutation = useDeleteJustificatif()
  const bulkLockMutation = useBulkLock()

  const handleBulkLock = useCallback(async () => {
    // Toggle : si toutes les ops sélectionnées sont déjà verrouillées → on déverrouille.
    // Sinon → on verrouille (homogénéise les mix sur l'état locked).
    const targetLocked = !lockSelectedAllLocked
    const items: BulkLockItem[] = Array.from(lockSelectedOps).map(key => {
      const [filename, idxStr] = key.split(':')
      return { filename, index: Number(idxStr), locked: targetLocked }
    })
    if (items.length === 0) return
    const verb = targetLocked ? 'verrouillée' : 'déverrouillée'
    try {
      const res = await bulkLockMutation.mutateAsync(items)
      if (res.error_count > 0) {
        toast.success(
          `${res.success_count} ${verb}${res.success_count > 1 ? 's' : ''}, ${res.error_count} erreur${res.error_count > 1 ? 's' : ''}`
        )
      } else {
        toast.success(
          `${res.success_count} opération${res.success_count > 1 ? 's' : ''} ${verb}${res.success_count > 1 ? 's' : ''}`
        )
      }
      clearLockSelection()
    } catch {
      toast.error(targetLocked ? 'Échec du verrouillage en masse' : 'Échec du déverrouillage en masse')
    }
  }, [lockSelectedOps, lockSelectedAllLocked, bulkLockMutation, clearLockSelection])

  // Auto-rapprochement
  const autoRapprochement = useRunAutoRapprochement()

  // Batch reconstituer drawer
  const [batchReconstituerOpen, setBatchReconstituerOpen] = useState(false)
  const selectedOperationsForBatch = useMemo(() => getSelectedOperations(), [getSelectedOperations, selectedOps]) // eslint-disable-line react-hooks/exhaustive-deps

  // Manual association drawer (outil d'association 2-colonnes ops|justificatifs)
  const [manualAssocDrawerOpen, setManualAssocDrawerOpen] = useState(false)
  const manualAssocTargetedOps = useMemo<TargetedOp[]>(() => {
    if (selectedCount === 0) return []
    return getSelectedOperations()
      .filter(op => (op['Débit'] ?? 0) > 0) // garde-fou : ignore les crédits
      .map(op => ({
        filename: op._filename,
        index: op._originalIndex,
        libelle: op['Libellé'] ?? '',
        montant: op['Débit'] ?? 0,
        date: op.Date ?? '',
        categorie: op['Catégorie'],
        sousCategorie: op['Sous-catégorie'],
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCount, selectedOps, getSelectedOperations])

  // Ligne TOTAL synthétique : visible quand au moins un filtre "narrowing" est actif.
  // Note : `justifFilter === 'sans'` est le défaut, donc on ne l'inclut PAS comme filtre actif.
  const filtersActive = useMemo(() =>
    categoryFilter !== '' ||
    subcategoryFilter !== '' ||
    sourceFilter !== 'all' ||
    justifFilter !== 'sans' ||
    search.trim() !== '',
    [categoryFilter, subcategoryFilter, sourceFilter, justifFilter, search]
  )
  const filteredTotals = useMemo(() => {
    let debit = 0, credit = 0
    for (const op of operations) {
      debit += Number(op['Débit']) || 0
      credit += Number(op['Crédit']) || 0
    }
    return { debit, credit, solde: credit - debit, count: operations.length }
  }, [operations])

  // Note: le toast d'arrivée de scan est désormais global (déclenché dans
  // useSandbox() via AppLayout). Plus besoin de le dupliquer ici.

  // Scroll-into-view on navigation target change
  // Le surlignage visuel est géré par `isNavTarget` dans le className des rows
  // (cf. operations.map plus bas). Ici on se contente de scroller vers le row
  // cible quand la navigation change, une seule fois par target (useRef guard).
  const scrollTargetRef = useRef<string | null>(null)
  useEffect(() => {
    if (selectedOpIndex === null || !selectedOpFilename) {
      scrollTargetRef.current = null
      return
    }
    const targetKey = `${selectedOpFilename}-${selectedOpIndex}`
    if (scrollTargetRef.current === targetKey) return
    if (operations.length === 0) return // attendre le chargement des ops
    const rowId = `op-row-${targetKey}`
    const row = document.getElementById(rowId)
    if (!row) return // row pas encore rendue — re-run quand operations change
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    scrollTargetRef.current = targetKey
  }, [selectedOpIndex, selectedOpFilename, operations])

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={12} className="text-text-muted/40" />
    return sortOrder === 'asc'
      ? <ArrowUp size={12} className="text-primary" />
      : <ArrowDown size={12} className="text-primary" />
  }

  const headerClick = (col: SortKey) => () => toggleSort(col)

  return (
    <div>
      <PageHeader
        title="Justificatifs"
        description="Attribution des justificatifs aux opérations bancaires"
        actions={
          <div className="flex items-center gap-3">
            {/* Badge "Voir toutes" — visible quand l'affichage est restreint (y compris
                le défaut justifFilter='sans'). Clic = passe à 'all' pour voir TOUTES les opérations. */}
            {(justifFilter !== 'all' || categoryFilter !== '' || subcategoryFilter !== '' || sourceFilter !== 'all' || search.trim() !== '') && (
              <button
                onClick={() => {
                  setSearch('')
                  setJustifFilter('all')
                  setCategoryFilter('')
                  setSubcategoryFilter('')
                  setSourceFilter('all')
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-warning/15 text-warning border border-warning/40 rounded-lg hover:bg-warning/25 transition-colors"
                title="Effacer tous les filtres et voir toutes les opérations"
              >
                <FilterX size={13} />
                Voir toutes
              </button>
            )}
            {isConnected && (
              <span className="flex items-center gap-2 text-xs text-emerald-500 bg-emerald-500/10 px-3 py-1.5 rounded-lg">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                Sandbox actif
              </span>
            )}
            <button
              onClick={() => setBatchOverviewOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors"
            >
              <Layers size={14} />
              Batch fac-simile
            </button>
            <button
              onClick={() => setManualAssocDrawerOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-secondary text-text-muted hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors"
              title="Ouvrir l'outil d'association manuelle 2-colonnes"
            >
              <Link2 size={14} />
              Association manuelle
            </button>
            <button
              onClick={() => navigate('/ocr')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              <ScanLine size={16} />
              Ajouter via OCR
            </button>
          </div>
        }
      />

      <div className="space-y-5">
        {/* Barre filtres */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Sélecteur année */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const idx = availableYears.indexOf(year)
                if (idx < availableYears.length - 1) setYear(availableYears[idx + 1])
              }}
              disabled={availableYears.indexOf(year) >= availableYears.length - 1}
              className="p-1 text-text-muted hover:text-text disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text font-medium"
            >
              {availableYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              onClick={() => {
                const idx = availableYears.indexOf(year)
                if (idx > 0) setYear(availableYears[idx - 1])
              }}
              disabled={availableYears.indexOf(year) <= 0}
              className="p-1 text-text-muted hover:text-text disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Sélecteur mois
              Priorité à selectedMonth (inclut 0 = Toute l'année) ; fallback sur
              selectedFile?.month uniquement quand selectedMonth est null (état initial
              où le hook auto-sélectionne le premier fichier). */}
          <select
            value={selectedMonth !== null ? selectedMonth : (selectedFile?.month ?? '')}
            onChange={e => {
              const v = e.target.value
              setSelectedMonth(v === '' ? null : Number(v))
              // Nettoyer le fileParam URL pour ne pas bloquer la sélection manuelle
              if (window.location.search.includes('file=')) {
                window.history.replaceState(null, '', window.location.pathname)
              }
            }}
            className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text"
          >
            <option value={0}>Toute l&apos;année</option>
            {monthsForYear.map(f => (
              <option key={f.month} value={f.month}>
                {MOIS_FR[(f.month ?? 1) - 1]} ({f.count} ops)
              </option>
            ))}
          </select>

          {/* Recherche */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Rechercher libellé, catégorie..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface border border-border rounded text-text placeholder:text-text-muted/50"
            />
          </div>

          {/* Pills cliquables — filtre par statut justificatif (5 badges) */}
          {(() => {
            const togglePill = (target: 'sans' | 'avec' | 'exempt' | 'locked' | 'facsimile') => {
              setJustifFilter(justifFilter === target ? 'all' : target)
            }
            const pillBase = 'inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-all cursor-pointer hover:brightness-110'
            return (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => togglePill('avec')}
                  className={cn(
                    pillBase,
                    'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                    justifFilter === 'avec' && 'ring-2 ring-emerald-400 bg-emerald-500/30',
                  )}
                  title={`${stats.avec} avec justificatif · cliquer pour filtrer`}
                >
                  <Paperclip size={11} />
                  <span className="tabular-nums">{stats.avec}</span>
                </button>
                <button
                  onClick={() => togglePill('sans')}
                  className={cn(
                    pillBase,
                    'bg-amber-500/15 text-amber-300 border-amber-500/30',
                    justifFilter === 'sans' && 'ring-2 ring-amber-400 bg-amber-500/30',
                  )}
                  title={`${stats.sans} sans justificatif (hors exemptions) · cliquer pour filtrer`}
                >
                  <Paperclip size={11} className="opacity-50" />
                  <span className="tabular-nums">{stats.sans}</span>
                </button>
                {stats.exempt > 0 && (
                  <button
                    onClick={() => togglePill('exempt')}
                    className={cn(
                      pillBase,
                      'bg-sky-500/15 text-sky-300 border-sky-500/30',
                      justifFilter === 'exempt' && 'ring-2 ring-sky-400 bg-sky-500/30',
                    )}
                    title={`${stats.exempt} exemptée${stats.exempt > 1 ? 's' : ''} · cliquer pour filtrer`}
                  >
                    <CheckCircle2 size={11} />
                    <span className="tabular-nums">{stats.exempt}</span>
                  </button>
                )}
                <button
                  onClick={() => togglePill('locked')}
                  className={cn(
                    pillBase,
                    'bg-warning/15 text-warning border-warning/30',
                    justifFilter === 'locked' && 'ring-2 ring-warning bg-warning/30',
                  )}
                  title={`${stats.locked} verrouillée${stats.locked > 1 ? 's' : ''} · cliquer pour filtrer`}
                >
                  <LockIcon size={11} />
                  <span className="tabular-nums">{stats.locked}</span>
                </button>
                {stats.facsimile > 0 && (
                  <button
                    onClick={() => togglePill('facsimile')}
                    className={cn(
                      pillBase,
                      'bg-purple-500/15 text-purple-300 border-purple-500/30',
                      justifFilter === 'facsimile' && 'ring-2 ring-purple-400 bg-purple-500/30',
                    )}
                    title={`${stats.facsimile} fac-similé${stats.facsimile > 1 ? 's' : ''} · cliquer pour filtrer`}
                  >
                    <FacsimileIcon size={11} />
                    <span className="tabular-nums">{stats.facsimile}</span>
                  </button>
                )}
                <span className="text-text-muted/60 text-[10px] px-1">
                  / {stats.total}
                </span>
                {justifFilter !== 'all' && justifFilter !== 'sans' && (
                  <button
                    onClick={() => setJustifFilter('all')}
                    className="text-[10px] text-text-muted hover:text-text px-1.5"
                    title="Afficher toutes les opérations"
                  >
                    Tout voir
                  </button>
                )}
              </div>
            )
          })()}

          {/* Filtre catégorie (persistant à travers les mois) */}
          <select
            value={categoryFilter}
            onChange={e => {
              setCategoryFilter(e.target.value)
              setSubcategoryFilter('') // reset sous-cat quand cat change
            }}
            className={cn(
              'bg-surface border rounded px-3 py-1.5 text-sm text-text',
              categoryFilter === '__uncategorized__' ? 'border-warning text-warning' : 'border-border'
            )}
          >
            <option value="">Toutes les catégories</option>
            <option value="__uncategorized__">⚠ Non catégorisées</option>
            {categoryNames.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Filtre sous-catégorie (dépend de categoryFilter) */}
          {(() => {
            const subs = categoryFilter && categoryFilter !== '__uncategorized__'
              ? (subcategoriesMap.get(categoryFilter) || [])
              : []
            const disabled = !categoryFilter || categoryFilter === '__uncategorized__' || subs.length === 0
            return (
              <select
                value={subcategoryFilter}
                onChange={e => setSubcategoryFilter(e.target.value)}
                disabled={disabled}
                className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text disabled:opacity-40"
              >
                <option value="">
                  {!categoryFilter || categoryFilter === '__uncategorized__'
                    ? 'Sous-catégorie'
                    : subs.length === 0
                      ? 'Aucune sous-cat.'
                      : 'Toutes sous-cat.'}
                </option>
                {subs.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )
          })()}

          {/* Filtre Type d'opération (source : bancaire / note_de_frais) */}
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value as 'all' | 'bancaire' | 'note_de_frais')}
            className={cn(
              'bg-surface border rounded px-3 py-1.5 text-sm',
              sourceFilter === 'note_de_frais'
                ? 'border-amber-500/50 text-amber-400'
                : 'border-border text-text'
            )}
            title="Type d'opération"
          >
            <option value="all">Tous les types</option>
            <option value="bancaire">Opérations bancaires</option>
            <option value="note_de_frais">Notes de frais</option>
          </select>

          {/* Bouton reset filtres cat + source (visible uniquement si un filtre est actif) */}
          {(categoryFilter || subcategoryFilter || sourceFilter !== 'all') && (
            <button
              onClick={() => { setCategoryFilter(''); setSubcategoryFilter(''); setSourceFilter('all') }}
              className="p-1.5 text-text-muted hover:text-text transition-colors"
              title="Effacer les filtres"
            >
              <X size={14} />
            </button>
          )}

          {/* Badge lecture seule année */}
          {isYearWide && (
            <span className="text-xs bg-amber-500/15 text-amber-400 px-2.5 py-1 rounded-full font-medium">
              Lecture seule — Année complète
            </span>
          )}
        </div>

        {/* MetricCards */}
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            title="Total opérations"
            value={String(stats.total)}
            icon={<Hash size={20} />}
          />
          <MetricCard
            title="Avec justificatif"
            value={String(stats.avec)}
            icon={<FileCheck size={20} />}
            trend={stats.avec > 0 ? 'up' : undefined}
          />
          <MetricCard
            title="Sans justificatif"
            value={String(stats.sans)}
            icon={<FileX size={20} />}
            trend={stats.sans > 0 ? 'down' : undefined}
          />
          <MetricCard
            title="Taux couverture"
            value={`${stats.taux}%`}
            icon={<Percent size={20} />}
            trend={stats.taux >= 80 ? 'up' : stats.taux > 0 ? 'down' : undefined}
          />
        </div>

        {/* Bandeau association automatique */}
        {stats.sans > 0 && (
          <div className="relative overflow-hidden rounded-xl border border-warning/30 bg-gradient-to-r from-warning/10 via-warning/5 to-transparent p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-warning/20">
                  <Zap size={20} className="text-warning" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text">
                    {stats.sans} opération{stats.sans > 1 ? 's' : ''} sans justificatif
                  </p>
                  <p className="text-xs text-text-muted">
                    Lancer le rapprochement automatique pour associer les justificatifs disponibles
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  autoRapprochement.mutate(undefined, {
                    onSuccess: (report) => {
                      const auto = report.associations_auto ?? 0
                      const suggestions = report.suggestions_fortes ?? 0
                      const restants = (report as any).justificatifs_restants ?? 0

                      toast.custom((t) => (
                        <div
                          className={cn(
                            'max-w-md w-full bg-surface border rounded-2xl px-5 py-4 shadow-2xl transition-all',
                            auto > 0 ? 'border-emerald-500/40' : suggestions > 0 ? 'border-warning/40' : 'border-border',
                            t.visible ? 'animate-enter' : 'animate-leave'
                          )}
                          onClick={() => {
                            if (suggestions > 0) {
                              toast.dismiss(t.id)
                              setJustifFilter('sans')
                              openDrawerFlow()
                            }
                          }}
                          style={{ cursor: suggestions > 0 ? 'pointer' : 'default' }}
                        >
                          <div className="flex items-start gap-3">
                            <div className={cn(
                              'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                              auto > 0 ? 'bg-emerald-500/15' : 'bg-warning/15'
                            )}>
                              <Zap size={20} className={auto > 0 ? 'text-emerald-400' : 'text-warning'} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-text mb-1.5">
                                Rapprochement terminé
                              </p>
                              <div className="space-y-1">
                                {auto > 0 && (
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                                    <span className="text-xs text-text">
                                      <span className="font-bold text-emerald-400">{auto}</span> opération{auto > 1 ? 's' : ''} associée{auto > 1 ? 's' : ''}
                                    </span>
                                  </div>
                                )}
                                {suggestions > 0 && (
                                  <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-warning shrink-0" />
                                    <span className="text-xs text-text">
                                      <span className="font-bold text-warning">{suggestions}</span> suggestion{suggestions > 1 ? 's' : ''} manuelle{suggestions > 1 ? 's' : ''}
                                    </span>
                                  </div>
                                )}
                                {auto === 0 && suggestions === 0 && (
                                  <p className="text-xs text-text-muted">Aucune correspondance trouvée</p>
                                )}
                                <div className="flex items-center gap-2 pt-1 border-t border-border/30 mt-1.5">
                                  <span className="text-[10px] text-text-muted">
                                    {restants} justificatif{restants !== 1 ? 's' : ''} en attente
                                  </span>
                                </div>
                              </div>
                              {suggestions > 0 && (
                                <p className="text-[10px] text-primary mt-2">Cliquer pour associer manuellement →</p>
                              )}
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id) }}
                              className="p-1 text-text-muted/40 hover:text-text-muted shrink-0"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ), { duration: 15000 })
                    },
                    onError: () => toast.error('Erreur lors du rapprochement automatique'),
                  })
                }}
                disabled={autoRapprochement.isPending}
                className={cn(
                  'flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                  'bg-warning text-background shadow-lg shadow-warning/25 hover:shadow-warning/40 hover:scale-[1.02]',
                  'disabled:opacity-60 disabled:hover:scale-100 disabled:shadow-none'
                )}
              >
                {autoRapprochement.isPending
                  ? <Loader2 size={18} className="animate-spin" />
                  : <Zap size={18} />
                }
                Associer automatiquement
              </button>
            </div>
          </div>
        )}

        {/* Tableau opérations */}
        {isLoading ? (
          <LoadingSpinner text="Chargement des opérations..." />
        ) : operations.length === 0 ? (
          <div className="bg-surface rounded-xl border border-border p-12 text-center">
            <FileText size={40} className="mx-auto text-text-muted mb-3" />
            <p className="text-text-muted">Aucune opération trouvée</p>
          </div>
        ) : (
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-2 py-3 w-10 text-center">
                      <button
                        onClick={toggleAllFiltered}
                        className={cn(
                          'w-5 h-5 rounded border-2 inline-flex items-center justify-center transition-colors',
                          isAllFilteredSelected
                            ? 'bg-primary border-primary'
                            : isSomeFilteredSelected
                              ? 'bg-primary/30 border-primary'
                              : 'border-border hover:border-text-muted'
                        )}
                      >
                        {isAllFilteredSelected
                          ? <Check size={12} className="text-white" />
                          : isSomeFilteredSelected
                            ? <Minus size={12} className="text-white" />
                            : null}
                      </button>
                    </th>
                    {([
                      ['date', 'Date'],
                      ['libelle', 'Libellé'],
                      ['debit', 'Débit'],
                      ['credit', 'Crédit'],
                      ['categorie', 'Catégorie'],
                      ['sous_categorie', 'Sous-catégorie'],
                    ] as [SortKey, string][]).map(([key, label]) => (
                      <th
                        key={key}
                        onClick={headerClick(key)}
                        className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:text-text select-none transition-colors"
                      >
                        <span className="flex items-center gap-1">
                          {label}
                          <SortIcon col={key} />
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center text-xs font-medium text-text-muted uppercase tracking-wider w-20">
                      Justif.
                    </th>
                    <th className="px-2 py-3 text-center text-xs font-medium text-text-muted uppercase tracking-wider w-12">
                      {lockableOps.length > 0 ? (
                        <button
                          onClick={toggleAllLockSelection}
                          title={
                            isAllLockSelected
                              ? 'Tout désélectionner'
                              : `Sélectionner tout pour verrouillage en masse (${lockableOps.length})`
                          }
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
                      ) : (
                        <span>Verrou</span>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {operations.map((op) => {
                    const vlines = (op as Record<string, unknown>).ventilation as VentilationLine[] | undefined
                    const isVentilated = (vlines?.length ?? 0) > 0
                    const allVlAssociated = isVentilated && vlines!.every(vl => !!vl.justificatif)
                    const hasJustif = !!op['Lien justificatif'] || allVlAssociated
                    const isExempt = isOpExempt(op)
                    const isPerso = (op['Catégorie'] || '').toLowerCase() === 'perso'
                    const rowId = `op-row-${op._filename}-${op._originalIndex}`
                    const isDrawerSelected = drawerOpen && op._originalIndex === selectedOpIndex && op._filename === selectedOpFilename
                    const isPreviewSelected = previewJustif !== null && op._originalIndex === previewOpIndex && op._filename === previewOpFile
                    // Nav target : surlignage persistant quand la navigation a ciblé cette op
                    // (depuis OCR Historique > « Voir l'opération »). Reste visible après
                    // la fermeture de la preview drawer tant que selectedOpIndex/Filename
                    // sont set. Permet à l'utilisateur de voir la ligne en contexte.
                    const isNavTarget = selectedOpIndex !== null
                      && selectedOpFilename !== null
                      && op._originalIndex === selectedOpIndex
                      && op._filename === selectedOpFilename
                    const isSelected = isDrawerSelected || isPreviewSelected || isNavTarget

                    return (
                      <>
                      <tr
                        key={rowId}
                        id={rowId}
                        onClick={() => {
                          if (hasJustif) {
                            const lien = op['Lien justificatif'] || ''
                            const basename = lien.split('/').pop() || ''
                            if (basename) {
                              setPreviewJustif(basename)
                              setPreviewOpFile(op._filename)
                              setPreviewOpIndex(op._originalIndex)
                            }
                          } else if (isExempt) {
                            // op exemptée — pas d'attribution requise
                            return
                          } else {
                            openDrawer(op)
                          }
                        }}
                        className={cn(
                          'group hover:bg-surface/50 transition-colors',
                          isExempt && !hasJustif ? 'cursor-default' : 'cursor-pointer',
                          isSelected && 'bg-warning/15 outline outline-2 outline-warning/40 outline-offset-[-2px]',
                          selectedOps.has(opKey(op)) && 'bg-primary/10',
                          lockSelectedOps.has(lockKey(op)) && 'bg-warning/10',
                        )}
                      >
                        <td className="px-2 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                          {!hasJustif && !isExempt && (
                            <button
                              onClick={() => toggleOp(op)}
                              className={cn(
                                'w-5 h-5 rounded border-2 inline-flex items-center justify-center transition-colors',
                                selectedOps.has(opKey(op))
                                  ? 'bg-primary border-primary'
                                  : 'border-border hover:border-text-muted'
                              )}
                            >
                              {selectedOps.has(opKey(op)) && <Check size={12} className="text-white" />}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-text whitespace-nowrap">
                          {formatDate(op.Date)}
                        </td>
                        <td className="px-4 py-2.5 text-text max-w-xs truncate" title={op['Libellé']}>
                          {op['Libellé']}
                        </td>
                        <td className="px-4 py-2.5 text-red-400 whitespace-nowrap tabular-nums">
                          {op['Débit'] ? formatCurrency(op['Débit']) : ''}
                        </td>
                        <td className="px-4 py-2.5 text-emerald-400 whitespace-nowrap tabular-nums">
                          {op['Crédit'] ? formatCurrency(op['Crédit']) : ''}
                        </td>
                        <td className="px-2 py-1.5 max-w-[160px]" onClick={e => e.stopPropagation()}>
                          <div className="flex flex-col">
                            {op.source === 'note_de_frais' && (
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
                            <select
                              value={op['Catégorie'] ?? ''}
                              onChange={e => handleCategoryChange(op, 'Catégorie', e.target.value)}
                              className="w-full bg-transparent border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 text-xs text-text-muted focus:text-text cursor-pointer focus:outline-none transition-colors"
                            >
                              <option value="">—</option>
                              {categoryNames.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 max-w-[160px]" onClick={e => e.stopPropagation()}>
                          {(() => {
                            const subs = subcategoriesMap.get(op['Catégorie'] ?? '') ?? []
                            const currentSub = op['Sous-catégorie'] ?? ''
                            // Preserver la valeur actuelle si elle n'est pas dans le map
                            // (évite de perdre la sous-cat quand la catégorie n'a pas de liste prédéfinie)
                            const hasCurrent = currentSub && !subs.includes(currentSub)
                            return (
                              <select
                                value={currentSub}
                                onChange={e => handleCategoryChange(op, 'Sous-catégorie', e.target.value)}
                                className="w-full bg-transparent border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 text-xs text-text-muted focus:text-text cursor-pointer focus:outline-none transition-colors"
                              >
                                <option value="">—</option>
                                {subs.map(s => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                                {hasCurrent && (
                                  <option value={currentSub}>{currentSub}</option>
                                )}
                              </select>
                            )
                          })()}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (hasJustif) {
                                const lien = op['Lien justificatif'] || ''
                                const basename = lien.split('/').pop() || ''
                                if (basename) {
                                  setPreviewJustif(basename)
                                  setPreviewOpFile(op._filename)
                                  setPreviewOpIndex(op._originalIndex)
                                }
                              } else if (isExempt) {
                                // op exemptée — pas d'action
                                return
                              } else {
                                openDrawer(op)
                              }
                            }}
                            disabled={isExempt && !hasJustif}
                            title={
                              hasJustif
                                ? 'Justificatif attribué — cliquer pour voir'
                                : isPerso
                                  ? 'Opération perso — aucun justificatif requis'
                                  : isExempt
                                    ? `Catégorie « ${op['Catégorie']} » exemptée — pas de justificatif requis`
                                    : 'Cliquer pour attribuer un justificatif'
                            }
                            className={cn(
                              'inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors',
                              hasJustif
                                ? 'text-emerald-400 hover:bg-emerald-500/15'
                                : isPerso
                                  ? 'text-red-400/80 cursor-default'
                                  : isExempt
                                    ? 'text-sky-400 cursor-default'
                                    : 'text-amber-400 hover:bg-amber-500/15'
                            )}
                          >
                            {hasJustif
                              ? <CheckCircle2 size={18} />
                              : isPerso
                                ? <Ban size={18} />
                                : isExempt
                                  ? <CheckCircle2 size={18} />
                                  : <Circle size={18} />}
                          </button>
                          {hasJustif && isReconstitue(op['Lien justificatif'] || '') && (
                            <span className="text-[10px]" title="Fac-similé reconstitué">😈</span>
                          )}
                          {isExempt && !hasJustif && !isPerso && (
                            <div className="text-[9px] text-sky-400/80 mt-0.5" title="Catégorie exemptée">
                              exempté
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                          {(() => {
                            const isLockable = !!hasJustif && !isExempt && !isPerso
                            const selectionActive = lockSelectedCount > 0
                            const key = lockKey(op)
                            const isChecked = lockSelectedOps.has(key)

                            if (!isLockable) {
                              // Cas spécial : parent ventilé partiellement associé qu'une sous-ligne
                              // ≥0.95 a auto-lockée → on doit pouvoir le déverrouiller depuis ici.
                              if (op.locked) {
                                return (
                                  <LockCell
                                    filename={op._filename}
                                    index={op._originalIndex}
                                    locked={true}
                                    hasJustificatif={false}
                                  />
                                )
                              }
                              return null
                            }

                            // Mode sélection : checkbox visible en permanence (LockCell caché)
                            if (selectionActive) {
                              return (
                                <button
                                  onClick={() => toggleLockSelection(key)}
                                  className={cn(
                                    'w-[22px] h-[22px] rounded border-2 inline-flex items-center justify-center transition-colors',
                                    isChecked
                                      ? 'bg-warning border-warning'
                                      : 'border-border hover:border-warning'
                                  )}
                                >
                                  {isChecked && <Check size={14} className="text-white" />}
                                </button>
                              )
                            }

                            // Mode repos : LockCell toujours cliquable. Checkbox apparaît À CÔTÉ au hover.
                            return (
                              <div className="inline-flex items-center gap-1.5">
                                <LockCell
                                  filename={op._filename}
                                  index={op._originalIndex}
                                  locked={!!op.locked}
                                  hasJustificatif={!!hasJustif}
                                />
                                <button
                                  onClick={() => toggleLockSelection(key)}
                                  className={cn(
                                    'hidden group-hover:inline-flex w-[18px] h-[18px] rounded border-2 items-center justify-center transition-colors',
                                    'border-border/60 hover:border-warning hover:bg-warning/10'
                                  )}
                                  title="Sélectionner pour verrouillage en masse"
                                />
                              </div>
                            )
                          })()}
                        </td>
                      </tr>
                      {/* Sous-lignes ventilées */}
                      {((op as Record<string, unknown>).ventilation as VentilationLine[] | undefined)?.map((vl, vlIdx) => (
                        <tr
                          key={`${rowId}-vl-${vlIdx}`}
                          className="border-b border-border/10 bg-black/30 hover:bg-black/40 transition-colors"
                        >
                          <td className="px-2 py-1.5" />
                          <td className="py-1.5 px-4">
                            <div className="flex items-center gap-1.5 pl-3">
                              <div className="w-0.5 h-4 bg-primary/40 rounded-full" />
                              <span className="text-[10px] text-text-muted font-medium">L{vlIdx + 1}</span>
                            </div>
                          </td>
                          <td className="px-4 py-1.5 text-xs text-text-muted truncate max-w-xs">
                            {vl.libelle || op['Libellé']}
                          </td>
                          <td className="px-4 py-1.5 text-red-400/70 whitespace-nowrap tabular-nums text-xs">
                            {op['Débit'] && Number(op['Débit']) > 0 ? formatCurrency(vl.montant) : ''}
                          </td>
                          <td className="px-4 py-1.5 text-emerald-400/70 whitespace-nowrap tabular-nums text-xs">
                            {op['Crédit'] && Number(op['Crédit']) > 0 ? formatCurrency(vl.montant) : ''}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="text-[10px] text-text-muted">{vl.categorie || '—'}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="text-[10px] text-text-muted">{vl.sous_categorie || '—'}</span>
                          </td>
                          <td className="px-4 py-1.5 text-center">
                            {vl.justificatif ? (
                              <button
                                onClick={() => {
                                  setPreviewJustif(vl.justificatif!)
                                  setPreviewOpFile(op._filename)
                                  setPreviewOpIndex(op._originalIndex)
                                }}
                                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                                title={`Justificatif: ${vl.justificatif}`}
                              >
                                <Paperclip size={13} />
                              </button>
                            ) : (
                              <span className="text-text-muted/30 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5" />
                        </tr>
                      ))}
                    </>
                    )
                  })}
                  {/* Ligne TOTAL synthétique (visible quand un filtre est actif) */}
                  {filtersActive && filteredTotals.count > 0 && (
                    <tr className="sticky bottom-0 z-20 border-y-2 border-warning bg-gradient-to-r from-warning/30 via-warning/25 to-warning/30 font-bold text-text shadow-[0_-6px_16px_-4px_rgba(245,158,11,0.5)]">
                      <td className="py-3 px-2 border-l-4 border-l-warning" />
                      <td className="py-3 px-2">
                        <span className="inline-flex items-center gap-1.5 text-sm uppercase tracking-wider text-warning">
                          <span className="text-base">∑</span>
                          <span>Total</span>
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <span className="text-xs italic text-warning/90">
                          {filteredTotals.count} opération{filteredTotals.count > 1 ? 's' : ''} filtrée{filteredTotals.count > 1 ? 's' : ''}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right">
                        {filteredTotals.debit > 0
                          ? <span className="text-danger tabular-nums text-sm">{formatCurrency(filteredTotals.debit)}</span>
                          : <span className="text-text-muted/40">—</span>}
                      </td>
                      <td className="py-3 px-2 text-right">
                        {filteredTotals.credit > 0
                          ? <span className="text-success tabular-nums text-sm">{formatCurrency(filteredTotals.credit)}</span>
                          : <span className="text-text-muted/40">—</span>}
                      </td>
                      <td className="py-3 px-2">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold tabular-nums whitespace-nowrap',
                            filteredTotals.solde >= 0
                              ? 'bg-success/20 text-success ring-1 ring-success/40'
                              : 'bg-danger/20 text-danger ring-1 ring-danger/40'
                          )}
                        >
                          Solde&nbsp;:&nbsp;{formatCurrency(filteredTotals.solde)}
                        </span>
                      </td>
                      <td className="py-3 px-2" />
                      <td className="py-3 px-2" />
                      <td className="py-3 px-2 border-r-4 border-r-warning" />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-border text-xs text-text-muted">
              {operations.length} opération{operations.length > 1 ? 's' : ''} affichée{operations.length > 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>

      {/* Barre d'actions flottante batch */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-4 bg-surface border border-border rounded-xl shadow-2xl px-5 py-3 animate-in slide-in-from-bottom-4">
          <span className="text-sm text-text font-medium">
            {selectedCount} opération{selectedCount > 1 ? 's' : ''} sélectionnée{selectedCount > 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setBatchReconstituerOpen(true)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
              'bg-warning text-background shadow-lg shadow-warning/25 hover:shadow-warning/40 hover:scale-[1.02]',
            )}
          >
            <Stamp size={16} />
            Reconstituer ({selectedCount})
          </button>
          <button
            onClick={() => setManualAssocDrawerOpen(true)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
              'bg-primary text-white shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.02]',
            )}
          >
            <Link2 size={16} />
            Associer justificatifs ({selectedCount})
          </button>
          <button
            onClick={clearSelection}
            className="p-1.5 text-text-muted hover:text-text transition-colors"
            title="Annuler la sélection"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Barre d'actions flottante bulk-lock */}
      <BulkLockBar
        count={lockSelectedCount}
        loading={bulkLockMutation.isPending}
        shifted={selectedCount > 0}
        allLocked={lockSelectedAllLocked}
        onLock={handleBulkLock}
        onClose={clearLockSelection}
      />

      {/* Preview justificatif existant */}
      {previewJustif && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setPreviewJustif(null)} />
          <div className="fixed top-0 right-0 h-full w-[600px] max-w-[95vw] bg-background border-l border-border z-50 flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={18} className="text-emerald-400 shrink-0" />
                <p className="text-sm font-semibold text-text truncate">{previewJustif}</p>
              </div>
              <button onClick={() => setPreviewJustif(null)} className="p-1 text-text-muted hover:text-text">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 bg-white">
              <object
                data={`/api/justificatifs/${previewJustif}/preview`}
                type="application/pdf"
                className="w-full h-full"
              >
                <p className="text-center text-text-muted text-sm p-8">Aperçu PDF non disponible</p>
              </object>
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
              <button
                onClick={() => {
                  if (!previewJustif) return
                  const previewOp = operations.find(
                    op => op._originalIndex === previewOpIndex && op._filename === previewOpFile
                  )
                  const libelle = previewOp?.['Libellé'] ?? null
                  showDeleteConfirmToast(previewJustif, libelle, () => {
                    deleteJustifMutation.mutate(previewJustif!, {
                      onSuccess: (result) => {
                        showDeleteSuccessToast(result)
                        setPreviewJustif(null)
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
              <button
                onClick={() => {
                  if (previewOpFile && previewOpIndex !== null) {
                    dissociateMutation.mutate(
                      { operation_file: previewOpFile, operation_index: previewOpIndex },
                      {
                        onSuccess: () => {
                          toast.success('Justificatif dissocié')
                          setPreviewJustif(null)
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
            </div>
          </div>
        </>
      )}

      {/* Attribution Drawer (workflow unifié) */}
      <RapprochementWorkflowDrawer
        isOpen={drawerOpen}
        operations={operations}
        initialIndex={drawerInitialIndex}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Batch fac-similé drawer (overview tous templates) */}
      <BatchOverviewDrawer open={batchOverviewOpen} onClose={() => setBatchOverviewOpen(false)} />

      {/* Batch reconstituer drawer (sélection ciblée) */}
      <BatchReconstituerDrawer
        open={batchReconstituerOpen}
        onClose={() => setBatchReconstituerOpen(false)}
        operations={selectedOperationsForBatch}
        onDone={clearSelection}
      />

      {/* Association manuelle drawer (outil 2-colonnes ops|justificatifs) */}
      <ManualAssociationDrawer
        open={manualAssocDrawerOpen}
        onClose={() => {
          setManualAssocDrawerOpen(false)
          clearSelection()
        }}
        year={year}
        month={selectedMonth}
        targetedOps={manualAssocTargetedOps}
      />
    </div>
  )
}
