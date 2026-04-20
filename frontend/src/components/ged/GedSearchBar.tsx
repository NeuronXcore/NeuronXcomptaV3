import { useEffect, useState } from 'react'
import { Search, X, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GedFilters } from '@/types'

interface GedSearchBarProps {
  filters: GedFilters
  onChange: (filters: GedFilters) => void
  categories: string[]
  subcategories: string[]
  fournisseurs: string[]
  resultCount: number
  isLoading?: boolean
}

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Tous les types' },
  { value: 'justificatif', label: 'Justificatifs' },
  { value: 'releve', label: 'Relevés' },
  { value: 'rapport', label: 'Rapports' },
  { value: 'document_libre', label: 'Documents libres' },
  { value: 'liasse_fiscale_scp', label: 'Liasses fiscales SCP' },
]

const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

const CHIP_COLORS = {
  search: 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]',
  montant: 'bg-[#FAEEDA] text-[#854F0B] border-[#FAC775]',
  type: 'bg-[#EEEDFE] text-[#3C3489] border-[#CECBF6]',
  categorie: 'bg-[#E6F1FB] text-[#185FA5] border-[#B5D4F4]',
  periode: 'bg-[#EAF3DE] text-[#3B6D11] border-[#C0DD97]',
} as const

type ChipColor = keyof typeof CHIP_COLORS

function Chip({
  color,
  label,
  onClear,
}: {
  color: ChipColor
  label: string
  onClear: () => void
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full text-xs border',
        CHIP_COLORS[color],
      )}
    >
      <span className="leading-none">{label}</span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center justify-center hover:opacity-70"
        aria-label={`Supprimer filtre ${label}`}
      >
        <X size={10} />
      </button>
    </span>
  )
}

function typeLabel(value: string): string {
  return TYPE_OPTIONS.find(o => o.value === value)?.label ?? value
}

function buildMontantLabel(filters: GedFilters): string {
  const min = filters.montant_min
  const max = filters.montant_max
  const fmt = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')
  if (min !== undefined && max !== undefined) return `${fmt(min)} – ${fmt(max)} €`
  if (min !== undefined) return `≥ ${fmt(min)} €`
  if (max !== undefined) return `≤ ${fmt(max)} €`
  return ''
}

function buildPeriodeLabel(filters: GedFilters): string {
  if (filters.month && filters.year) return `${MOIS[filters.month - 1]} ${filters.year}`
  if (filters.year) return String(filters.year)
  if (filters.month) return MOIS[filters.month - 1]
  return ''
}

function hasActiveFilters(f: GedFilters): boolean {
  return !!(
    f.search ||
    f.montant_min !== undefined ||
    f.montant_max !== undefined ||
    f.type ||
    f.categorie ||
    f.sous_categorie ||
    f.fournisseur ||
    f.year ||
    f.month ||
    f.quarter ||
    f.favorite !== undefined
  )
}

function hasAdvancedFilters(f: GedFilters): boolean {
  return !!(
    f.type ||
    f.categorie ||
    f.sous_categorie ||
    f.fournisseur ||
    f.year ||
    f.month ||
    f.quarter
  )
}

