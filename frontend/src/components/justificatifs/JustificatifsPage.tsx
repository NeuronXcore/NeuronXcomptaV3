import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import JustificatifDrawer from './JustificatifDrawer'
import {
  useJustificatifs,
  useJustificatifStats,
  useUploadJustificatifs,
  useDeleteJustificatif,
} from '@/hooks/useJustificatifs'
import { cn, MOIS_FR } from '@/lib/utils'
import {
  Upload, Clock, CheckCircle, FileText, Search,
  Trash2, Eye, X, Loader2, AlertCircle,
} from 'lucide-react'
import type { JustificatifInfo } from '@/types'

type StatusFilter = 'all' | 'en_attente' | 'traites'
type SortBy = 'date' | 'name' | 'size'

export default function JustificatifsPage() {
  // Filters
  const [search, setSearch] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [month, setMonth] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // UI state
  const [showUpload, setShowUpload] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedJustificatif, setSelectedJustificatif] = useState<JustificatifInfo | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Data
  const { data: stats } = useJustificatifStats()
  const { data: justificatifs, isLoading } = useJustificatifs({
    status: statusFilter,
    search,
    year,
    month,
    sort_by: sortBy,
    sort_order: sortOrder,
  })
  const uploadMutation = useUploadJustificatifs()
  const deleteMutation = useDeleteJustificatif()

  // Upload handler
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      uploadMutation.mutate(acceptedFiles)
    }
  }, [uploadMutation])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
  })

  const handleView = (j: JustificatifInfo) => {
    setSelectedJustificatif(j)
    setDrawerOpen(true)
  }

  const handleDelete = (filename: string) => {
    deleteMutation.mutate(filename, {
      onSuccess: () => {
        setDeleteConfirm(null)
        if (selectedJustificatif?.filename === filename) {
          setDrawerOpen(false)
          setSelectedJustificatif(null)
        }
      },
    })
  }

  // Generate year options from current data
  const years = Array.from(
    new Set((justificatifs || []).map(j => parseInt(j.date.slice(0, 4))).filter(y => !isNaN(y)))
  ).sort((a, b) => b - a)

  return (
    <div>
      <PageHeader
        title="Justificatifs"
        description="Gestion et association des justificatifs comptables"
        actions={
          <button
            onClick={() => setShowUpload(!showUpload)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              showUpload
                ? 'bg-primary/20 text-primary border border-primary'
                : 'bg-primary text-white hover:bg-primary/90'
            )}
          >
            <Upload size={16} />
            {showUpload ? 'Masquer Upload' : 'Upload'}
          </button>
        }
      />

      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <MetricCard
            title="En attente"
            value={String(stats?.en_attente ?? 0)}
            icon={<Clock size={20} />}
            trend={stats?.en_attente ? 'down' : undefined}
          />
          <MetricCard
            title="Traités"
            value={String(stats?.traites ?? 0)}
            icon={<CheckCircle size={20} />}
            trend="up"
          />
          <MetricCard
            title="Total"
            value={String(stats?.total ?? 0)}
            icon={<FileText size={20} />}
          />
        </div>

        {/* Upload Zone */}
        {showUpload && (
          <div
            {...getRootProps()}
            className={cn(
              'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50 bg-surface'
            )}
          >
            <input {...getInputProps()} />
            {uploadMutation.isPending ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 size={32} className="animate-spin text-primary" />
                <p className="text-text-muted text-sm">Upload en cours...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload size={32} className="text-text-muted" />
                <p className="text-text font-medium">
                  {isDragActive ? 'Déposez vos fichiers ici' : 'Glissez vos PDF ici ou cliquez'}
                </p>
                <p className="text-text-muted text-xs">Formats acceptés : PDF (max 10 Mo par fichier)</p>
              </div>
            )}

            {/* Upload results */}
            {uploadMutation.isSuccess && uploadMutation.data && (
              <div className="mt-4 space-y-1" onClick={e => e.stopPropagation()}>
                {uploadMutation.data.map((r, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-2 text-xs px-3 py-1.5 rounded',
                      r.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    )}
                  >
                    {r.success ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                    <span>{r.original_name}</span>
                    {r.error && <span className="text-red-400">— {r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Year filter */}
          <select
            value={year ?? ''}
            onChange={e => setYear(e.target.value ? Number(e.target.value) : null)}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
          >
            <option value="">Année</option>
            {years.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
            {years.length === 0 && <option value="2024">2024</option>}
          </select>

          {/* Month filter */}
          <select
            value={month ?? ''}
            onChange={e => setMonth(e.target.value ? Number(e.target.value) : null)}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
          >
            <option value="">Mois</option>
            {MOIS_FR.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={`${sortBy}_${sortOrder}`}
            onChange={e => {
              const [by, order] = e.target.value.split('_') as [SortBy, 'asc' | 'desc']
              setSortBy(by)
              setSortOrder(order)
            }}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
          >
            <option value="date_desc">Date (récent)</option>
            <option value="date_asc">Date (ancien)</option>
            <option value="name_asc">Nom (A-Z)</option>
            <option value="name_desc">Nom (Z-A)</option>
            <option value="size_desc">Taille (grand)</option>
            <option value="size_asc">Taille (petit)</option>
          </select>

          {/* Status tabs */}
          <div className="flex bg-background rounded-lg border border-border overflow-hidden">
            {([
              ['all', 'Tous'],
              ['en_attente', 'En attente'],
              ['traites', 'Traités'],
            ] as [StatusFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'px-3 py-2 text-xs transition-colors',
                  statusFilter === value
                    ? 'bg-primary text-white'
                    : 'text-text-muted hover:text-text'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Gallery */}
        {isLoading ? (
          <LoadingSpinner text="Chargement des justificatifs..." />
        ) : !justificatifs || justificatifs.length === 0 ? (
          <div className="bg-surface rounded-xl border border-border p-12 text-center">
            <FileText size={40} className="mx-auto text-text-muted mb-3" />
            <p className="text-text-muted">Aucun justificatif trouvé</p>
            {!showUpload && (
              <button
                onClick={() => setShowUpload(true)}
                className="mt-3 text-primary text-sm hover:underline"
              >
                Uploader des justificatifs
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {justificatifs.map(j => (
              <div
                key={j.filename}
                className="bg-surface rounded-xl border border-border p-4 hover:border-primary/50 transition-colors group"
              >
                {/* Icon + Status */}
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileText size={20} className="text-primary" />
                  </div>
                  <span className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-medium',
                    j.status === 'traites'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-amber-500/15 text-amber-400'
                  )}>
                    {j.status === 'traites' ? 'Traité' : 'En attente'}
                  </span>
                </div>

                {/* Name */}
                <p className="text-sm font-medium text-text truncate mb-1" title={j.original_name}>
                  {j.original_name}
                </p>

                {/* Metadata */}
                <div className="flex items-center gap-2 text-xs text-text-muted mb-3">
                  <span>{j.date.slice(0, 10)}</span>
                  <span>·</span>
                  <span>{j.size_human}</span>
                </div>

                {/* Linked operation */}
                {j.linked_operation && (
                  <p className="text-[10px] text-primary truncate mb-2" title={j.linked_operation}>
                    Lié : {j.linked_operation}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleView(j)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-primary/10 text-primary rounded-lg text-xs hover:bg-primary/20 transition-colors"
                  >
                    <Eye size={12} />
                    Voir
                  </button>
                  {deleteConfirm === j.filename ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleDelete(j.filename)}
                        className="px-2 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs hover:bg-red-500/30"
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Oui'}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="px-2 py-1.5 bg-surface-hover text-text-muted rounded-lg text-xs"
                      >
                        Non
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(j.filename)}
                      className="flex items-center justify-center px-2 py-1.5 text-text-muted hover:text-red-400 rounded-lg text-xs transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drawer */}
      <JustificatifDrawer
        open={drawerOpen}
        justificatif={selectedJustificatif}
        onClose={() => {
          setDrawerOpen(false)
          setSelectedJustificatif(null)
        }}
        onDeleted={() => {
          setDrawerOpen(false)
          setSelectedJustificatif(null)
        }}
      />
    </div>
  )
}
