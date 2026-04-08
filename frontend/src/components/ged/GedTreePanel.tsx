import { Calendar, Tag, Building2, FolderTree, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import GedTree from './GedTree'
import type { GedTreeResponse, GedFilters } from '@/types'

type TreeTab = 'period' | 'category' | 'vendor' | 'type' | 'year'

interface GedTreePanelProps {
  tree: GedTreeResponse | undefined
  activeTab: TreeTab
  onTabChange: (tab: TreeTab) => void
  selectedNodeId: string | null
  onNodeSelect: (nodeId: string, filters: Partial<GedFilters>) => void
}

const TABS: { key: TreeTab; icon: typeof Calendar; label: string }[] = [
  { key: 'period', icon: Calendar, label: 'Période' },
  { key: 'year', icon: Layers, label: 'Année / Type' },
  { key: 'category', icon: Tag, label: 'Catégorie' },
  { key: 'vendor', icon: Building2, label: 'Fournisseur' },
  { key: 'type', icon: FolderTree, label: 'Type' },
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
          const typeMap: Record<string, string> = { releve: 'releve', justificatif: 'justificatif', rapport: 'rapport', document_libre: 'document_libre' }
          if (typeMap[parts[1]]) return { type: typeMap[parts[1]] }
        }
        return {}
      }
      const y = parseInt(parts[0])
      if (parts.length === 1) return { year: y }
      if (parts.length === 2) {
        const typeMap: Record<string, string> = { releve: 'releve', justificatif: 'justificatif', rapport: 'rapport', document_libre: 'document_libre' }
        if (typeMap[parts[1]]) return { year: y, type: typeMap[parts[1]] }
      }
      if (parts.length === 3) {
        const typeMap: Record<string, string> = { releve: 'releve', justificatif: 'justificatif', rapport: 'rapport', document_libre: 'document_libre' }
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
    if (nodeId === 'justificatifs-en-attente') return { type: 'justificatif' }
    if (nodeId === 'justificatifs-traites') return { type: 'justificatif' }
    if (nodeId.startsWith('justificatif-date-')) {
      const parts = nodeId.replace('justificatif-date-', '').split('-')
      if (parts.length === 2) return { type: 'justificatif', year: parseInt(parts[0]), month: parseInt(parts[1]) }
      if (parts.length === 1) return { type: 'justificatif', year: parseInt(parts[0]) }
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
}: GedTreePanelProps) {
  const treeData = tree
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

  return (
    <div className="w-[260px] border-r border-border bg-surface/50 flex flex-col h-full shrink-0">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 py-2 text-[11px] transition-colors',
                activeTab === tab.key
                  ? 'text-primary border-b-2 border-primary bg-primary/5'
                  : 'text-text-muted hover:text-text'
              )}
              title={tab.label}
            >
              <Icon size={14} />
            </button>
          )
        })}
      </div>
      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        <GedTree tree={treeData} selectedNode={selectedNodeId} onSelect={handleSelect} />
      </div>
    </div>
  )
}

export { deriveFiltersFromNode }
export type { TreeTab }
