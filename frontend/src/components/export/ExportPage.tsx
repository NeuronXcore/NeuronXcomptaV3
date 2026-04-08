import { useState, useMemo } from 'react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import {
  useExportStatus,
  useExportPeriods,
  useExportList,
  useDeleteExport,
  useGenerateMonthExport,
  useGenerateBatchExport,
  useExportContents,
} from '@/hooks/useExports'
import type { ExportMonthStatus, ExportFile } from '@/hooks/useExports'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import {
  Download, Loader2, Check, Calendar, FileText, File, Trash2,
  PackageCheck, Archive, Info, FolderOpen, Paperclip, FileSearch,
  Clock, HardDrive, AlertCircle, ChevronDown, Send, Minus,
} from 'lucide-react'

type Tab = 'generate' | 'history'

export default function ExportPage() {
  const [activeTab, setActiveTab] = useState<Tab>('generate')

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Export Comptable"
        description="Générer et télécharger les exports comptables mensuels"
        actions={
          <button
            onClick={() => useSendDrawerStore.getState().open({ defaultFilter: 'export' })}
            className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-sm hover:bg-surface-hover transition-colors"
          >
            <Send size={15} />
            Envoyer au comptable
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface rounded-xl border border-border p-1">
        <button
          onClick={() => setActiveTab('generate')}
          className={cn(
            'flex items-center gap-2 px-6 py-2.5 text-sm rounded-lg transition-all flex-1 justify-center',
            activeTab === 'generate'
              ? 'bg-primary text-white shadow-md'
              : 'text-text-muted hover:text-text hover:bg-surface-hover'
          )}
        >
          <PackageCheck size={16} />
          Générer des exports
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={cn(
            'flex items-center gap-2 px-6 py-2.5 text-sm rounded-lg transition-all flex-1 justify-center',
            activeTab === 'history'
              ? 'bg-primary text-white shadow-md'
              : 'text-text-muted hover:text-text hover:bg-surface-hover'
          )}
        >
          <FolderOpen size={16} />
          Historique
        </button>
      </div>

      {activeTab === 'generate' ? <GenerateTab /> : <HistoryTab />}
    </div>
  )
}


// ──── Generate Tab ────

