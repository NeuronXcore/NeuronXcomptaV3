import { useState, useMemo } from 'react'
import { Eye, Trash2, FileText, Sheet, Table2, Search, Loader2, Star, Calendar, Tag, Download } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { useReportsGallery, useReportTree, useDeleteReport, useToggleFavorite } from '@/hooks/useReports'
import GedTree from '@/components/ged/GedTree'
import type { ReportMetadata, GedTreeNode } from '@/types'

type TreeMode = 'by_year' | 'by_category' | 'by_format'

interface ReportGalleryProps {
  onPreview: (report: ReportMetadata) => void
  onSwitchToGenerate: () => void
  selectedForCompare: string[]
  onToggleCompareSelect: (filename: string) => void
}

const FORMAT_CONFIG: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  pdf: { icon: FileText, color: 'text-red-400', label: 'PDF' },
  csv: { icon: Sheet, color: 'text-green-400', label: 'CSV' },
  excel: { icon: Table2, color: 'text-emerald-400', label: 'Excel' },
}

export default function ReportGallery({ onPreview, onSwitchToGenerate, selectedForCompare, onToggleCompareSelect }: ReportGalleryProps) {
  const { data: gallery, isLoading } = useReportsGallery()
  const { data: treeData } = useReportTree()
  const deleteMutation = useDeleteReport()
  const favMutation = useToggleFavorite()
  const [treeMode, setTreeMode] = useState<TreeMode>('by_year')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

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
      } else if (selectedNode.startsWith('fmt-')) {
        const fmt = selectedNode.replace('fmt-', '')
        result = result.filter(r => r.format === fmt)
      }
    }

    // Search
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      result = result.filter(r => r.title.toLowerCase().includes(q))
    }

    return result
  }, [gallery, selectedNode, searchTerm])

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
        {/* Tree mode tabs */}
        <div className="flex border-b border-border">
          {([
            { key: 'by_year' as const, label: 'Année', icon: Calendar },
            { key: 'by_category' as const, label: 'Catégorie', icon: Tag },
            { key: 'by_format' as const, label: 'Format', icon: FileText },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setTreeMode(tab.key); setSelectedNode(null) }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[10px] font-medium transition-colors',
                treeMode === tab.key
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text'
              )}
            >
              <tab.icon size={11} />
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
        <p className="text-xs text-text-muted mb-3">{filteredReports.length} rapport{filteredReports.length !== 1 ? 's' : ''}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredReports.map(r => {
            const fmtConfig = FORMAT_CONFIG[r.format] || FORMAT_CONFIG.pdf
            const FormatIcon = fmtConfig.icon
            const mainAmount = r.total_debit > 0 ? r.total_debit : r.total_credit
            const isSelected = selectedForCompare.includes(r.filename)

            return (
              <div
                key={r.filename}
                className={cn(
                  'bg-surface border rounded-lg p-3 transition-colors relative',
                  r.favorite ? 'border-amber-500/30' : 'border-border',
                  isSelected && 'ring-2 ring-primary',
                  'hover:border-primary/50'
                )}
              >
                {/* Compare checkbox */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleCompareSelect(r.filename)}
                  className="absolute top-2 left-2 rounded border-border"
                  title="Sélectionner pour comparer"
                />

                {/* Header */}
                <div className="flex items-start justify-between mb-2 pl-5">
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
                    className="flex-1 flex items-center justify-center py-1.5 text-[10px] text-text-muted hover:text-primary">
                    <Eye size={12} />
                  </button>
                  <button onClick={() => window.open(`/api/reports/download/${r.filename}`)}
                    className="flex-1 flex items-center justify-center py-1.5 text-[10px] text-text-muted hover:text-emerald-400">
                    <Download size={12} />
                  </button>
                  <button
                    onClick={() => {
                      if (deleteConfirm === r.filename) { deleteMutation.mutate(r.filename); setDeleteConfirm(null) }
                      else setDeleteConfirm(r.filename)
                    }}
                    className={cn('flex-1 flex items-center justify-center py-1.5 text-[10px]',
                      deleteConfirm === r.filename ? 'text-red-400' : 'text-text-muted hover:text-red-400')}
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
