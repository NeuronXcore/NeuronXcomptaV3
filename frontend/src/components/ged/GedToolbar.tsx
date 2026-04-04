import { LayoutGrid, List } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GedFilters } from '@/types'

interface GedToolbarProps {
  viewMode: 'grid' | 'list'
  onViewModeChange: (mode: 'grid' | 'list') => void
  filters: GedFilters
  onFiltersChange: (filters: GedFilters) => void
  totalCount: number
  totalSize: string
}

export default function GedToolbar({
  viewMode,
  onViewModeChange,
  filters,
  onFiltersChange,
  totalCount,
  totalSize,
}: GedToolbarProps) {
  return (
    <div className="flex items-center gap-3">
      {/* View toggle */}
      <div className="flex items-center bg-surface rounded-lg border border-border p-0.5">
        <button
          onClick={() => onViewModeChange('grid')}
          className={cn(
            'p-1.5 rounded transition-colors',
            viewMode === 'grid' ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text'
          )}
        >
          <LayoutGrid size={15} />
        </button>
        <button
          onClick={() => onViewModeChange('list')}
          className={cn(
            'p-1.5 rounded transition-colors',
            viewMode === 'list' ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text'
          )}
        >
          <List size={15} />
        </button>
      </div>

      {/* Sort */}
      <select
        value={filters.sort_by || 'added_at'}
        onChange={e => onFiltersChange({ ...filters, sort_by: e.target.value })}
        className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
      >
        <option value="added_at">Date ajout</option>
        <option value="original_name">Nom</option>
        <option value="type">Type</option>
      </select>

      <select
        value={filters.sort_order || 'desc'}
        onChange={e => onFiltersChange({ ...filters, sort_order: e.target.value as 'asc' | 'desc' })}
        className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
      >
        <option value="desc">Plus récent</option>
        <option value="asc">Plus ancien</option>
      </select>

      {/* Stats */}
      <span className="ml-auto text-xs text-text-muted">
        {totalCount} document{totalCount !== 1 ? 's' : ''}
        {totalSize && ` · ${totalSize}`}
      </span>
    </div>
  )
}
