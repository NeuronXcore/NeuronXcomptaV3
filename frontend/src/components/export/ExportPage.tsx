import { useState, useMemo } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import {
  useExportPeriods,
  useExportList,
  useGenerateExport,
  useDeleteExport,
} from '@/hooks/useExports'
import type { ExportPeriod, ExportFile, ExportResult } from '@/hooks/useExports'
import { formatCurrency, cn } from '@/lib/utils'
import {
  PackageCheck, Download, Trash2, Loader2, Check, AlertCircle,
  Calendar, FileText, FileSpreadsheet, File, Clock, HardDrive,
  FolderOpen, Paperclip, FileSearch, Archive,
} from 'lucide-react'

type Tab = 'generate' | 'history'

export default function ExportPage() {
  const [activeTab, setActiveTab] = useState<Tab>('generate')
  const { data: periodsData } = useExportPeriods()
  const { data: exports } = useExportList()

  const totalExports = exports?.length ?? 0
  const totalSize = exports?.reduce((s, e) => s + e.size, 0) ?? 0

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Export Comptable"
        description="Générer des archives ZIP contenant opérations, relevés bancaires et justificatifs"
      />

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Périodes disponibles"
          value={String(periodsData?.periods.length ?? 0)}
          icon={<Calendar size={18} />}
        />
        <MetricCard
          title="Exports générés"
          value={String(totalExports)}
          icon={<Archive size={18} />}
        />
        <MetricCard
          title="Espace utilisé"
          value={totalSize < 1024 * 1024
            ? `${(totalSize / 1024).toFixed(0)} Ko`
            : `${(totalSize / 1024 / 1024).toFixed(1)} Mo`}
          icon={<HardDrive size={18} />}
        />
        <MetricCard
          title="Années"
          value={periodsData?.years.join(', ') || '-'}
          icon={<Clock size={18} />}
        />
      </div>

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
          Générer un export
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
          Historique des exports
        </button>
      </div>

      {activeTab === 'generate' ? <GenerateTab /> : <HistoryTab />}
    </div>
  )
}


// ──── Generate Tab ────

