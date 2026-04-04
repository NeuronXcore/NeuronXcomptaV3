import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { useGedSearch } from '@/hooks/useGed'

interface GedSearchBarProps {
  onSearch: (query: string) => void
  onSelect: (docId: string) => void
}

export default function GedSearchBar({ onSearch, onSelect }: GedSearchBarProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
      onSearch(query)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, onSearch])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const { data: results } = useGedSearch(debouncedQuery)

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setShowDropdown(true) }}
          onFocus={() => setShowDropdown(true)}
          placeholder="Rechercher..."
          className="w-full bg-surface border border-border rounded-lg pl-8 pr-7 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); onSearch('') }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {showDropdown && results && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg z-30 max-h-64 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.doc_id}
              onClick={() => { onSelect(r.doc_id); setShowDropdown(false) }}
              className="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors border-b border-border last:border-0"
            >
              <p className="text-xs text-text truncate">{r.document.original_name || r.doc_id.split('/').pop()}</p>
              {r.match_context && (
                <p className="text-[10px] text-text-muted truncate mt-0.5">{r.match_context}</p>
              )}
              <span className="text-[10px] text-primary">{r.document.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
