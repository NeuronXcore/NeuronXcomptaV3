import { useMemo } from 'react'
import {
  FileText, PieChart, Shield, Package, TrendingDown, AlertTriangle,
  RotateCcw, Check, Minus, Loader2, Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCategories } from '@/hooks/useApi'
import { useReportTemplates } from '@/hooks/useReports'
import { useGedPostes } from '@/hooks/useGed'
import type { ReportFiltersV2, ReportTemplate } from '@/types'

interface ReportFiltersProps {
  filters: ReportFiltersV2
  onFiltersChange: (f: ReportFiltersV2) => void
  format: 'pdf' | 'csv' | 'excel' | 'xlsx'
  onFormatChange: (f: 'pdf' | 'csv' | 'excel' | 'xlsx') => void
  onGenerate: () => void
  onBatchGenerate?: () => void
  isGenerating: boolean
  isBatchGenerating?: boolean
  onTemplateSelect: (t: ReportTemplate) => void
  title?: string
  autoTitle?: string
  onTitleChange?: (t: string) => void
  /** Template sélectionné — détermine si on affiche les filtres standards ou amortissements */
  selectedTemplate?: ReportTemplate
}

const ICON_MAP: Record<string, typeof FileText> = {
  FileText, PieChart, Shield, Package, TrendingDown, AlertTriangle,
}

const STATUT_LABELS: Record<string, string> = {
  all: 'Tous',
  en_cours: 'En cours',
  amorti: 'Amortis',
  sorti: 'Sortis',
}

