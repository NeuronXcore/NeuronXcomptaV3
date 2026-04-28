import { Calendar, Tag, Building2, FolderTree, Layers, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import GedTree from './GedTree'
import type { GedTreeResponse, GedFilters } from '@/types'

type TreeTab = 'period' | 'category' | 'vendor' | 'type' | 'year' | 'templates'

interface GedTreePanelProps {
  tree: GedTreeResponse | undefined
  activeTab: TreeTab
  onTabChange: (tab: TreeTab) => void
  selectedNodeId: string | null
  onNodeSelect: (nodeId: string, filters: Partial<GedFilters>) => void
  /**
   * Si non-null, affiche un onglet supplémentaire « Templates » avec un badge compteur.
   * Passer `null` pour masquer totalement l'onglet (zéro template).
   */
  templatesCount?: number | null
  templatesFilter?: 'all' | 'blank' | 'scanned'
  onTemplatesFilterChange?: (f: 'all' | 'blank' | 'scanned') => void
  templatesCategory?: string | null
  onTemplatesCategoryChange?: (c: string | null) => void
  templatesCategories?: string[]
}

const TABS: { key: TreeTab; icon: typeof Calendar; label: string; description: string }[] = [
  { key: 'period', icon: Calendar, label: 'Période', description: 'Navigation par année, trimestre et mois' },
  { key: 'year', icon: Layers, label: 'Année / Type', description: 'Année puis type de document (relevé, justificatif, rapport…)' },
  { key: 'category', icon: Tag, label: 'Catégorie', description: 'Catégorie puis sous-catégorie' },
  { key: 'vendor', icon: Building2, label: 'Fournisseur', description: 'Regroupement par fournisseur' },
  { key: 'type', icon: FolderTree, label: 'Type', description: 'Type de document : relevés, justificatifs, rapports, documents libres' },
  { key: 'templates', icon: Wand2, label: 'Templates', description: 'Templates fac-similé — génération batch et administration' },
]

function deriveFiltersFromNode(nodeId: string, tab: TreeTab, nodeLabel?: string): Partial<GedFilters> {
  // Period tab: period-{y}, period-{y}-T{q}, period-{y}-{m}
  if (tab === 'period') {
    const m = nodeId.match(/^period-(\d+)-(\d+)$/)
    if (m) return { year: parseInt(m[1]), month: parseInt(m[2]) }
    const q = nodeId.match(/^period-(\d+)-T(\d)$/)
    if (q) return { year: parseInt(q[1]), quarter: parseInt(q[2]) }
    const y = nodeId.match(/^period-(\d+)$/)
    if (y) return { year: parseInt(y[1]) }
    if (nodeId === 'period-none') return {}
  }
  // Year tab: year-{y}, year-{y}-{type}, year-{y}-{type}-{m}
  if (tab === 'year') {
    if (nodeId.startsWith('year-')) {
      const parts = nodeId.replace('year-', '').split('-')
      if (parts[0] === 'none') {
        // year-none or year-none-{type}
        if (parts.length >= 2) {
          const typeMap: Record<string, string> = { releve: 'releve', justificatif: 'justificatif', rapport: 'rapport', document_libre: 'document_libre', liasse_fiscale_scp: 'liasse_fiscale_scp' }
          if (typeMap[parts[1]]) return { type: typeMap[parts[1]] }
        }
        return {}
      }
      const y = parseInt(parts[0])
      if (parts.length === 1) return { year: y }
      if (parts.length === 2) {
        const typeMap: Record<string, string> = { releve: 'releve', justificatif: 'justificatif', rapport: 'rapport', document_libre: 'document_libre', liasse_fiscale_scp: 'liasse_fiscale_scp' }
        if (typeMap[parts[1]]) return { year: y, type: typeMap[parts[1]] }
      }
      if (parts.length === 3) {
        const typeMap: Record<string, string> = { releve: 'releve', justificatif: 'justificatif', rapport: 'rapport', document_libre: 'document_libre', liasse_fiscale_scp: 'liasse_fiscale_scp' }
        const m = parseInt(parts[2])
        return { year: y, ...(typeMap[parts[1]] ? { type: typeMap[parts[1]] } : {}), ...(m > 0 ? { month: m } : {}) }
      }
    }
    return {}
  }
  // Category tab: cat-{cat}, cat-{cat}-{sous}
  if (tab === 'category') {
    if (nodeId === 'cat-non-classes') return {}
    const sub = nodeId.match(/^cat-(.+?)-(.+)$/)
    if (sub) return { categorie: sub[1], sous_categorie: sub[2] }
    const cat = nodeId.match(/^cat-(.+)$/)
    if (cat) return { categorie: cat[1] }
  }
  // Vendor tab: vendor-{slug}, vendor-{slug}-{year}
  if (tab === 'vendor') {
    if (!nodeLabel) return {}
    // Extract year from child nodes: vendor-{slug}-{year}
    const yearMatch = nodeId.match(/-(\d{4})$/)
    if (yearMatch) {
      return { fournisseur: nodeLabel, year: parseInt(yearMatch[1]) }
    }
    // Root vendor node
    if (nodeId.startsWith('vendor-')) {
      return { fournisseur: nodeLabel }
    }
    return {}
  }
  // Type tab: releves, justificatifs, rapports, etc.
  if (tab === 'type') {
    if (nodeId === 'releves') return { type: 'releve' }
    if (nodeId.startsWith('releve-')) {
      const parts = nodeId.split('-')
      if (parts.length === 3) return { type: 'releve', year: parseInt(parts[1]), month: parseInt(parts[2]) }
      if (parts.length === 2) return { type: 'releve', year: parseInt(parts[1]) }
    }
    if (nodeId === 'justificatifs') return { type: 'justificatif' }
    if (nodeId === 'justificatifs-en-attente') return { type: 'justificatif', statut_justificatif: 'en_attente' }
    if (nodeId === 'justificatifs-traites') return { type: 'justificatif', statut_justificatif: 'traite' }
    // Justifs traités par year/month : `justificatif-date-{y}` ou `justificatif-date-{y}-{m}`
    if (nodeId.startsWith('justificatif-date-')) {
      const parts = nodeId.replace('justificatif-date-', '').split('-')
      if (parts.length === 2) return { type: 'justificatif', statut_justificatif: 'traite', year: parseInt(parts[0]), month: parseInt(parts[1]) }
      if (parts.length === 1) return { type: 'justificatif', statut_justificatif: 'traite', year: parseInt(parts[0]) }
    }
    // Justifs en attente par year/month : `justificatif-attente-{y}` ou `justificatif-attente-{y}-{m}`
    if (nodeId.startsWith('justificatif-attente-')) {
      const parts = nodeId.replace('justificatif-attente-', '').split('-')
      if (parts.length === 2) return { type: 'justificatif', statut_justificatif: 'en_attente', year: parseInt(parts[0]), month: parseInt(parts[1]) }
      if (parts.length === 1) return { type: 'justificatif', statut_justificatif: 'en_attente', year: parseInt(parts[0]) }
    }
    if (nodeId === 'rapports') return { type: 'rapport' }
    if (nodeId.startsWith('rapport-')) {
      const fmt = nodeId.replace('rapport-', '')
      return { type: 'rapport', format_type: fmt }
    }
    if (nodeId === 'documents-libres') return { type: 'document_libre' }
    if (nodeId.startsWith('libre-')) {
      const parts = nodeId.replace('libre-', '').split('-')
      if (parts.length >= 1 && !isNaN(parseInt(parts[0]))) {
        return { type: 'document_libre', year: parseInt(parts[0]), ...(parts[1] ? { month: parseInt(parts[1]) } : {}) }
      }
    }
  }
  return {}
}

export default function GedTreePanel({
  tree,
  activeTab,
  onTabChange,
  selectedNodeId,
  onNodeSelect,
  templatesCount,
  templatesFilter,
  onTemplatesFilterChange,
  templatesCategory,
  onTemplatesCategoryChange,
  templatesCategories,
}: GedTreePanelProps) {
  const treeData = tree && activeTab !== 'templates'
    ? {
        period: tree.by_period,
        year: tree.by_year,
        category: tree.by_category,
        vendor: tree.by_vendor,
        type: tree.by_type,
      }[activeTab] || []
    : []

  const handleSelect = (nodeId: string, label: string) => {
    const filters = deriveFiltersFromNode(nodeId, activeTab, label)
    onNodeSelect(nodeId, filters)
  }

  // Onglet Templates masqué si pas de templates (templatesCount == null ou 0).
  const visibleTabs = TABS.filter(t => t.key !== 'templates' || (templatesCount != null && templatesCount > 0))

  return (
    <div className="w-[260px] border-r border-border bg-surface/50 flex flex-col h-full shrink-0">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {visibleTabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                'group flex-1 flex items-center justify-center gap-1 py-2 text-[11px] transition-colors relative',
                activeTab === tab.key
                  ? 'text-primary border-b-2 border-primary bg-primary/5'
                  : 'text-text-muted hover:text-text',
              )}
            >
              <Icon size={14} />
              {tab.key === 'templates' && templatesCount != null && templatesCount > 0 && (
                <span className="text-[9px] font-semibold px-1 rounded bg-primary/15 text-primary">
                  {templatesCount}
                </span>
              )}
              {/* Tooltip au survol : fond blanc, texte noir, encadré */}
              <span
                role="tooltip"
                className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1.5 opacity-0 group-hover:opacity-100 group-hover:delay-150 transition-opacity bg-white text-black border border-gray-300 rounded-md shadow-lg px-2.5 py-1.5 text-[11px] leading-tight z-50 w-56 text-left"
              >
                <span className="block font-semibold">{tab.label}</span>
                <span className="block text-gray-600 text-[10px] mt-0.5">
                  {tab.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {/* Tree OR Templates filters */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'templates' ? (
          <TemplatesFilterList
            filter={templatesFilter || 'all'}
            onFilterChange={onTemplatesFilterChange || (() => {})}
            selectedCategory={templatesCategory ?? null}
            onCategoryChange={onTemplatesCategoryChange || (() => {})}
            categories={templatesCategories || []}
          />
        ) : (
          <GedTree tree={treeData} selectedNode={selectedNodeId} onSelect={handleSelect} />
        )}
      </div>
    </div>
  )
}

// ──── Templates filter list (sub-component) ────

interface TemplatesFilterListProps {
  filter: 'all' | 'blank' | 'scanned'
  onFilterChange: (f: 'all' | 'blank' | 'scanned') => void
  selectedCategory: string | null
  onCategoryChange: (c: string | null) => void
  categories: string[]
}

function TemplatesFilterList({
  filter,
  onFilterChange,
  selectedCategory,
  onCategoryChange,
  categories,
}: TemplatesFilterListProps) {
  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-text-muted/60 mb-1 px-1">Affichage</p>
        <FilterRow active={filter === 'all'} onClick={() => onFilterChange('all')}>
          Tous les templates
        </FilterRow>
        <FilterRow active={filter === 'blank'} onClick={() => onFilterChange('blank')} accent="amber">
          Depuis PDF vierge
        </FilterRow>
        <FilterRow active={filter === 'scanned'} onClick={() => onFilterChange('scanned')}>
          Depuis justificatif
        </FilterRow>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-text-muted/60 mb-1 px-1">Catégorie</p>
        <FilterRow active={selectedCategory === null} onClick={() => onCategoryChange(null)}>
          Toutes
        </FilterRow>
        {categories.map(cat => (
          <FilterRow
            key={cat}
            active={selectedCategory === cat}
            onClick={() => onCategoryChange(cat)}
          >
            {cat}
          </FilterRow>
        ))}
      </div>
    </div>
  )
}

function FilterRow({
  active,
  onClick,
  children,
  accent,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  accent?: 'amber'
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-2 py-1 rounded transition-colors text-[12px] flex items-center gap-1.5',
        active
          ? accent === 'amber'
            ? 'bg-amber-500/10 text-amber-400'
            : 'bg-primary/10 text-primary'
          : 'text-text hover:bg-surface',
      )}
    >
      {accent === 'amber' && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/60" />
      )}
      {children}
    </button>
  )
}

export { deriveFiltersFromNode }
export type { TreeTab }
