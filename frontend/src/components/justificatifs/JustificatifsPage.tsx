import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import JustificatifAttributionDrawer from './JustificatifAttributionDrawer'
import { useJustificatifsPage } from '@/hooks/useJustificatifsPage'
import type { EnrichedOperation } from '@/hooks/useJustificatifsPage'
import { useSandbox } from '@/hooks/useSandbox'
import toast from 'react-hot-toast'
import { cn, formatCurrency, formatDate, MOIS_FR } from '@/lib/utils'
import {
  FileText, Search, ScanLine, ChevronLeft, ChevronRight,
  CheckCircle2, Circle, ArrowUpDown, ArrowUp, ArrowDown,
  FileCheck, FileX, Percent, Hash,
} from 'lucide-react'

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
  } = useJustificatifsPage()

  // Sandbox watchdog SSE
  const { lastEvent, isConnected } = useSandbox()

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
            value={selectedMonth ?? ''}
            onChange={e => {
              const v = e.target.value
              setSelectedMonth(v === '' ? null : Number(v))
            }}
            className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text"
          >
            <option value="">
              {monthsForYear.length > 0
                ? `${MOIS_FR[(monthsForYear[0].month ?? 1) - 1]} (${monthsForYear[0].count} ops)`
                : 'Aucun mois'}
            </option>
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
                    const isSelected = op._originalIndex === selectedOpIndex && op._filename === selectedOpFilename

                    return (
                      <tr
                        key={rowId}
                        id={rowId}
                        onClick={() => openDrawer(op)}
                        className={cn(
                          'hover:bg-surface/50 transition-colors cursor-pointer',
                          isSelected && 'bg-primary/5'
                        )}
                      >
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
                        <td className="px-4 py-2.5 text-text-muted truncate max-w-[140px]" title={op['Catégorie']}>
                          {op['Catégorie'] ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-text-muted truncate max-w-[140px]" title={op['Sous-catégorie']}>
                          {op['Sous-catégorie'] ?? ''}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={() => openDrawer(op)}
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

      {/* Attribution Drawer */}
      <JustificatifAttributionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        operation={selectedOperation}
        operationFile={selectedOpFilename ?? ''}
        operationIndex={selectedOpIndex ?? -1}
        onNextWithout={goToNextWithout}
      />
    </div>
  )
}