export default function ReportFilters({
  filters, onFiltersChange, format, onFormatChange,
  onGenerate, onBatchGenerate, isGenerating, isBatchGenerating, onTemplateSelect,
  title, autoTitle, onTitleChange, selectedTemplate,
}: ReportFiltersProps) {
  const { data: categoriesData } = useCategories()
  const { data: templates } = useReportTemplates()
  const { data: postesData } = useGedPostes()
  const categories = categoriesData?.categories ?? []

  // Groupes de templates par catégorie (Standard / Amortissements / …)
  const templateGroups = useMemo(() => {
    const groups: Record<string, ReportTemplate[]> = { Standard: [] }
    for (const t of templates ?? []) {
      const cat = t.category || 'Standard'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(t)
    }
    return groups
  }, [templates])

  const isAmortissementsTemplate = (selectedTemplate?.category === 'Amortissements')
  const isCompteAttenteTemplate = (selectedTemplate?.category === "Compte d'attente")

  // Liste des postes pour dropdown dynamique (`options: 'dynamic:postes'`)
  const posteOptions = useMemo(() => {
    const list = postesData?.postes?.map(p => p.id) ?? []
    return ['all', ...list]
  }, [postesData])

  // Formats supportés par le template courant (sinon défaut PDF/CSV/Excel)
  const supportedFormats: Array<'pdf' | 'csv' | 'excel' | 'xlsx'> = useMemo(() => {
    if (selectedTemplate?.formats?.length) {
      return selectedTemplate.formats as Array<'pdf' | 'csv' | 'excel' | 'xlsx'>
    }
    return ['pdf', 'csv', 'excel']
  }, [selectedTemplate])

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

  // ── Category checkbox helpers ──
  // Ajouter les pseudo-catégories "Perso" (si pas déjà dans la liste) et "Non catégorisé"
  const PSEUDO_UNCATEGORIZED = '__non_categorise__'
  const allCatNames = useMemo(() => {
    const names = categories.map(c => c.name)
    if (!names.includes('Perso')) names.push('Perso')
    names.push(PSEUDO_UNCATEGORIZED)
    return names
  }, [categories])

  const selectedCats = filters.categories ?? []
  const allSelected = allCatNames.length > 0 && selectedCats.length === allCatNames.length
  const noneSelected = selectedCats.length === 0

  const toggleCategory = (name: string) => {
    const next = selectedCats.includes(name)
      ? selectedCats.filter(c => c !== name)
      : [...selectedCats, name]
    updateFilter('categories', next.length ? next : undefined)
  }

  const toggleAllCategories = () => {
    if (allSelected) {
      updateFilter('categories', undefined)
    } else {
      updateFilter('categories', allCatNames)
    }
  }

  // ── Subcategory checkbox helpers ──
  const selectedSubs = filters.subcategories ?? []

  const toggleSubcategory = (name: string) => {
    const next = selectedSubs.includes(name)
      ? selectedSubs.filter(s => s !== name)
      : [...selectedSubs, name]
    updateFilter('subcategories', next.length ? next : undefined)
  }

  const toggleAllSubcategories = () => {
    if (selectedSubs.length === subcategories.length) {
      updateFilter('subcategories', undefined)
    } else {
      updateFilter('subcategories', subcategories)
    }
  }

  return (
    <div className="space-y-5">
      {/* Templates groupés par catégorie */}
      {templates && templates.length > 0 && (
        <div className="space-y-3">
          {Object.entries(templateGroups).map(([groupName, groupTemplates]) => (
            groupTemplates.length === 0 ? null : (
              <div key={groupName}>
                <h4 className="text-xs font-semibold text-text-muted uppercase mb-2">
                  Templates rapides{groupName !== 'Standard' && ` · ${groupName}`}
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {groupTemplates.map(t => {
                    const Icon = ICON_MAP[t.icon] || FileText
                    const isSelected = selectedTemplate?.id === t.id
                    return (
                      <button
                        key={t.id}
                        onClick={() => onTemplateSelect(t)}
                        className={cn(
                          'flex items-center gap-3 p-3 rounded-lg border bg-surface transition-colors text-left',
                          isSelected
                            ? 'border-primary ring-1 ring-primary/30'
                            : 'border-border hover:border-primary/50'
                        )}
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
            )
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
        <h4 className="text-xs font-semibold text-text-muted uppercase">Filtres</h4>

        {/* Title */}
        {onTitleChange && (
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Titre du rapport</label>
            <input
              type="text"
              value={title ?? ''}
              onChange={e => onTitleChange(e.target.value)}
              placeholder={autoTitle || 'Titre auto-généré…'}
              className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text placeholder:italic placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
            />
          </div>
        )}

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

        {/* Filtres spécifiques compte d'attente */}
        {isCompteAttenteTemplate && (
          <div className="space-y-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-400">
              <AlertTriangle size={12} />
              Filtres compte d'attente
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Scope</label>
              <select
                value={filters.scope || (filters.justificatif_present === false ? 'sans_justif' : 'all')}
                onChange={(e) => {
                  const v = e.target.value as 'all' | 'sans_justif'
                  if (v === 'sans_justif') {
                    onFiltersChange({ ...filters, scope: 'sans_justif', justificatif_present: false })
                  } else {
                    onFiltersChange({ ...filters, scope: undefined, justificatif_present: undefined })
                  }
                }}
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              >
                <option value="all">Tous (compte d'attente complet)</option>
                <option value="sans_justif">Sans justificatif uniquement</option>
              </select>
            </div>
            <p className="text-[10px] text-text-muted italic">
              Les filtres ci-dessous (catégories, type, montant, source) s'appliquent en plus du scope.
              Le rapport est dédupliqué : regénérer avec les mêmes filtres met à jour le fichier existant.
            </p>
          </div>
        )}

        {/* Filtres spécifiques amortissements */}
        {isAmortissementsTemplate && (
          <div className="space-y-3 rounded-lg bg-primary/5 border border-primary/20 p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-primary">
              <Package size={12} />
              Filtres amortissements
            </div>
            <div className="grid grid-cols-2 gap-3">
              {selectedTemplate?.id === 'amortissements_registre' && (
                <div>
                  <label className="text-[10px] text-text-muted block mb-1">Statut</label>
                  <select
                    value={filters.statut || 'all'}
                    onChange={e => updateFilter('statut', e.target.value === 'all' ? undefined : e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                  >
                    {(['all', 'en_cours', 'amorti', 'sorti'] as const).map(s => (
                      <option key={s} value={s}>{STATUT_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[10px] text-text-muted block mb-1">Poste comptable</label>
                <select
                  value={filters.poste || 'all'}
                  onChange={e => updateFilter('poste', e.target.value === 'all' ? undefined : e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                >
                  {posteOptions.map(p => (
                    <option key={p} value={p}>
                      {p === 'all' ? 'Tous les postes' : p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[10px] text-text-muted italic">
              Le rapport est dédupliqué par filtres : regénérer avec les mêmes paramètres met à jour le fichier existant.
            </p>
          </div>
        )}

        {/* Categories — Modern checkboxes (masqué pour templates amortissements) */}
        {!isAmortissementsTemplate && (<div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-text-muted block mb-1.5">Catégories</label>
            <div className="bg-background border border-border rounded-lg p-1.5 space-y-0.5">
              {/* Tout sélectionner — first row */}
              <label
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors text-xs font-medium border-b border-border mb-0.5 pb-2',
                  allSelected ? 'text-primary' : 'text-text-muted hover:text-text'
                )}
              >
                <button
                  onClick={toggleAllCategories}
                  className={cn(
                    'w-[18px] h-[18px] rounded flex items-center justify-center transition-all duration-150 border-2 shrink-0',
                    allSelected
                      ? 'bg-primary border-transparent shadow-sm'
                      : noneSelected
                        ? 'bg-surface border-text-muted/30 hover:border-primary/50'
                        : 'bg-primary/40 border-transparent shadow-sm'
                  )}
                >
                  {allSelected && <Check size={12} className="text-white drop-shadow-sm" />}
                  {!allSelected && !noneSelected && <Minus size={12} className="text-white drop-shadow-sm" />}
                </button>
                Tout sélectionner
                <span className="ml-auto text-[10px] text-text-muted font-normal">
                  {selectedCats.length}/{allCatNames.length}
                </span>
              </label>
              {categories.length === 0 && (
                <p className="text-[10px] text-text-muted py-2 text-center">Aucune catégorie</p>
              )}
              <div className="max-h-[220px] overflow-y-auto space-y-0.5">
                {allCatNames.map(name => {
                  const checked = selectedCats.includes(name)
                  const catData = categories.find(c => c.name === name)
                  const isUncategorized = name === PSEUDO_UNCATEGORIZED
                  const displayName = isUncategorized ? 'Non catégorisé' : name
                  const dotColor = isUncategorized ? '#666' : (catData?.color || '#888')
                  return (
                    <label
                      key={name}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition-colors text-xs',
                        checked ? 'bg-primary/8 text-text' : 'text-text-muted hover:bg-surface-hover',
                        isUncategorized && 'border-t border-border/30 mt-1 pt-1.5',
                      )}
                    >
                      <button
                        onClick={() => toggleCategory(name)}
                        className={cn(
                          'w-[18px] h-[18px] rounded flex items-center justify-center transition-all duration-150 border-2 shrink-0',
                          checked
                            ? 'bg-primary border-transparent shadow-sm'
                            : 'bg-surface border-text-muted/30 hover:border-primary/50'
                        )}
                      >
                        {checked && <Check size={12} className="text-white drop-shadow-sm" />}
                      </button>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: dotColor }}
                      />
                      {displayName}
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-text-muted block mb-1.5">Sous-catégories</label>
            <div className={cn(
              'bg-background border border-border rounded-lg p-1.5 space-y-0.5',
              subcategories.length === 0 && 'opacity-50'
            )}>
              {subcategories.length === 0 ? (
                <p className="text-[10px] text-text-muted py-2 text-center">
                  {selectedCats.length === 0 ? 'Sélectionnez des catégories' : 'Aucune sous-catégorie'}
                </p>
              ) : (
                <>
                  {/* Tout sélectionner sous-catégories */}
                  <label
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors text-xs font-medium border-b border-border mb-0.5 pb-2',
                      selectedSubs.length === subcategories.length ? 'text-primary' : 'text-text-muted hover:text-text'
                    )}
                  >
                    <button
                      onClick={toggleAllSubcategories}
                      className={cn(
                        'w-[18px] h-[18px] rounded flex items-center justify-center transition-all duration-150 border-2 shrink-0',
                        selectedSubs.length === subcategories.length
                          ? 'bg-primary border-transparent shadow-sm'
                          : selectedSubs.length === 0
                            ? 'bg-surface border-text-muted/30 hover:border-primary/50'
                            : 'bg-primary/40 border-transparent shadow-sm'
                      )}
                    >
                      {selectedSubs.length === subcategories.length && <Check size={12} className="text-white drop-shadow-sm" />}
                      {selectedSubs.length > 0 && selectedSubs.length < subcategories.length && <Minus size={12} className="text-white drop-shadow-sm" />}
                    </button>
                    Tout sélectionner
                    <span className="ml-auto text-[10px] text-text-muted font-normal">
                      {selectedSubs.length}/{subcategories.length}
                    </span>
                  </label>
                  {subcategories.map(s => {
                    const checked = selectedSubs.includes(s)
                    return (
                      <label
                        key={s}
                        className={cn(
                          'flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition-colors text-xs',
                          checked ? 'bg-primary/8 text-text' : 'text-text-muted hover:bg-surface-hover'
                        )}
                      >
                        <button
                          onClick={() => toggleSubcategory(s)}
                          className={cn(
                            'w-[18px] h-[18px] rounded flex items-center justify-center transition-all duration-150 border-2 shrink-0',
                            checked
                              ? 'bg-primary border-transparent shadow-sm'
                              : 'bg-surface border-text-muted/30 hover:border-primary/50'
                          )}
                        >
                          {checked && <Check size={12} className="text-white drop-shadow-sm" />}
                        </button>
                        {s}
                      </label>
                    )
                  })}
                </>
              )}
            </div>
          </div>
        </div>)}

        {/* Type + Amount (masqué pour templates amortissements) */}
        {!isAmortissementsTemplate && (<div className="grid grid-cols-3 gap-3">
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
        </div>)}

        {/* Source (type d'opération) — masqué pour amortissements */}
        {!isAmortissementsTemplate && (<div>
          <label className="text-[10px] text-text-muted block mb-1">Type d'opération</label>
          <div className="flex gap-1.5">
            {(['all', 'bancaire', 'note_de_frais'] as const).map(s => (
              <button
                key={s}
                onClick={() => updateFilter('source', s === 'all' ? undefined : s)}
                className={cn(
                  'flex-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-1',
                  (filters.source || 'all') === s
                    ? 'bg-primary text-white'
                    : 'bg-background text-text-muted hover:text-text'
                )}
              >
                {s === 'all' && 'Tous'}
                {s === 'bancaire' && 'Opérations bancaires'}
                {s === 'note_de_frais' && (
                  <>
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 500,
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: '#FAEEDA',
                        color: '#854F0B',
                        lineHeight: '14px',
                      }}
                    >
                      Note de frais
                    </span>
                    <span>uniquement</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>)}

        {/* Format */}
        <div>
          <label className="text-[10px] text-text-muted block mb-1">Format de sortie</label>
          <div className="flex gap-2">
            {supportedFormats.map(f => (
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
          <div className="flex items-center gap-2">
            {onBatchGenerate && !isAmortissementsTemplate && (
              <button
                onClick={onBatchGenerate}
                disabled={isGenerating || isBatchGenerating}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-surface border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary/10 disabled:opacity-50 transition-colors"
              >
                {isBatchGenerating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Layers size={14} />
                )}
                {isBatchGenerating ? 'Génération batch...' : 'Batch (12 mois)'}
              </button>
            )}
            <button
              onClick={onGenerate}
              disabled={isGenerating || isBatchGenerating}
              className="px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {isGenerating ? 'Génération...' : 'Générer le rapport'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
