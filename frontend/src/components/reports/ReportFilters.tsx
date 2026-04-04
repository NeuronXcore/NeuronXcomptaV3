import { useMemo } from 'react'
import { FileText, PieChart, Shield, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCategories } from '@/hooks/useApi'
import { useReportTemplates } from '@/hooks/useReports'
import type { ReportFiltersV2, ReportTemplate } from '@/types'

interface ReportFiltersProps {
  filters: ReportFiltersV2
  onFiltersChange: (f: ReportFiltersV2) => void
  format: 'pdf' | 'csv' | 'excel'
  onFormatChange: (f: 'pdf' | 'csv' | 'excel') => void
  onGenerate: () => void
  isGenerating: boolean
  onTemplateSelect: (t: ReportTemplate) => void
}

const ICON_MAP: Record<string, typeof FileText> = { FileText, PieChart, Shield }

export default function ReportFilters({
  filters, onFiltersChange, format, onFormatChange,
  onGenerate, isGenerating, onTemplateSelect,
}: ReportFiltersProps) {
  const { data: categoriesData } = useCategories()
  const { data: templates } = useReportTemplates()
  const categories = categoriesData?.categories ?? []

  const subcategories = useMemo(() => {
    if (!filters.categories?.length) return []
    return categories
      .filter(c => filters.categories!.includes(c.name))
      .flatMap(c => c.subcategories.map(s => s.name))
  }, [filters.categories, categories])

  const updateFilter = (key: string, value: unknown) => {
    onFiltersChange({ ...filters, [key]: value || undefined })
  }

  const reset = () => {
    onFiltersChange({ year: new Date().getFullYear() })
    onFormatChange('pdf')
  }

  return (
    <div className="space-y-5">
      {/* Templates */}
      {templates && templates.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-text-muted uppercase mb-2">Templates rapides</h4>
          <div className="grid grid-cols-3 gap-2">
            {templates.map(t => {
              const Icon = ICON_MAP[t.icon] || FileText
              return (
                <button
                  key={t.id}
                  onClick={() => onTemplateSelect(t)}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface hover:border-primary/50 transition-colors text-left"
                >
                  <Icon size={18} className="text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-text">{t.label}</p>
                    <p className="text-[10px] text-text-muted">{t.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
        <h4 className="text-xs font-semibold text-text-muted uppercase">Filtres</h4>

        {/* Period */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Année</label>
            <select
              value={filters.year || ''}
              onChange={e => updateFilter('year', e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
            >
              <option value="">Toutes</option>
              {[2026, 2025, 2024, 2023].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Trimestre</label>
            <select
              value={filters.quarter || ''}
              onChange={e => updateFilter('quarter', e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
            >
              <option value="">Tous</option>
              {[1, 2, 3, 4].map(q => <option key={q} value={q}>T{q}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Mois</label>
            <select
              value={filters.month || ''}
              onChange={e => updateFilter('month', e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
            >
              <option value="">Tous</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2024, i).toLocaleDateString('fr-FR', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Categories */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Catégories</label>
            <select
              multiple
              value={filters.categories || []}
              onChange={e => {
                const selected = Array.from(e.target.selectedOptions, o => o.value)
                updateFilter('categories', selected.length ? selected : undefined)
              }}
              className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary h-20"
            >
              {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Sous-catégories</label>
            <select
              multiple
              value={filters.subcategories || []}
              onChange={e => {
                const selected = Array.from(e.target.selectedOptions, o => o.value)
                updateFilter('subcategories', selected.length ? selected : undefined)
              }}
              disabled={subcategories.length === 0}
              className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary h-20 disabled:opacity-50"
            >
              {subcategories.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Type + Amount */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Type</label>
            <div className="flex gap-1.5">
              {(['all', 'debit', 'credit'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => updateFilter('type', t === 'all' ? undefined : t)}
                  className={cn(
                    'flex-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
                    (filters.type || 'all') === t
                      ? 'bg-primary text-white'
                      : 'bg-background text-text-muted hover:text-text'
                  )}
                >
                  {t === 'all' ? 'Tout' : t === 'debit' ? 'Dépenses' : 'Recettes'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Montant min</label>
            <input
              type="number"
              value={filters.min_amount || ''}
              onChange={e => updateFilter('min_amount', e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              placeholder="0"
            />
          </div>
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Montant max</label>
            <input
              type="number"
              value={filters.max_amount || ''}
              onChange={e => updateFilter('max_amount', e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              placeholder="∞"
            />
          </div>
        </div>

        {/* Format */}
        <div>
          <label className="text-[10px] text-text-muted block mb-1">Format de sortie</label>
          <div className="flex gap-2">
            {(['pdf', 'csv', 'excel'] as const).map(f => (
              <button
                key={f}
                onClick={() => onFormatChange(f)}
                className={cn(
                  'flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors border',
                  format === f
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'bg-background border-border text-text-muted hover:text-text'
                )}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button onClick={reset} className="flex items-center gap-1.5 text-[10px] text-text-muted hover:text-text">
            <RotateCcw size={12} /> Réinitialiser
          </button>
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            className="px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {isGenerating ? 'Génération...' : 'Générer le rapport'}
          </button>
        </div>
      </div>
    </div>
  )
}
