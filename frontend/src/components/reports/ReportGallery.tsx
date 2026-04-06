import { useState, useMemo } from 'react'
import {
  Eye, Trash2, FileText, Sheet, Table2, Search, Loader2, Star,
  Calendar, Tag, Download, ExternalLink, Check, Minus, Send,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn, formatCurrency } from '@/lib/utils'
import { useReportsGallery, useReportTree, useDeleteReport, useToggleFavorite, useOpenReportNative, useDeleteAllReports } from '@/hooks/useReports'
import GedTree from '@/components/ged/GedTree'
import type { ReportMetadata, GedTreeNode } from '@/types'

type TreeMode = 'by_year' | 'by_category'

interface ReportGalleryProps {
  onPreview: (report: ReportMetadata) => void
  onSwitchToGenerate: () => void
  selectedReports: string[]
  onToggleSelect: (filename: string) => void
  onSelectAll: (filenames: string[]) => void
  onClearSelection: () => void
  onExportZip: () => void
  isExporting?: boolean
}

const FORMAT_CONFIG: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  pdf: { icon: FileText, color: 'text-red-400', label: 'PDF' },
  csv: { icon: Sheet, color: 'text-green-400', label: 'CSV' },
  excel: { icon: Table2, color: 'text-emerald-400', label: 'Excel' },
}