function GenerateTab() {
  const { data: periodsData, isLoading } = useExportPeriods()
  const generateMutation = useGenerateExport()

  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<{ year: number; month: number } | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)

  // Options
  const [includeCsv, setIncludeCsv] = useState(true)
  const [includePdf, setIncludePdf] = useState(true)
  const [includeExcel, setIncludeExcel] = useState(false)
  const [includeBankStatement, setIncludeBankStatement] = useState(true)
  const [includeJustificatifs, setIncludeJustificatifs] = useState(true)
  const [includeReports, setIncludeReports] = useState(false)

  // Set default year when data loads
  const years = periodsData?.years ?? []
  const effectiveYear = selectedYear ?? years[0] ?? null

  const monthsForYear = useMemo(() => {
    if (!periodsData || !effectiveYear) return []
    return periodsData.periods.filter(p => p.year === effectiveYear)
  }, [periodsData, effectiveYear])

  // Selected period details
  const selectedPeriod = useMemo(() => {
    if (!selectedMonth || !periodsData) return null
    return periodsData.periods.find(
      p => p.year === selectedMonth.year && p.month === selectedMonth.month
    ) ?? null
  }, [selectedMonth, periodsData])

  const handleGenerate = () => {
    if (!selectedMonth) return
    setResult(null)
    generateMutation.mutate(
      {
        year: selectedMonth.year,
        month: selectedMonth.month,
        include_csv: includeCsv,
        include_pdf: includePdf,
        include_excel: includeExcel,
        include_bank_statement: includeBankStatement,
        include_justificatifs: includeJustificatifs,
        include_reports: includeReports,
      },
      { onSuccess: (data) => setResult(data) }
    )
  }

  const handleDownload = (filename: string) => {
    window.open(`/api/exports/download/${encodeURIComponent(filename)}`, '_blank')
  }

  if (isLoading) return <LoadingSpinner text="Chargement des périodes..." />

  if (!periodsData || periodsData.periods.length === 0) {
    return (
      <div className="bg-surface rounded-2xl border border-border p-16 text-center">
        <Calendar size={48} className="mx-auto mb-4 text-text-muted opacity-30" />
        <p className="text-lg text-text-muted mb-2">Aucune période disponible</p>
        <p className="text-sm text-text-muted">Importez d'abord des relevés bancaires</p>
      </div>
    )
  }

  const MONTH_NAMES = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Period selection */}
      <div className="lg:col-span-2 space-y-4">
        {/* Year selector */}
        <div className="bg-surface rounded-2xl border border-border p-5">
          <h3 className="font-semibold text-text flex items-center gap-2 mb-4">
            <Calendar size={18} />
            Sélection de la période
          </h3>

          {/* Year tabs */}
          <div className="flex gap-2 mb-5">
            {years.map(y => (
              <button
                key={y}
                onClick={() => { setSelectedYear(y); setSelectedMonth(null); setResult(null) }}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  (effectiveYear === y)
                    ? 'bg-primary text-white'
                    : 'bg-background text-text-muted hover:text-text hover:bg-surface-hover'
                )}
              >
                {y}
              </button>
            ))}
          </div>

          {/* Calendar grid */}
          {effectiveYear && (
            <div className="grid grid-cols-4 gap-2">
              {MONTH_NAMES.map((name, i) => {
                const monthNum = i + 1
                const period = monthsForYear.find(m => m.month === monthNum)
                const isAvailable = !!period
                const isSelected = selectedMonth?.year === effectiveYear && selectedMonth?.month === monthNum
                const hasExport = period?.has_export ?? false

                return (
                  <button
                    key={monthNum}
                    onClick={() => {
                      if (isAvailable) {
                        setSelectedMonth({ year: effectiveYear, month: monthNum })
                        setResult(null)
                      }
                    }}
                    disabled={!isAvailable}
                    className={cn(
                      'relative rounded-xl p-3 text-center transition-all border-2',
                      isSelected
                        ? 'border-primary bg-primary/10'
                        : isAvailable
                          ? hasExport
                            ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 cursor-pointer'
                            : 'border-border bg-background hover:bg-surface-hover cursor-pointer'
                          : 'border-transparent bg-background/50 opacity-40 cursor-not-allowed'
                    )}
                  >
                    <p className={cn(
                      'text-sm font-medium',
                      isSelected ? 'text-primary' : isAvailable ? 'text-text' : 'text-text-muted'
                    )}>
                      {name}
                    </p>
                    {isAvailable && (
                      <p className="text-[10px] text-text-muted mt-1">
                        {period!.count} ops
                      </p>
                    )}
                    {hasExport && (
                      <div className="absolute top-1.5 right-1.5">
                        <Check size={12} className="text-emerald-400" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Selected period stats */}
        {selectedPeriod && (
          <div className="bg-surface rounded-2xl border border-border p-5">
            <h3 className="font-semibold text-text mb-4">
              Statistiques — {selectedPeriod.month_name} {selectedPeriod.year}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-background rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-text">{selectedPeriod.count}</p>
                <p className="text-xs text-text-muted mt-1">Opérations</p>
              </div>
              <div className="bg-background rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-danger">{formatCurrency(selectedPeriod.total_debit)}</p>
                <p className="text-xs text-text-muted mt-1">Débits</p>
              </div>
              <div className="bg-background rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-success">{formatCurrency(selectedPeriod.total_credit)}</p>
                <p className="text-xs text-text-muted mt-1">Crédits</p>
              </div>
              <div className="bg-background rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-primary">{selectedPeriod.justificatif_ratio}%</p>
                <p className="text-xs text-text-muted mt-1">Justifiées</p>
                <div className="w-full h-1.5 bg-surface rounded-full mt-2 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      selectedPeriod.justificatif_ratio >= 80 ? 'bg-emerald-500' :
                      selectedPeriod.justificatif_ratio >= 50 ? 'bg-amber-500' : 'bg-red-400'
                    )}
                    style={{ width: `${selectedPeriod.justificatif_ratio}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: Options + Generate */}
      <div className="space-y-4">
        {/* Content options */}
        <div className="bg-surface rounded-2xl border border-border p-5">
          <h3 className="font-semibold text-text mb-4">Contenu de l'export</h3>

          <div className="space-y-3">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Formats des opérations</p>
            {[
              { checked: includeCsv, set: setIncludeCsv, label: 'CSV', desc: 'Tableur Excel', icon: FileText, color: 'text-success' },
              { checked: includePdf, set: setIncludePdf, label: 'PDF', desc: 'Document imprimable', icon: File, color: 'text-danger' },
              { checked: includeExcel, set: setIncludeExcel, label: 'Excel', desc: 'Multi-feuilles', icon: FileSpreadsheet, color: 'text-info' },
            ].map(opt => (
              <label
                key={opt.label}
                className={cn(
                  'flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all border',
                  opt.checked ? 'bg-primary/5 border-primary/20' : 'border-transparent hover:bg-surface-hover'
                )}
              >
                <input
                  type="checkbox"
                  checked={opt.checked}
                  onChange={e => opt.set(e.target.checked)}
                  className="accent-primary w-4 h-4"
                />
                <opt.icon size={16} className={opt.color} />
                <div>
                  <p className="text-sm text-text">{opt.label}</p>
                  <p className="text-[10px] text-text-muted">{opt.desc}</p>
                </div>
              </label>
            ))}

            <div className="border-t border-border/50 my-2" />
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Documents annexes</p>

            {[
              { checked: includeBankStatement, set: setIncludeBankStatement, label: 'Relevé bancaire', desc: 'PDF original', icon: FileSearch },
              { checked: includeJustificatifs, set: setIncludeJustificatifs, label: 'Justificatifs', desc: 'PDFs associés', icon: Paperclip },
              { checked: includeReports, set: setIncludeReports, label: 'Rapports générés', desc: 'CSV/PDF/Excel existants', icon: FolderOpen },
            ].map(opt => (
              <label
                key={opt.label}
                className={cn(
                  'flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all border',
                  opt.checked ? 'bg-primary/5 border-primary/20' : 'border-transparent hover:bg-surface-hover'
                )}
              >
                <input
                  type="checkbox"
                  checked={opt.checked}
                  onChange={e => opt.set(e.target.checked)}
                  className="accent-primary w-4 h-4"
                />
                <opt.icon size={16} className="text-text-muted" />
                <div>
                  <p className="text-sm text-text">{opt.label}</p>
                  <p className="text-[10px] text-text-muted">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!selectedMonth || (!includeCsv && !includePdf && !includeExcel) || generateMutation.isPending}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-primary text-white rounded-2xl hover:bg-primary-dark disabled:opacity-50 transition-colors font-medium text-sm shadow-lg shadow-primary/25"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Génération en cours...
            </>
          ) : (
            <>
              <PackageCheck size={18} />
              Générer l'export ZIP
            </>
          )}
        </button>

        {/* Error */}
        {generateMutation.isError && (
          <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-sm text-danger flex items-start gap-3">
            <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Erreur de génération</p>
              <p className="text-xs mt-1 opacity-80">{generateMutation.error.message}</p>
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="bg-success/10 border border-success/30 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                <Check size={20} className="text-success" />
              </div>
              <div>
                <p className="font-semibold text-success">Export généré</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {result.month_name} {result.year} — {result.size_human}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-background/50 rounded-lg p-2 flex justify-between">
                <span className="text-text-muted">Opérations</span>
                <span className="font-mono font-medium">{result.operations_count}</span>
              </div>
              <div className="bg-background/50 rounded-lg p-2 flex justify-between">
                <span className="text-text-muted">Justificatifs</span>
                <span className="font-mono font-medium text-primary">{result.justificatif_count}</span>
              </div>
              <div className="bg-background/50 rounded-lg p-2 flex justify-between">
                <span className="text-text-muted">Débits</span>
                <span className="font-mono text-danger">{formatCurrency(result.total_debit)}</span>
              </div>
              <div className="bg-background/50 rounded-lg p-2 flex justify-between">
                <span className="text-text-muted">Crédits</span>
                <span className="font-mono text-success">{formatCurrency(result.total_credit)}</span>
              </div>
            </div>

            {/* Files included */}
            {result.files_included.length > 0 && (
              <div>
                <p className="text-xs text-text-muted mb-1.5">Fichiers inclus :</p>
                <div className="space-y-1">
                  {result.files_included.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-text">
                      <FileIncludedIcon type={f.type} />
                      <span className="truncate">{f.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => handleDownload(result.filename)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-success text-white rounded-xl hover:bg-green-600 transition-colors text-sm font-medium"
            >
              <Download size={16} />
              Télécharger {result.filename}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function FileIncludedIcon({ type }: { type: string }) {
  switch (type) {
    case 'csv': return <FileText size={12} className="text-success flex-shrink-0" />
    case 'pdf': return <File size={12} className="text-danger flex-shrink-0" />
    case 'xlsx': return <FileSpreadsheet size={12} className="text-info flex-shrink-0" />
    case 'bank_pdf': return <FileSearch size={12} className="text-amber-400 flex-shrink-0" />
    case 'justificatifs': return <Paperclip size={12} className="text-primary flex-shrink-0" />
    case 'report': return <FolderOpen size={12} className="text-text-muted flex-shrink-0" />
    default: return <File size={12} className="text-text-muted flex-shrink-0" />
  }
}


// ──── History Tab ────

function HistoryTab() {
  const { data: exports, isLoading } = useExportList()
  const deleteMutation = useDeleteExport()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const handleDownload = (filename: string) => {
    window.open(`/api/exports/download/${encodeURIComponent(filename)}`, '_blank')
  }

  if (isLoading) return <LoadingSpinner text="Chargement des exports..." />

  const list = exports ?? []

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

  return (
    <div className="space-y-6">
      {Object.entries(byYear)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([year, yearExports]) => (
          <div key={year}>
            <h3 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2">
              <Calendar size={14} />
              {year === '0' ? 'Autres' : year}
            </h3>

            <div className="space-y-2">
              {yearExports.map(exp => (
                <div
                  key={exp.filename}
                  className="bg-surface rounded-xl border border-border p-4 flex items-center gap-4 hover:bg-surface-hover transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-background flex items-center justify-center flex-shrink-0">
                    <Archive size={18} className="text-primary" />
                  </div>

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
              ))}
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
