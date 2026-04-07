import { Search, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { GedFilters, GedStats } from '@/types'

interface GedFilterBarProps {
  filters: GedFilters
  onFiltersChange: (filters: GedFilters) => void
  stats?: GedStats
}

export default function GedFilterBar({ filters, onFiltersChange, stats }: GedFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filters.search || '')

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (filters.search || '')) {
        onFiltersChange({ ...filters, search: searchInput || undefined })
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Sync external filter changes to search input
  useEffect(() => {
    setSearchInput(filters.search || '')
  }, [filters.search])

  const hasActiveFilters = !!(
    filters.type || filters.year || filters.quarter || filters.categorie ||
    filters.fournisseur || filters.format_type || filters.favorite !== undefined ||
    filters.search
  )

  const reset = () => {
    setSearchInput('')
    onFiltersChange({})
  }

  const updateFilter = (key: keyof GedFilters, value: string | undefined) => {
    const next = { ...filters }
    if (value) {
      (next as any)[key] = key === 'year' || key === 'quarter' ? parseInt(value) : value
    } else {
      delete (next as any)[key]
    }
    onFiltersChange(next)
  }

  const categories = stats?.par_categorie || []
  const fournisseurs = stats?.par_fournisseur || []

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface/30 flex-wrap">
      {/* Type */}
      <select
        value={filters.type || ''}
        onChange={e => updateFilter('type', e.target.value || undefined)}
        className={cn(
          'text-xs border border-border rounded-md px-2 py-1.5 bg-background text-text',
          filters.type && 'border-primary text-primary'
        )}
      >
        <option value="">Tous types</option>
        <option value="releve">Relevés</option>
        <option value="justificatif">Justificatifs</option>
        <option value="rapport">Rapports</option>
        <option value="document_libre">Documents libres</option>
      </select>

      {/* Catégorie */}
      <select
        value={filters.categorie || ''}
        onChange={e => updateFilter('categorie', e.target.value || undefined)}
        className={cn(
          'text-xs border border-border rounded-md px-2 py-1.5 bg-background text-text max-w-[180px]',
          filters.categorie && 'border-primary text-primary'
        )}
      >
        <option value="">Catégorie</option>
        {categories.map(c => (
          <option key={c.categorie} value={c.categorie}>
            {c.categorie} ({c.count})
          </option>
        ))}
      </select>

      {/* Fournisseur */}
      <select
        value={filters.fournisseur || ''}
        onChange={e => updateFilter('fournisseur', e.target.value || undefined)}
        className={cn(
          'text-xs border border-border rounded-md px-2 py-1.5 bg-background text-text max-w-[180px]',
          filters.fournisseur && 'border-primary text-primary'
        )}
      >
        <option value="">Fournisseur</option>
        {fournisseurs.map(f => (
          <option key={f.fournisseur} value={f.fournisseur}>
            {f.fournisseur} ({f.count})
          </option>
        ))}
      </select>

      {/* Search */}
      <div className="relative flex-1 min-w-[150px] max-w-[250px]">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Rechercher..."
          className="w-full pl-7 pr-2 py-1.5 text-xs border border-border rounded-md bg-background text-text placeholder:text-text-muted"
        />
      </div>

      {/* Reset */}
      {hasActiveFilters && (
        <button
          onClick={reset}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text px-2 py-1.5 rounded-md hover:bg-surface"
        >
          <X size={12} />
          Réinitialiser
        </button>
      )}
    </div>
  )
}