export default function GedSearchBar({
  filters,
  onChange,
  categories,
  subcategories,
  fournisseurs,
  resultCount,
  isLoading,
}: GedSearchBarProps) {
  const [searchInput, setSearchInput] = useState(filters.search ?? '')
  const [montantMinInput, setMontantMinInput] = useState(
    filters.montant_min !== undefined ? String(filters.montant_min) : '',
  )
  const [montantMaxInput, setMontantMaxInput] = useState(
    filters.montant_max !== undefined ? String(filters.montant_max) : '',
  )
  const [showAdvanced, setShowAdvanced] = useState(() => hasAdvancedFilters(filters))

  // Debounce search 250ms
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (filters.search ?? '')) {
        const next = { ...filters }
        if (searchInput) next.search = searchInput
        else delete next.search
        onChange(next)
      }
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  // Sync externe → local (clic arbre, reset, URL params)
  useEffect(() => {
    setSearchInput(filters.search ?? '')
  }, [filters.search])
  useEffect(() => {
    setMontantMinInput(filters.montant_min !== undefined ? String(filters.montant_min) : '')
  }, [filters.montant_min])
  useEffect(() => {
    setMontantMaxInput(filters.montant_max !== undefined ? String(filters.montant_max) : '')
  }, [filters.montant_max])

  // Ouvre la section avancée si un filtre avancé devient actif
  useEffect(() => {
    if (hasAdvancedFilters(filters)) {
      setShowAdvanced(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.type, filters.categorie, filters.sous_categorie, filters.fournisseur, filters.year, filters.month, filters.quarter])

  const commitMontant = (key: 'montant_min' | 'montant_max', raw: string) => {
    const next = { ...filters }
    const trimmed = raw.trim()
    if (trimmed === '') {
      delete next[key]
    } else {
      const parsed = parseFloat(trimmed.replace(',', '.'))
      if (Number.isNaN(parsed)) {
        delete next[key]
      } else {
        next[key] = parsed
      }
    }
    onChange(next)
  }

  const update = (key: keyof GedFilters, value: string | number | undefined) => {
    const next = { ...filters }
    if (value === undefined || value === '' || value === null) {
      delete (next as Record<string, unknown>)[key]
    } else {
      ;(next as Record<string, unknown>)[key] = value
    }
    onChange(next)
  }

  const onCategorieChange = (value: string) => {
    const next = { ...filters }
    if (value) {
      next.categorie = value
    } else {
      delete next.categorie
    }
    // cascade : reset sous-catégorie au changement de catégorie
    delete next.sous_categorie
    onChange(next)
  }

  const clearCatAndSubcat = () => {
    const next = { ...filters }
    delete next.categorie
    delete next.sous_categorie
    onChange(next)
  }

  const clearMontant = () => {
    const next = { ...filters }
    delete next.montant_min
    delete next.montant_max
    onChange(next)
  }

  const clearPeriode = () => {
    const next = { ...filters }
    delete next.year
    delete next.month
    delete next.quarter
    onChange(next)
  }

  const resetAll = () => {
    setSearchInput('')
    setMontantMinInput('')
    setMontantMaxInput('')
    onChange({})
  }

  const hasActive = hasActiveFilters(filters)
  const hasAdvanced = hasAdvancedFilters(filters)

  const currentYear = new Date().getFullYear()
  const years = [currentYear - 2, currentYear - 1, currentYear]

  const selectClass =
    'text-xs border border-border rounded-md px-2 py-1.5 bg-background text-text max-w-[180px] disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div>
      <div className="bg-background border border-border rounded-lg px-3.5 py-3">
        {/* Ligne principale */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Fournisseur, nom de fichier, contenu OCR…"
              className="w-full pl-8 pr-2 py-1.5 text-sm border border-border rounded-md bg-surface text-text placeholder:text-text-muted"
              aria-label="Recherche libre"
            />
          </div>

          <div className="w-px h-6 bg-border shrink-0" />

          <label className="text-xs text-text-muted shrink-0">Montant</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={montantMinInput}
            onChange={e => setMontantMinInput(e.target.value)}
            onBlur={() => commitMontant('montant_min', montantMinInput)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitMontant('montant_min', montantMinInput)
              }
            }}
            placeholder="min"
            aria-label="Montant minimum"
            className="w-[72px] text-xs border border-border rounded-md px-2 py-1.5 bg-surface text-text placeholder:text-text-muted"
          />
          <span className="text-xs text-text-muted shrink-0">–</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={montantMaxInput}
            onChange={e => setMontantMaxInput(e.target.value)}
            onBlur={() => commitMontant('montant_max', montantMaxInput)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitMontant('montant_max', montantMaxInput)
              }
            }}
            placeholder="max"
            aria-label="Montant maximum"
            className="w-[72px] text-xs border border-border rounded-md px-2 py-1.5 bg-surface text-text placeholder:text-text-muted"
          />
          <span className="text-xs text-text-muted shrink-0">€</span>

          <div className="w-px h-6 bg-border shrink-0" />

          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className={cn(
              'p-2 rounded-md transition-colors shrink-0',
              hasAdvanced
                ? 'text-[#378ADD] bg-[#378ADD]/10 hover:bg-[#378ADD]/15'
                : 'text-text-muted hover:bg-surface-hover hover:text-text',
            )}
            aria-expanded={showAdvanced}
            aria-label="Filtres avancés"
          >
            <Filter size={16} />
          </button>
        </div>

        {/* Ligne filtres avancés */}
        {showAdvanced && (
          <div className="flex items-center gap-2 flex-wrap mt-2.5 pt-2.5 border-t border-border">
            <label className="text-xs text-text-muted shrink-0">Type</label>
            <select
              value={filters.type ?? ''}
              onChange={e => update('type', e.target.value || undefined)}
              className={cn(
                selectClass,
                filters.type && 'border-primary text-primary',
              )}
            >
              {TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              value={filters.categorie ?? ''}
              onChange={e => onCategorieChange(e.target.value)}
              className={cn(
                selectClass,
                filters.categorie && 'border-primary text-primary',
              )}
            >
              <option value="">Catégorie</option>
              {categories.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={filters.sous_categorie ?? ''}
              onChange={e => update('sous_categorie', e.target.value || undefined)}
              disabled={!filters.categorie}
              className={cn(
                selectClass,
                filters.sous_categorie && 'border-primary text-primary',
              )}
            >
              <option value="">Sous-catégorie</option>
              {subcategories.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {fournisseurs.length > 0 && (
              <select
                value={filters.fournisseur ?? ''}
                onChange={e => update('fournisseur', e.target.value || undefined)}
                className={cn(
                  selectClass,
                  filters.fournisseur && 'border-primary text-primary',
                )}
              >
                <option value="">Fournisseur</option>
                {fournisseurs.map(f => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}

            <div className="w-px h-6 bg-border shrink-0" />

            <label className="text-xs text-text-muted shrink-0">Période</label>
            <select
              value={filters.year ?? ''}
              onChange={e =>
                update('year', e.target.value ? parseInt(e.target.value, 10) : undefined)
              }
              className={cn(
                selectClass,
                filters.year && 'border-primary text-primary',
              )}
            >
              <option value="">Année</option>
              {years.map(y => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              value={filters.month ?? ''}
              onChange={e =>
                update('month', e.target.value ? parseInt(e.target.value, 10) : undefined)
              }
              className={cn(
                selectClass,
                filters.month && 'border-primary text-primary',
              )}
            >
              <option value="">Mois</option>
              {MOIS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>

            <div className="flex-1 min-w-[8px]" />

            {hasActive && (
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text px-2 py-1.5 rounded-md hover:bg-surface-hover"
              >
                <X size={12} />
                Réinitialiser
              </button>
            )}
          </div>
        )}

        {/* Ligne chips actifs */}
        {hasActive && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span className="text-xs text-text-muted">Filtres actifs :</span>
            {filters.search && (
              <Chip
                color="search"
                label={`"${filters.search}"`}
                onClear={() => update('search', undefined)}
              />
            )}
            {(filters.montant_min !== undefined || filters.montant_max !== undefined) && (
              <Chip
                color="montant"
                label={buildMontantLabel(filters)}
                onClear={clearMontant}
              />
            )}
            {filters.type && (
              <Chip
                color="type"
                label={typeLabel(filters.type)}
                onClear={() => update('type', undefined)}
              />
            )}
            {filters.categorie && (
              <Chip
                color="categorie"
                label={filters.categorie}
                onClear={clearCatAndSubcat}
              />
            )}
            {filters.sous_categorie && (
              <Chip
                color="categorie"
                label={filters.sous_categorie}
                onClear={() => update('sous_categorie', undefined)}
              />
            )}
            {filters.fournisseur && (
              <Chip
                color="categorie"
                label={filters.fournisseur}
                onClear={() => update('fournisseur', undefined)}
              />
            )}
            {(filters.year || filters.month) && (
              <Chip
                color="periode"
                label={buildPeriodeLabel(filters)}
                onClear={clearPeriode}
              />
            )}
          </div>
        )}
      </div>

      {/* Compteur résultats — hors du bloc blanc */}
      <p className="text-[13px] text-text-muted mb-2.5 mt-1.5">
        {isLoading ? (
          <span>Chargement des documents…</span>
        ) : (
          <>
            <span className="font-medium text-text">
              {resultCount} document{resultCount !== 1 ? 's' : ''}
            </span>
            {hasActive ? ' correspondent aux filtres' : ' dans la bibliothèque'}
          </>
        )}
      </p>
    </div>
  )
}