export default function ReportGallery({
  onPreview, onSwitchToGenerate, selectedReports, onToggleSelect,
  onSelectAll, onClearSelection, onExportZip, isExporting,
}: ReportGalleryProps) {
  const { data: gallery, isLoading } = useReportsGallery()
  const { data: treeData } = useReportTree()
  const deleteMutation = useDeleteReport()
  const favMutation = useToggleFavorite()
  const openNativeMutation = useOpenReportNative()
  const deleteAllMutation = useDeleteAllReports()
  const [treeMode, setTreeMode] = useState<TreeMode>('by_year')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const activeTree = treeData ? treeData[treeMode] ?? [] : []

  // Filter reports based on selected tree node
  const filteredReports = useMemo(() => {
    let result = gallery?.reports ?? []

    // Favorites first
    result = [...result].sort((a, b) => {
      if (a.favorite && !b.favorite) return -1
      if (!a.favorite && b.favorite) return 1
      return 0
    })

    // Tree node filter
    if (selectedNode) {
      if (selectedNode.startsWith('year-')) {
        const parts = selectedNode.replace('year-', '').split('-')
        const y = parseInt(parts[0])
        if (!isNaN(y)) result = result.filter(r => r.year === y)
        if (parts[1]) {
          const m = parseInt(parts[1])
          if (!isNaN(m) && m > 0) result = result.filter(r => r.month === m)
        }
      } else if (selectedNode.startsWith('cat-')) {
        const cat = selectedNode.replace('cat-', '')
        if (cat === 'none') {
          result = result.filter(r => !r.filters?.categories?.length)
        } else {
          result = result.filter(r => r.filters?.categories?.includes(cat))
        }
      }
    }

    // Search
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      result = result.filter(r => r.title.toLowerCase().includes(q))
    }

    return result
  }, [gallery, selectedNode, searchTerm])

  const allFilenames = filteredReports.map(r => r.filename)
  const allSelected = allFilenames.length > 0 && allFilenames.every(f => selectedReports.includes(f))
  const someSelected = selectedReports.length > 0 && !allSelected

  if (isLoading) return <div className="text-center py-12 text-text-muted">Chargement...</div>

  if (!gallery?.reports.length) {
    return (
      <div className="text-center py-16">
        <FileText size={40} className="mx-auto text-text-muted mb-3" />
        <p className="text-text-muted mb-4">Aucun rapport généré</p>
        <button onClick={onSwitchToGenerate}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90">
          Générer un rapport
        </button>
      </div>
    )
  }

  return (
    <div className="flex" style={{ height: 'calc(100vh - 260px)' }}>
      {/* Left panel: tree */}
      <div className="w-[240px] shrink-0 border-r border-border flex flex-col">
        {/* Tree mode tabs — date / category only */}
        <div className="flex border-b border-border">
          {([
            { key: 'by_year' as TreeMode, label: 'Par date', icon: Calendar },
            { key: 'by_category' as TreeMode, label: 'Par catégorie', icon: Tag },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setTreeMode(tab.key); setSelectedNode(null) }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] font-medium transition-colors',
                treeMode === tab.key
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text'
              )}
            >
              <tab.icon size={12} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Rechercher..."
              className="w-full bg-surface border border-border rounded-lg pl-7 pr-3 py-1.5 text-[11px] text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto p-2">
          <button
            onClick={() => setSelectedNode(null)}
            className={cn(
              'w-full text-left px-2 py-1.5 rounded-md text-xs mb-1 transition-colors',
              !selectedNode ? 'bg-primary/10 text-primary font-medium' : 'text-text-muted hover:text-text'
            )}
          >
            Tous ({gallery.total_count})
          </button>
          <GedTree tree={activeTree} selectedNode={selectedNode} onSelect={n => setSelectedNode(n === selectedNode ? null : n)} />
        </div>
      </div>

      {/* Right panel: reports grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Toolbar: select all + count + export button */}
        <div className="flex items-center gap-3 mb-3">
          {/* Select all checkbox */}
          <button
            onClick={() => allSelected ? onClearSelection() : onSelectAll(allFilenames)}
            className={cn(
              'w-[20px] h-[20px] rounded flex items-center justify-center transition-all duration-150 border-2 shrink-0',
              allSelected
                ? 'bg-primary border-transparent shadow-sm'
                : someSelected
                  ? 'bg-primary/40 border-transparent shadow-sm'
                  : 'bg-surface border-text-muted/30 hover:border-primary/50'
            )}
          >
            {allSelected && <Check size={13} className="text-white drop-shadow-sm" />}
            {someSelected && <Minus size={13} className="text-white drop-shadow-sm" />}
          </button>

          <p className="text-xs text-text-muted flex-1">
            {selectedReports.length > 0
              ? `${selectedReports.length} sélectionné${selectedReports.length > 1 ? 's' : ''} sur ${filteredReports.length}`
              : `${filteredReports.length} rapport${filteredReports.length !== 1 ? 's' : ''}`
            }
          </p>

          {/* Export to accountant button */}
          {selectedReports.length > 0 && (
            <button
              onClick={onExportZip}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isExporting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Exporter pour le comptable ({selectedReports.length})
            </button>
          )}

          {/* Delete all */}
          <button
            onClick={() => {
              toast((t) => (
                <div className="flex flex-col items-center gap-3 py-1">
                  <p className="text-sm font-medium text-center">
                    Supprimer les {gallery?.total_count ?? 0} rapports ?
                  </p>
                  <p className="text-xs text-gray-500 text-center">Cette action est irréversible</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { toast.dismiss(t.id); deleteAllMutation.mutate(undefined, { onSuccess: () => onClearSelection() }) }}
                      className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600"
                    >
                      Supprimer tout
                    </button>
                    <button
                      onClick={() => toast.dismiss(t.id)}
                      className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-300"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ), { duration: 10000, position: 'top-center' })
            }}
            disabled={deleteAllMutation.isPending || !gallery?.total_count}
            className="flex items-center gap-1.5 ml-auto text-red-400/70 hover:text-red-400 text-xs transition-colors disabled:opacity-30"
          >
            <Trash2 size={13} />
            Tout supprimer
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredReports.map(r => {
            const fmtConfig = FORMAT_CONFIG[r.format] || FORMAT_CONFIG.pdf
            const FormatIcon = fmtConfig.icon
            const mainAmount = r.total_debit > 0 ? r.total_debit : r.total_credit
            const isSelected = selectedReports.includes(r.filename)

            return (
              <div
                key={r.filename}
                className={cn(
                  'bg-surface border rounded-lg p-3 transition-colors relative',
                  r.favorite ? 'border-amber-500/30' : 'border-border',
                  isSelected && 'ring-2 ring-primary border-primary/50',
                  'hover:border-primary/50'
                )}
              >
                {/* Modern checkbox */}
                <div className="absolute top-2.5 left-2.5">
                  <button
                    onClick={() => onToggleSelect(r.filename)}
                    className={cn(
                      'w-[18px] h-[18px] rounded flex items-center justify-center transition-all duration-150 border-2',
                      isSelected
                        ? 'bg-primary border-transparent shadow-sm'
                        : 'bg-surface border-text-muted/30 hover:border-primary/50'
                    )}
                  >
                    {isSelected && <Check size={12} className="text-white drop-shadow-sm" />}
                  </button>
                </div>

                {/* Header */}
                <div className="flex items-start justify-between mb-2 pl-6">
                  <FormatIcon size={16} className={fmtConfig.color} />
                  <button
                    onClick={e => { e.stopPropagation(); favMutation.mutate(r.filename) }}
                    className="p-0.5"
                  >
                    <Star size={14} className={r.favorite ? 'fill-amber-400 text-amber-400' : 'text-text-muted/40 hover:text-amber-400'} />
                  </button>
                </div>

                {/* Title */}
                <p className="text-xs font-medium text-text line-clamp-2 mb-2 min-h-[32px] cursor-pointer"
                   onClick={() => onPreview(r)}>
                  {r.title}
                </p>

                {/* Metrics */}
                <div className="space-y-0.5 text-[10px] text-text-muted mb-2">
                  <p>{r.nb_operations} ops</p>
                  {mainAmount > 0 && <p className="text-text">{formatCurrency(mainAmount)}</p>}
                  <p>{r.file_size_human}</p>
                </div>

                {/* Date */}
                <p className="text-[10px] text-text-muted mb-2">
                  {new Date(r.generated_at).toLocaleDateString('fr-FR')}
                </p>

                {/* Actions */}
                <div className="flex gap-1.5 pt-1 border-t border-border">
                  <button onClick={() => onPreview(r)}
                    className="flex-1 flex items-center justify-center py-1.5 text-[10px] text-text-muted hover:text-primary"
                    title="Aperçu">
                    <Eye size={12} />
                  </button>
                  <button onClick={() => openNativeMutation.mutate(r.filename)}
                    className="flex-1 flex items-center justify-center py-1.5 text-[10px] text-text-muted hover:text-blue-400"
                    title={r.format === 'pdf' ? 'Ouvrir dans Aperçu' : r.format === 'csv' ? 'Ouvrir dans Numbers' : 'Ouvrir dans Excel'}>
                    <ExternalLink size={12} />
                  </button>
                  <button onClick={() => window.open(`/api/reports/download/${r.filename}`)}
                    className="flex-1 flex items-center justify-center py-1.5 text-[10px] text-text-muted hover:text-emerald-400"
                    title="Télécharger">
                    <Download size={12} />
                  </button>
                  <button
                    onClick={() => {
                      toast((t) => (
                        <div className="flex flex-col items-center gap-3 py-1">
                          <p className="text-sm font-medium text-center">Supprimer ce rapport ?</p>
                          <p className="text-xs text-gray-500 text-center truncate max-w-[280px]">{r.title}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => { toast.dismiss(t.id); deleteMutation.mutate(r.filename) }}
                              className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600"
                            >
                              Supprimer
                            </button>
                            <button
                              onClick={() => toast.dismiss(t.id)}
                              className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-300"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      ), { duration: 10000, position: 'top-center' })
                    }}
                    className="flex-1 flex items-center justify-center py-1.5 text-[10px] text-text-muted hover:text-red-400"
                  >
                    {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
