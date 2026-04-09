import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import RapprochementManuelDrawer from '@/components/rapprochement/RapprochementManuelDrawer'
import BatchOverviewDrawer from '@/components/templates/BatchOverviewDrawer'
import BatchReconstituerDrawer from '@/components/justificatifs/BatchReconstituerDrawer'
import { useJustificatifsPage } from '@/hooks/useJustificatifsPage'
import type { EnrichedOperation } from '@/hooks/useJustificatifsPage'
import { useSandbox } from '@/hooks/useSandbox'
import { useCategories } from '@/hooks/useApi'
import { useSaveOperations } from '@/hooks/useOperations'
import { useOperations } from '@/hooks/useOperations'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { cn, formatCurrency, formatDate, MOIS_FR, isReconstitue } from '@/lib/utils'
import {
  FileText, Search, ScanLine, ChevronLeft, ChevronRight,
  CheckCircle2, Circle, ArrowUpDown, ArrowUp, ArrowDown,
  FileCheck, FileX, Percent, Hash, Zap, Loader2, X, Layers,
  Check, Minus, Stamp,
} from 'lucide-react'
import { useRunAutoRapprochement } from '@/hooks/useRapprochement'
import { useDissociate } from '@/hooks/useJustificatifs'
import { Unlink } from 'lucide-react'
import type { CategoryRaw } from '@/types'

type SortKey = 'date' | 'libelle' | 'debit' | 'credit' | 'categorie' | 'sous_categorie'