function GenerateTab() {
  const { selectedYear, setYear } = useFiscalYearStore()
  const { data: periodsData } = useExportPeriods()
  const { data: statusData, isLoading } = useExportStatus(selectedYear)
  const generateMonth = useGenerateMonthExport()
  const generateBatch = useGenerateBatchExport()

  const years = periodsData?.years ?? []
  const months = statusData?.months ?? []

  const monthsWithData = useMemo(() => months.filter(m => m.has_data), [months])
  const readyCount = useMemo(() => months.filter(m => m.has_pdf || m.has_csv).length, [months])
  const toGenerateCount = useMemo(() => monthsWithData.filter(m => !m.has_pdf).length, [monthsWithData])

  // ── Génération unitaire ──
  const [generatingMonth, setGeneratingMonth] = useState<number | null>(null)

  async function handleExport(month: number, _formats: ('pdf' | 'csv')[]) {
    setGeneratingMonth(month)
    try {
      await generateMonth.mutateAsync({
        year: selectedYear, month, format: 'pdf',
      })
      toast.success('Export PDF + CSV généré — disponible dans l\'historique')
    } catch {
      toast.error('Erreur lors de la génération')
    } finally {
      setGeneratingMonth(null)
    }
  }

  // ── Batch ──
  const [batchFormat, setBatchFormat] = useState<'pdf' | 'csv' | null>(null)

  async function handleBatchExport(format: 'pdf' | 'csv') {
    const mList = monthsWithData.map(m => m.month)
    if (mList.length === 0) {
      toast.error("Aucun mois avec données")
      return
    }
    setBatchFormat(format)
    try {
      const result = await generateBatch.mutateAsync({ year: selectedYear, months: mList, format })
      toast.success(`${result.generated_count} exports générés — disponibles dans l'historique`)
    } catch {
      toast.error('Erreur lors de la génération batch')
    } finally {
      setBatchFormat(null)
    }
  }

  if (isLoading) return <LoadingSpinner text="Chargement..." />

  return (
    <div>
      {/* Year selector */}
      <div className="flex items-center gap-3 mb-5">
        {years.map(y => (
          <button
            key={y}
            onClick={() => setYear(y)}
            className={cn(
              'px-5 py-2 rounded-lg text-sm font-medium transition-colors',
              selectedYear === y
                ? 'bg-primary text-white shadow-md'
                : 'bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-hover'
            )}
          >
            {y}
          </button>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between mb-5 bg-surface rounded-xl border border-border p-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleBatchExport('pdf')}
            disabled={monthsWithData.length === 0 || batchFormat !== null}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {batchFormat === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
            Tout exporter PDF (ZIP)
          </button>
          <button
            onClick={() => handleBatchExport('csv')}
            disabled={monthsWithData.length === 0 || batchFormat !== null}
            className="flex items-center gap-2 px-4 py-2.5 bg-surface border border-border text-text rounded-lg text-sm font-medium hover:bg-surface-hover disabled:opacity-50 transition-colors"
          >
            {batchFormat === 'csv' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Tout exporter CSV (ZIP)
          </button>
        </div>
        <div className="text-xs text-text-muted flex items-center gap-3">
          {readyCount > 0 && (
            <span className="flex items-center gap-1.5">
              <Check size={12} className="text-emerald-400" />
              {readyCount} prêts
            </span>
          )}
          {toGenerateCount > 0 && (
            <span className="flex items-center gap-1.5 text-amber-400">
              <PackageCheck size={12} />
              {toGenerateCount} à générer
            </span>
          )}
        </div>
      </div>

      {/* Calendar grid 4×3 */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {months.map(month => (
          <ExportMonthCard
            key={month.month}
            month={month}
            year={selectedYear}
            isGenerating={generatingMonth === month.month}
            onExport={handleExport}
          />
        ))}
      </div>

      {/* Info banner */}
      <div className="bg-info/10 border border-info/20 rounded-xl p-4 flex items-start gap-3 text-sm text-info">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div>
          <p>
            Chaque export génère un <strong>ZIP</strong> contenant l'export comptable (PDF ou CSV)
            + les relevés bancaires, rapports et justificatifs de la période.
          </p>
          <p className="text-xs mt-1 opacity-70">
            Architecture : <code className="bg-info/10 px-1 rounded">operations.pdf</code> +
            dossiers <code className="bg-info/10 px-1 rounded">releves/</code>,
            <code className="bg-info/10 px-1 rounded">rapports/</code>,
            <code className="bg-info/10 px-1 rounded">justificatifs/</code>
          </p>
        </div>
      </div>

    </div>
  )
}


// ──── ExportMonthCard ────

interface ExportMonthCardProps {
  month: ExportMonthStatus
  year: number
  isGenerating: boolean
  onExport: (month: number, formats: ('pdf' | 'csv')[]) => void
}

function ExportMonthCard({ month: m, year, isGenerating, onExport }: ExportMonthCardProps) {
  const [selectedFormats, setSelectedFormats] = useState<Set<'pdf' | 'csv'>>(new Set(['pdf', 'csv']))

  const toggleFormat = (fmt: 'pdf' | 'csv') => {
    setSelectedFormats(prev => {
      const next = new Set(prev)
      if (next.has(fmt)) {
        if (next.size > 1) next.delete(fmt)
      } else {
        next.add(fmt)
      }
      return next
    })
  }

  if (!m.has_data) {
    return (
      <div className="rounded-xl border border-border bg-background/50 p-4 opacity-35">
        <p className="text-sm font-medium text-text-muted">{m.label}</p>
        <p className="text-[10px] text-text-muted mt-1">Pas de données</p>
      </div>
    )
  }

  const hasExport = m.has_pdf || m.has_csv

  return (
    <div className={cn(
      'rounded-xl border p-4 transition-all',
      hasExport
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-amber-500/30 bg-amber-500/5'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-text">{m.label}</p>
        <div className="flex gap-1">
          {m.has_pdf && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400">PDF</span>
          )}
          {m.has_csv && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400">CSV</span>
          )}
          {!hasExport && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400">à générer</span>
          )}
        </div>
      </div>

      {/* Stats */}
      <p className="text-xs text-text-muted">{m.nb_operations} opérations</p>

      {/* ZIP content preview */}
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1.5">
        {m.nb_releves > 0 && (
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            <FileSearch size={9} className="text-amber-400" />
            {m.nb_releves} relevé
          </span>
        )}
        {m.nb_rapports > 0 && (
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            <FolderOpen size={9} className="text-primary" />
            {m.nb_rapports} rapport{m.nb_rapports > 1 ? 's' : ''}
          </span>
        )}
        {m.nb_justificatifs > 0 && (
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            <Paperclip size={9} className="text-info" />
            {m.nb_justificatifs} justif.
          </span>
        )}
      </div>

      {/* Format toggles + Export button */}
      <div className="flex items-center gap-1.5 mt-3">
        {/* PDF toggle */}
        <button
          onClick={() => toggleFormat('pdf')}
          disabled={isGenerating}
          className={cn(
            'px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all border-2 disabled:opacity-50',
            selectedFormats.has('pdf')
              ? 'border-danger/50 bg-danger/15 text-danger'
              : 'border-border bg-background text-text-muted hover:border-danger/30'
          )}
        >
          PDF
        </button>

        {/* CSV toggle */}
        <button
          onClick={() => toggleFormat('csv')}
          disabled={isGenerating}
          className={cn(
            'px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all border-2 disabled:opacity-50',
            selectedFormats.has('csv')
              ? 'border-success/50 bg-success/15 text-success'
              : 'border-border bg-background text-text-muted hover:border-success/30'
          )}
        >
          CSV
        </button>

        {/* Export button */}
        <button
          onClick={() => onExport(m.month, Array.from(selectedFormats))}
          disabled={isGenerating}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isGenerating ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Download size={11} />
          )}
          Exporter
        </button>
      </div>
    </div>
  )
}


// ──── History Tab ────

function HistoryTab() {
  const { data: exports, isLoading } = useExportList()
  const deleteMutation = useDeleteExport()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [selectedExports, setSelectedExports] = useState<Set<string>>(new Set())
  const openSendDrawer = useSendDrawerStore(s => s.open)

  const list = exports ?? []

  const toggleSelect = (filename: string) => {
    setSelectedExports(prev => {
      const next = new Set(prev)
      if (next.has(filename)) next.delete(filename)
      else next.add(filename)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedExports.size === list.length) {
      setSelectedExports(new Set())
    } else {
      setSelectedExports(new Set(list.map(e => e.filename)))
    }
  }

  const handleDownload = (filename: string) => {
    window.open(`/api/exports/download/${encodeURIComponent(filename)}`, '_blank')
  }

  const toggleExpand = (filename: string) => {
    setExpandedFile(prev => prev === filename ? null : filename)
  }

  if (isLoading) return <LoadingSpinner text="Chargement des exports..." />

  if (list.length === 0) {
    return (
      <div className="bg-surface rounded-2xl border border-border p-16 text-center">
        <FolderOpen size={48} className="mx-auto mb-4 text-text-muted opacity-30" />
        <p className="text-lg text-text-muted mb-2">Aucun export</p>
        <p className="text-sm text-text-muted">Générez votre premier export dans l'onglet précédent</p>
      </div>
    )
  }

  // Group by year
  const byYear = list.reduce<Record<number, ExportFile[]>>((acc, e) => {
    const y = e.year ?? 0
    if (!acc[y]) acc[y] = []
    acc[y].push(e)
    return acc
  }, {})

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }

  const allSelected = selectedExports.size === list.length
  const someSelected = selectedExports.size > 0

  return (
    <div className="space-y-4">
      {/* Selection toolbar */}
      {someSelected && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex items-center gap-3 sticky top-0 z-10">
          <button
            onClick={toggleSelectAll}
            className={cn(
              'w-[22px] h-[22px] rounded flex items-center justify-center border-2 shrink-0 transition-all',
              allSelected
                ? 'bg-primary border-transparent'
                : 'bg-primary/40 border-transparent'
            )}
          >
            {allSelected ? <Check size={13} className="text-white" /> : <Minus size={13} className="text-white" />}
          </button>
          <span className="text-sm text-text">
            {selectedExports.size} sélectionné{selectedExports.size > 1 ? 's' : ''}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => {
              selectedExports.forEach(f => handleDownload(f))
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-text hover:bg-surface-hover transition-colors"
          >
            <Download size={13} />
            Télécharger ({selectedExports.size})
          </button>
          <button
            onClick={() => {
              const preselected = Array.from(selectedExports).map(filename => ({
                type: 'export' as const,
                filename,
              }))
              openSendDrawer({ preselected, defaultFilter: 'export' })
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Send size={13} />
            Envoyer au comptable ({selectedExports.size})
          </button>
        </div>
      )}

      {Object.entries(byYear)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([year, yearExports]) => (
          <div key={year}>
            <h3 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2">
              <Calendar size={14} />
              {year === '0' ? 'Autres' : year}
            </h3>

            <div className="space-y-2">
              {yearExports.map(exp => {
                const isExpanded = expandedFile === exp.filename
                const isSelected = selectedExports.has(exp.filename)
                return (
                  <div
                    key={exp.filename}
                    className={cn(
                      'bg-surface rounded-xl border-2 overflow-hidden transition-colors',
                      isSelected ? 'border-primary' : 'border-border'
                    )}
                  >
                    {/* Header row */}
                    <div className="p-4 flex items-center gap-3 hover:bg-surface-hover transition-colors">
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleSelect(exp.filename)}
                        className={cn(
                          'w-[22px] h-[22px] rounded flex items-center justify-center border-2 shrink-0 transition-all',
                          isSelected
                            ? 'bg-primary border-transparent shadow-sm'
                            : 'bg-surface border-text-muted/30 hover:border-primary/50'
                        )}
                      >
                        {isSelected && <Check size={13} className="text-white" />}
                      </button>

                      {/* Expand button */}
                      <button
                        onClick={() => toggleExpand(exp.filename)}
                        className="w-8 h-8 rounded-lg bg-background flex items-center justify-center flex-shrink-0 hover:bg-primary/10 transition-colors"
                        title="Voir le contenu"
                      >
                        <ChevronDown
                          size={16}
                          className={cn(
                            'text-primary transition-transform duration-200',
                            isExpanded && 'rotate-180'
                          )}
                        />
                      </button>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate text-text">
                          {exp.month_name ? `${exp.month_name} ${exp.year}` : exp.filename}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-text-muted mt-1">
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {formatDate(exp.created)}
                          </span>
                          <span className="flex items-center gap-1">
                            <HardDrive size={12} />
                            {exp.size_human}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                            ZIP
                          </span>
                        </div>
                      </div>

                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleDownload(exp.filename)}
                          className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                          title="Télécharger"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(exp.filename)}
                          className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Expandable file list */}
                    {isExpanded && (
                      <ZipContentsPanel filename={exp.filename} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmDelete(null)}>
          <div className="bg-surface rounded-2xl border border-border p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center">
                <AlertCircle size={20} className="text-danger" />
              </div>
              <div>
                <h3 className="font-semibold text-text">Supprimer cet export ?</h3>
                <p className="text-xs text-text-muted mt-1 font-mono">{confirmDelete}</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm bg-surface-hover rounded-lg hover:bg-border transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  deleteMutation.mutate(confirmDelete)
                  setConfirmDelete(null)
                }}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-danger text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}


// ──── ZIP Contents Panel ────

function ZipContentsPanel({ filename }: { filename: string }) {
  const { data, isLoading } = useExportContents(filename)

  if (isLoading) {
    return (
      <div className="px-4 pb-4 pt-0">
        <div className="bg-background rounded-lg p-3 flex items-center gap-2 text-xs text-text-muted">
          <Loader2 size={12} className="animate-spin" />
          Lecture du contenu...
        </div>
      </div>
    )
  }

  const files = data?.files ?? []
  if (files.length === 0) {
    return (
      <div className="px-4 pb-4 pt-0">
        <div className="bg-background rounded-lg p-3 text-xs text-text-muted">
          Aucun fichier trouvé
        </div>
      </div>
    )
  }

  // Group by folder
  const grouped: Record<string, typeof files> = {}
  for (const f of files) {
    const parts = f.name.split('/')
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '/'
    if (!grouped[folder]) grouped[folder] = []
    grouped[folder].push(f)
  }

  function fileIcon(name: string) {
    const ext = name.split('.').pop()?.toLowerCase()
    if (ext === 'pdf') return <File size={11} className="text-danger shrink-0" />
    if (ext === 'csv') return <FileText size={11} className="text-success shrink-0" />
    return <File size={11} className="text-text-muted shrink-0" />
  }

  const folderIcon = (folder: string) => {
    if (folder.includes('releve')) return <FileSearch size={12} className="text-amber-400" />
    if (folder.includes('rapport')) return <FolderOpen size={12} className="text-primary" />
    if (folder.includes('justificatif')) return <Paperclip size={12} className="text-info" />
    return <FolderOpen size={12} className="text-text-muted" />
  }

  return (
    <div className="px-4 pb-4 pt-0">
      <div className="bg-background rounded-lg border border-border/50 divide-y divide-border/30">
        {Object.entries(grouped).map(([folder, folderFiles]) => (
          <div key={folder} className="p-2.5">
            {folder !== '/' && (
              <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-semibold text-text-muted uppercase">
                {folderIcon(folder)}
                {folder}
                <span className="font-normal ml-1 text-text-muted/60">({folderFiles.length})</span>
              </div>
            )}
            <div className="space-y-0.5">
              {folderFiles.map((f, i) => {
                const basename = f.name.split('/').pop() || f.name
                return (
                  <div key={i} className="flex items-center gap-2 text-xs text-text py-0.5 px-1 rounded hover:bg-surface-hover">
                    {fileIcon(basename)}
                    <span className="truncate flex-1 font-mono text-[11px]">{basename}</span>
                    <span className="text-[10px] text-text-muted shrink-0">{f.size_human}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-text-muted mt-1.5 text-right">
        {files.length} fichier{files.length > 1 ? 's' : ''} dans l'archive
      </p>
    </div>
  )
}
