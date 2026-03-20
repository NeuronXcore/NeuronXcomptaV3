import { useState, useMemo, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FileText, Download, Trash2, Loader2, Check, AlertCircle,
  Filter, Calendar, FileSpreadsheet, File, ChevronDown,
  ChevronRight, FolderOpen, Clock, HardDrive, Eye, EyeOff,
  BarChart3, TrendingDown, TrendingUp,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { useOperationFiles } from '@/hooks/useOperations'
import { useCategories } from '@/hooks/useApi'
import { api } from '@/api/client'
import { formatCurrency, formatFileTitle, cn } from '@/lib/utils'

type Tab = 'generate' | 'gallery'

interface ReportFile {
  filename: string
  format: string
  size: number
  size_human: string
  created: string
  directory: string
}

interface GenerateResult {
  filename: string
  format: string
  operations_count: number
  total_debit: number
  total_credit: number
  solde: number
  categorized: number
  period: string
  size_human: string
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('generate')

  return (
    <div>
      <PageHeader
        title="Rapports"
        description="Générer et gérer vos rapports comptables PDF, CSV et Excel"
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
          <FileText size={16} />
          Générer un rapport
        </button>
        <button
          onClick={() => setActiveTab('gallery')}
          className={cn(
            'flex items-center gap-2 px-6 py-2.5 text-sm rounded-lg transition-all flex-1 justify-center',
            activeTab === 'gallery'
              ? 'bg-primary text-white shadow-md'
              : 'text-text-muted hover:text-text hover:bg-surface-hover'
          )}
        >
          <FolderOpen size={16} />
          Galerie des rapports
        </button>
      </div>

      {activeTab === 'generate' && <GenerateTab />}
      {activeTab === 'gallery' && <GalleryTab />}
    </div>
  )
}

// ─── Tab 1: Générer un rapport ──────────────────────────────────────

function GenerateTab() {
  const { data: files, isLoading: filesLoading } = useOperationFiles()
  const { data: categoriesData } = useCategories()
  const queryClient = useQueryClient()

  // Form state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<string>('csv')
  const [title, setTitle] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Filters
  const [filterCategory, setFilterCategory] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterImportant, setFilterImportant] = useState(false)
  const [filterARevoir, setFilterARevoir] = useState(false)
  const [filterJustificatif, setFilterJustificatif] = useState(false)
  const [filterMinAmount, setFilterMinAmount] = useState('')

  // Result
  const [result, setResult] = useState<GenerateResult | null>(null)

  const categoryNames = useMemo(() => {
    if (!categoriesData) return []
    return [...new Set(categoriesData.raw.map(c => c['Catégorie']))].filter(Boolean).sort()
  }, [categoriesData])

  const generateMutation = useMutation({
    mutationFn: () => {
      const filters: Record<string, unknown> = {}
      if (filterCategory) filters.category = filterCategory
      if (filterDateFrom) filters.date_from = filterDateFrom
      if (filterDateTo) filters.date_to = filterDateTo
      if (filterImportant) filters.important_only = true
      if (filterARevoir) filters.a_revoir_only = true
      if (filterJustificatif) filters.with_justificatif = true
      if (filterMinAmount) filters.min_amount = parseFloat(filterMinAmount)

      return api.post<GenerateResult>('/reports/generate', {
        source_files: Array.from(selectedFiles),
        format,
        title: title || undefined,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      })
    },
    onSuccess: (data) => {
      setResult(data)
      queryClient.invalidateQueries({ queryKey: ['reports-gallery'] })
    },
  })

  const toggleFile = (filename: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      next.has(filename) ? next.delete(filename) : next.add(filename)
      return next
    })
  }

  const selectAll = () => {
    if (!files) return
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set())
    } else {
      setSelectedFiles(new Set(files.map(f => f.filename)))
    }
  }

  const handleGenerate = () => {
    if (selectedFiles.size === 0) return
    setResult(null)
    generateMutation.mutate()
  }

  const handleDownload = (filename: string) => {
    window.open(`/api/reports/download/${encodeURIComponent(filename)}`, '_blank')
  }

  if (filesLoading) return <LoadingSpinner text="Chargement des fichiers..." />

  const totalOps = files?.filter(f => selectedFiles.has(f.filename)).reduce((s, f) => s + f.count, 0) || 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: File selection */}
      <div className="lg:col-span-2 space-y-4">
        {/* File selector */}
        <div className="bg-surface rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-text flex items-center gap-2">
              <FileText size={18} />
              Fichiers source
            </h3>
            <button
              onClick={selectAll}
              className="text-xs text-primary hover:underline"
            >
              {selectedFiles.size === files?.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
          </div>

          <div className="space-y-1.5 max-h-[350px] overflow-y-auto pr-1">
            {files?.map(f => {
              const isSelected = selectedFiles.has(f.filename)
              return (
                <label
                  key={f.filename}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all border',
                    isSelected
                      ? 'bg-primary/10 border-primary/30'
                      : 'bg-background border-transparent hover:bg-surface-hover hover:border-border'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleFile(f.filename)}
                    className="w-4 h-4 accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-text">{formatFileTitle(f)}</p>
                    <p className="text-xs text-text-muted">
                      {f.count} ops | Débit: {formatCurrency(f.total_debit)} | Crédit: {formatCurrency(f.total_credit)}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>

          {selectedFiles.size > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50 text-xs text-text-muted flex justify-between">
              <span>{selectedFiles.size} fichier(s) sélectionné(s)</span>
              <span>{totalOps} opérations</span>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-text hover:bg-surface-hover transition-colors"
          >
            <span className="flex items-center gap-2">
              <Filter size={16} />
              Filtres avancés
              {(filterCategory || filterDateFrom || filterDateTo || filterImportant || filterARevoir || filterJustificatif || filterMinAmount) && (
                <span className="w-2 h-2 bg-primary rounded-full" />
              )}
            </span>
            {showFilters ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {showFilters && (
            <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border/50 pt-4">
              {/* Category */}
              <div>
                <label className="text-xs font-medium text-text-muted mb-1.5 block">Catégorie</label>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Toutes</option>
                  {categoryNames.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Min amount */}
              <div>
                <label className="text-xs font-medium text-text-muted mb-1.5 block">Montant minimum</label>
                <input
                  type="number"
                  step="0.01"
                  value={filterMinAmount}
                  onChange={e => setFilterMinAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Date from */}
              <div>
                <label className="text-xs font-medium text-text-muted mb-1.5 block">Date début</label>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={e => setFilterDateFrom(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Date to */}
              <div>
                <label className="text-xs font-medium text-text-muted mb-1.5 block">Date fin</label>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={e => setFilterDateTo(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Checkbox filters */}
              <div className="md:col-span-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterImportant}
                    onChange={e => setFilterImportant(e.target.checked)}
                    className="accent-warning"
                  />
                  Important uniquement
                </label>
                <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterARevoir}
                    onChange={e => setFilterARevoir(e.target.checked)}
                    className="accent-danger"
                  />
                  À revoir uniquement
                </label>
                <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterJustificatif}
                    onChange={e => setFilterJustificatif(e.target.checked)}
                    className="accent-primary"
                  />
                  Avec justificatif
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Format + Generate */}
      <div className="space-y-4">
        {/* Format selection */}
        <div className="bg-surface rounded-2xl border border-border p-5">
          <h3 className="font-semibold text-text mb-4">Format du rapport</h3>

          <div className="space-y-2">
            {[
              { id: 'csv', label: 'CSV', desc: 'Tableur simple, compatible Excel', icon: FileText, color: 'text-success' },
              { id: 'pdf', label: 'PDF', desc: 'Document mis en forme, impression', icon: File, color: 'text-danger' },
              { id: 'xlsx', label: 'Excel', desc: 'Multi-feuilles avec analyse', icon: FileSpreadsheet, color: 'text-info' },
            ].map(fmt => (
              <label
                key={fmt.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border',
                  format === fmt.id
                    ? 'bg-primary/10 border-primary/30'
                    : 'bg-background border-transparent hover:border-border'
                )}
              >
                <input
                  type="radio"
                  name="format"
                  value={fmt.id}
                  checked={format === fmt.id}
                  onChange={() => setFormat(fmt.id)}
                  className="accent-primary"
                />
                <fmt.icon size={20} className={fmt.color} />
                <div>
                  <p className="text-sm font-medium text-text">{fmt.label}</p>
                  <p className="text-xs text-text-muted">{fmt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Title */}
        <div className="bg-surface rounded-2xl border border-border p-5">
          <label className="text-sm font-medium text-text mb-2 block">
            Titre du rapport (optionnel)
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Ex: Rapport mensuel septembre 2024"
            className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={selectedFiles.size === 0 || generateMutation.isPending}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-primary text-white rounded-2xl hover:bg-primary-dark disabled:opacity-50 transition-colors font-medium text-sm shadow-lg shadow-primary/25"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Génération en cours...
            </>
          ) : (
            <>
              <FileText size={18} />
              Générer le rapport
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
                <p className="font-semibold text-success">Rapport généré</p>
                <p className="text-xs text-text-muted mt-0.5">{result.size_human} | {result.format}</p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-background/50 rounded-lg p-2 flex justify-between">
                <span className="text-text-muted">Opérations</span>
                <span className="font-mono font-medium">{result.operations_count}</span>
              </div>
              <div className="bg-background/50 rounded-lg p-2 flex justify-between">
                <span className="text-text-muted">Catégorisées</span>
                <span className="font-mono font-medium text-success">{result.categorized}</span>
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

// ─── Tab 2: Galerie des rapports ─────────────────────────────────────

function GalleryTab() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery<{ reports: ReportFile[] }>({
    queryKey: ['reports-gallery'],
    queryFn: () => api.get('/reports/gallery'),
  })

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => api.delete(`/reports/${encodeURIComponent(filename)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports-gallery'] })
      setConfirmDelete(null)
    },
  })

  const handleDownload = (filename: string) => {
    window.open(`/api/reports/download/${encodeURIComponent(filename)}`, '_blank')
  }

  if (isLoading) return <LoadingSpinner text="Chargement des rapports..." />

  const reports = data?.reports || []

  // Group by format
  const formatIcon = (fmt: string) => {
    switch (fmt) {
      case 'CSV': return <FileText size={18} className="text-success" />
      case 'PDF': return <File size={18} className="text-danger" />
      case 'XLSX': return <FileSpreadsheet size={18} className="text-info" />
      default: return <FileText size={18} className="text-text-muted" />
    }
  }

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }

  // Total disk usage
  const totalSize = reports.reduce((s, r) => s + r.size, 0)

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface rounded-xl border border-border p-4 text-center">
          <p className="text-2xl font-bold text-primary">{reports.length}</p>
          <p className="text-xs text-text-muted mt-1">Rapports</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4 text-center">
          <p className="text-2xl font-bold text-text">
            {reports.filter(r => r.format === 'PDF').length} / {reports.filter(r => r.format === 'CSV').length} / {reports.filter(r => r.format === 'XLSX').length}
          </p>
          <p className="text-xs text-text-muted mt-1">PDF / CSV / Excel</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-text-muted mb-1">
            <HardDrive size={14} />
          </div>
          <p className="text-2xl font-bold text-text">
            {totalSize < 1024 * 1024 ? `${(totalSize / 1024).toFixed(0)} KB` : `${(totalSize / 1024 / 1024).toFixed(1)} MB`}
          </p>
          <p className="text-xs text-text-muted mt-1">Espace utilisé</p>
        </div>
      </div>

      {/* Reports list */}
      {reports.length === 0 ? (
        <div className="bg-surface rounded-2xl border border-border p-16 text-center">
          <FolderOpen size={48} className="mx-auto mb-4 text-text-muted opacity-30" />
          <p className="text-lg text-text-muted mb-2">Aucun rapport</p>
          <p className="text-sm text-text-muted">Générez votre premier rapport dans l'onglet précédent</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map(report => (
            <div
              key={report.filename}
              className="bg-surface rounded-xl border border-border p-4 flex items-center gap-4 hover:bg-surface-hover transition-colors"
            >
              {/* Icon */}
              <div className="w-10 h-10 rounded-xl bg-background flex items-center justify-center flex-shrink-0">
                {formatIcon(report.format)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono truncate text-text">{report.filename}</p>
                <div className="flex items-center gap-3 text-xs text-text-muted mt-1">
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {formatDate(report.created)}
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive size={12} />
                    {report.size_human}
                  </span>
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-xs font-medium',
                    report.format === 'PDF' ? 'bg-danger/10 text-danger' :
                    report.format === 'CSV' ? 'bg-success/10 text-success' :
                    'bg-info/10 text-info'
                  )}>
                    {report.format}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => handleDownload(report.filename)}
                  className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                  title="Télécharger"
                >
                  <Download size={16} />
                </button>
                <button
                  onClick={() => setConfirmDelete(report.filename)}
                  className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                  title="Supprimer"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmDelete(null)}>
          <div className="bg-surface rounded-2xl border border-border p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center">
                <AlertCircle size={20} className="text-danger" />
              </div>
              <div>
                <h3 className="font-semibold text-text">Supprimer ce rapport ?</h3>
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
                onClick={() => deleteMutation.mutate(confirmDelete)}
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