export default function JustificatifsPage() {
  const navigate = useNavigate()

  const {
    year, setYear, selectedMonth, setSelectedMonth,
    search, setSearch,
    sortKey, sortOrder, toggleSort,
    justifFilter, setJustifFilter,
    selectedOpIndex, selectedOpFilename,
    drawerOpen, setDrawerOpen,
    availableYears, monthsForYear, selectedFile,
    operations, stats,
    isYearWide, isLoading,
    openDrawer, goToNextWithout,
    selectedOps, opKey, toggleOp, toggleAllFiltered, clearSelection,
    selectedCount, isAllFilteredSelected, isSomeFilteredSelected,
    getSelectedOperations,
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
    if (isYearWide || !op._filename) return
    try {
      // Load full operations for this file, update the target, save
      const allOps = await queryClient.fetchQuery<EnrichedOperation[]>({
        queryKey: ['operations', op._filename],
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
  }, [isYearWide, queryClient, saveMutation])

  // Preview justificatif existant
  const [previewJustif, setPreviewJustif] = useState<string | null>(null)
  const [previewOpFile, setPreviewOpFile] = useState<string | null>(null)
  const [previewOpIndex, setPreviewOpIndex] = useState<number | null>(null)

  const dissociateMutation = useDissociate()

  // Auto-rapprochement
  const autoRapprochement = useRunAutoRapprochement()

  // Batch reconstituer drawer
  const [batchReconstituerOpen, setBatchReconstituerOpen] = useState(false)
  const selectedOperationsForBatch = useMemo(() => getSelectedOperations(), [getSelectedOperations, selectedOps]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (lastEvent) {
      if (lastEvent.status === 'processed') {
        toast.success(`Justificatif traité : ${lastEvent.filename}`)
      } else if (lastEvent.status === 'error') {
        toast.error(`Erreur OCR : ${lastEvent.filename}`)
      }
    }
  }, [lastEvent])

  // Flash highlight on navigation
  useEffect(() => {
    if (selectedOpIndex !== null && selectedOpFilename !== null) {
      const rowId = `op-row-${selectedOpFilename}-${selectedOpIndex}`
      const row = document.getElementById(rowId)
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' })
        row.classList.add('flash-highlight')
        setTimeout(() => row.classList.remove('flash-highlight'), 1500)
      }
    }
  }, [selectedOpIndex, selectedOpFilename])

  // Opération sélectionnée pour le drawer
  const selectedOperation = operations.find(
    op => op._originalIndex === selectedOpIndex && op._filename === selectedOpFilename
  ) ?? null

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

          {/* Sélecteur mois */}
          <select
            value={selectedFile?.month ?? selectedMonth ?? ''}
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

          {/* Filtre justificatif */}
          <div className="flex bg-background rounded border border-border overflow-hidden">
            {([
              ['all', 'Tous'],
              ['sans', 'Sans justif.'],
              ['avec', 'Avec justif.'],
              ['facsimile', '\ud83d\ude08 Fac-simile'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setJustifFilter(value)}
                className={cn(
                  'px-3 py-1.5 text-xs transition-colors',
                  justifFilter === value
                    ? 'bg-primary text-white'
                    : 'text-text-muted hover:text-text'
                )}
              >
                {label}
              </button>
            ))}
          </div>

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
                              const firstSans = operations.find(op => !op.Justificatif)
                              if (firstSans) openDrawer(firstSans)
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {operations.map((op) => {
                    const hasJustif = !!op['Lien justificatif']
                    const rowId = `op-row-${op._filename}-${op._originalIndex}`
                    const isDrawerSelected = drawerOpen && op._originalIndex === selectedOpIndex && op._filename === selectedOpFilename
                    const isPreviewSelected = previewJustif !== null && op._originalIndex === previewOpIndex && op._filename === previewOpFile
                    const isSelected = isDrawerSelected || isPreviewSelected

                    return (
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
                          } else {
                            openDrawer(op)
                          }
                        }}
                        className={cn(
                          'hover:bg-surface/50 transition-colors cursor-pointer',
                          isSelected && 'bg-warning/15 outline outline-2 outline-warning/40 outline-offset-[-2px]',
                          selectedOps.has(opKey(op)) && 'bg-primary/10'
                        )}
                      >
                        <td className="px-2 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                          {!hasJustif && (
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
                          <select
                            value={op['Catégorie'] ?? ''}
                            onChange={e => handleCategoryChange(op, 'Catégorie', e.target.value)}
                            disabled={isYearWide}
                            className="w-full bg-transparent border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 text-xs text-text-muted focus:text-text cursor-pointer focus:outline-none transition-colors"
                          >
                            <option value="">—</option>
                            {categoryNames.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 max-w-[160px]" onClick={e => e.stopPropagation()}>
                          {(subcategoriesMap.get(op['Catégorie'] ?? '') ?? []).length > 0 ? (
                            <select
                              value={op['Sous-catégorie'] ?? ''}
                              onChange={e => handleCategoryChange(op, 'Sous-catégorie', e.target.value)}
                              disabled={isYearWide}
                              className="w-full bg-transparent border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 text-xs text-text-muted focus:text-text cursor-pointer focus:outline-none transition-colors"
                            >
                              <option value="">—</option>
                              {(subcategoriesMap.get(op['Catégorie'] ?? '') ?? []).map(s => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="px-1.5 py-1 text-xs text-text-muted">{op['Sous-catégorie'] ?? ''}</span>
                          )}
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
                              } else {
                                openDrawer(op)
                              }
                            }}
                            title={hasJustif ? 'Justificatif attribué — cliquer pour voir' : 'Cliquer pour attribuer un justificatif'}
                            className={cn(
                              'inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors',
                              hasJustif
                                ? 'text-emerald-400 hover:bg-emerald-500/15'
                                : 'text-amber-400 hover:bg-amber-500/15'
                            )}
                          >
                            {hasJustif ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                          </button>
                          {hasJustif && isReconstitue(op['Lien justificatif'] || '') && (
                            <span className="text-[10px]" title="Fac-similé reconstitué">😈</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
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
            onClick={clearSelection}
            className="p-1.5 text-text-muted hover:text-text transition-colors"
            title="Annuler la sélection"
          >
            <X size={16} />
          </button>
        </div>
      )}

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
            <div className="px-5 py-3 border-t border-border flex items-center justify-end shrink-0">
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

      {/* Attribution Drawer (uniquement pour ops sans justificatif) */}
      <RapprochementManuelDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        filename={selectedOpFilename}
        operation={selectedOperation ? {
          index: selectedOpIndex ?? 0,
          date: selectedOperation.Date || '',
          libelle: selectedOperation['Libellé'] || '',
          debit: selectedOperation['Débit'] || 0,
          credit: selectedOperation['Crédit'] || 0,
          ventilation: selectedOperation.ventilation,
        } : null}
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
    </div>
  )
}
