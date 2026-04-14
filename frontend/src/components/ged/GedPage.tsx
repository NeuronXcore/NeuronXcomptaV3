import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Upload, Settings2, RefreshCw, Grid3X3, List, GitCompare, Send } from 'lucide-react'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import GedTreePanel, { type TreeTab } from './GedTreePanel'
import GedSearchBar from './GedSearchBar'
import GedDocumentCard from './GedDocumentCard'
import GedDocumentList from './GedDocumentList'
import GedDocumentDrawer from './GedDocumentDrawer'
import GedReportDrawer from './GedReportDrawer'
import GedUploadZone from './GedUploadZone'
import GedPostesDrawer from './GedPostesDrawer'
import GedTemplatesView from './GedTemplatesView'
import GedTemplateDetailDrawer from './GedTemplateDetailDrawer'
import TemplateEditDrawer from '@/components/templates/TemplateEditDrawer'
import BatchGenerateDrawer from '@/components/templates/BatchGenerateDrawer'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import {
  useGedTree,
  useGedDocuments,
  useGedPostes,
  useGedStats,
  useGedScan,
} from '@/hooks/useGed'
import { useGedTemplatesSummary } from '@/hooks/useTemplates'
import type { GedFilters } from '@/types'

export default function GedPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TreeTab>('period')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [filters, setFilters] = useState<GedFilters>({ sort_by: 'added_at', sort_order: 'desc' })
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [showPostesDrawer, setShowPostesDrawer] = useState(false)
  const [showUploadZone, setShowUploadZone] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [compareSelection, setCompareSelection] = useState<string[]>([])

  // Templates axis state
  const [templatesFilter, setTemplatesFilter] = useState<'all' | 'blank' | 'scanned'>('all')
  const [templatesCategory, setTemplatesCategory] = useState<string | null>(null)
  const [selectedTemplateDetailId, setSelectedTemplateDetailId] = useState<string | null>(null)
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null)
  const [batchTemplateId, setBatchTemplateId] = useState<string | null>(null)
  const [batchTemplateVendor, setBatchTemplateVendor] = useState('')

  const { data: tree } = useGedTree()
  const { data: documents, isLoading: docsLoading } = useGedDocuments(filters)
  const { data: postesConfig } = useGedPostes()
  const { data: stats } = useGedStats()
  const { data: templates, isLoading: templatesLoading } = useGedTemplatesSummary()
  const scanMutation = useGedScan()

  const templatesCount = templates?.length ?? 0
  const templatesCategories = useMemo(
    () => Array.from(new Set(templates?.map(t => t.category).filter(Boolean) as string[])).sort(),
    [templates],
  )

  const postes = postesConfig?.postes ?? []

  // Listes pour les dropdowns de GedSearchBar
  const categoriesList = useMemo(
    () => stats?.par_categorie?.map(c => c.categorie) ?? [],
    [stats],
  )
  const fournisseursList = useMemo(
    () => stats?.par_fournisseur?.map(f => f.fournisseur) ?? [],
    [stats],
  )
  const subcatForSelected = useMemo(() => {
    if (!filters.categorie || !documents) return []
    const set = new Set<string>()
    for (const d of documents) {
      if (d.categorie === filters.categorie && d.sous_categorie) {
        set.add(d.sous_categorie)
      }
    }
    return Array.from(set).sort()
  }, [filters.categorie, documents])

  // Initialize filters from URL params on mount
  useEffect(() => {
    const axis = searchParams.get('axis')
    if (axis === 'templates') {
      setActiveTab('templates')
      return
    }
    const initial: GedFilters = { sort_by: 'added_at', sort_order: 'desc' }
    if (searchParams.get('type')) initial.type = searchParams.get('type')!
    if (searchParams.get('year')) initial.year = parseInt(searchParams.get('year')!)
    if (searchParams.get('month')) initial.month = parseInt(searchParams.get('month')!)
    if (searchParams.get('categorie')) initial.categorie = searchParams.get('categorie')!
    if (searchParams.get('fournisseur')) initial.fournisseur = searchParams.get('fournisseur')!
    if (searchParams.get('format_type')) initial.format_type = searchParams.get('format_type')!

    const hasUrlFilters = !!(initial.type || initial.year || initial.categorie || initial.fournisseur)
    if (hasUrlFilters) {
      setFilters(initial)
      // Auto-select best tab
      if (initial.categorie) setActiveTab('category')
      else if (initial.fournisseur) setActiveTab('vendor')
      else if (initial.year && !initial.type) setActiveTab('period')
      else if (initial.type) setActiveTab('type')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Tree node selection → update filters
  const handleNodeSelect = (nodeId: string, nodeFilters: Partial<GedFilters>) => {
    setSelectedNodeId(nodeId)
    setFilters(prev => ({
      sort_by: prev.sort_by,
      sort_order: prev.sort_order,
      ...nodeFilters,
    }))
  }

  // Filter bar changes
  const handleFiltersChange = (newFilters: GedFilters) => {
    setFilters({ sort_by: newFilters.sort_by || 'added_at', sort_order: newFilters.sort_order || 'desc', ...newFilters })
    // Clear tree selection when filters change from the bar
    setSelectedNodeId(null)
  }

  // Tab change → reset
  const handleTabChange = (tab: TreeTab) => {
    setActiveTab(tab)
    setSelectedNodeId(null)
    setFilters({ sort_by: filters.sort_by, sort_order: filters.sort_order })
  }

  // Compare mode
  const toggleCompareSelection = (docId: string) => {
    setCompareSelection(prev =>
      prev.includes(docId)
        ? prev.filter(id => id !== docId)
        : prev.length < 2 ? [...prev, docId] : prev
    )
  }

  // Selected document for drawer
  const selectedDoc = useMemo(() => {
    if (!selectedDocId || !documents) return null
    return documents.find(d => d.doc_id === selectedDocId) || null
  }, [selectedDocId, documents])

  return (
    <div className="h-full">
      <PageHeader
        title="Bibliothèque"
        description={`${stats?.total_documents ?? 0} documents · ${stats?.disk_size_human ?? ''}`}
        actions={
          <div className="flex items-center gap-2">
            {/* Send to accountant */}
            <button
              onClick={() => useSendDrawerStore.getState().open()}
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-sm hover:bg-surface-hover transition-colors"
            >
              <Send size={15} />
              Envoyer
            </button>
            {/* Compare mode toggle */}
            <button
              onClick={() => { setCompareMode(!compareMode); setCompareSelection([]) }}
              className={cn(
                'flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors',
                compareMode
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-surface border-border text-text hover:bg-surface-hover'
              )}
            >
              <GitCompare size={16} />
              Comparer
            </button>
            {/* View mode — overflow visible pour laisser sortir les tooltips */}
            <div className="flex border border-border rounded-lg">
              <button
                onClick={() => setViewMode('grid')}
                className={cn('group relative p-2 rounded-l-md', viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text')}
              >
                <Grid3X3 size={16} />
                <span className="pointer-events-none absolute top-full right-0 mt-2 opacity-0 group-hover:opacity-100 group-hover:delay-150 transition-opacity bg-white text-black border border-gray-300 rounded-md shadow-lg px-2.5 py-1.5 text-[11px] leading-tight z-50 whitespace-nowrap">
                  Vue grille
                </span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn('group relative p-2 rounded-r-md', viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text')}
              >
                <List size={16} />
                <span className="pointer-events-none absolute top-full right-0 mt-2 opacity-0 group-hover:opacity-100 group-hover:delay-150 transition-opacity bg-white text-black border border-gray-300 rounded-md shadow-lg px-2.5 py-1.5 text-[11px] leading-tight z-50 whitespace-nowrap">
                  Vue liste
                </span>
              </button>
            </div>
            <button
              onClick={() => setShowUploadZone(true)}
              className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors"
            >
              <Upload size={16} />
              Upload
            </button>
            <button
              onClick={() => setShowPostesDrawer(true)}
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-sm hover:bg-surface-hover transition-colors"
            >
              <Settings2 size={16} />
              Postes
            </button>
            <button
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-sm hover:bg-surface-hover transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={scanMutation.isPending ? 'animate-spin' : ''} />
              Scanner
            </button>
          </div>
        }
      />

      {/* Barre de recherche globale, pleine largeur au-dessus du split */}
      <div className="mt-4">
        <GedSearchBar
          filters={filters}
          onChange={handleFiltersChange}
          categories={categoriesList}
          subcategories={subcatForSelected}
          fournisseurs={fournisseursList}
          resultCount={documents?.length ?? 0}
          isLoading={docsLoading}
        />
      </div>

      <div className="flex" style={{ height: 'calc(100vh - 280px)' }}>
        {/* Left: Tree panel with tabs */}
        <GedTreePanel
          tree={tree}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          selectedNodeId={selectedNodeId}
          onNodeSelect={handleNodeSelect}
          templatesCount={templatesCount}
          templatesFilter={templatesFilter}
          onTemplatesFilterChange={setTemplatesFilter}
          templatesCategory={templatesCategory}
          onTemplatesCategoryChange={setTemplatesCategory}
          templatesCategories={templatesCategories}
        />

        {/* Right: content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'templates' ? (
              <GedTemplatesView
                templates={templates || []}
                filter={templatesFilter}
                selectedCategory={templatesCategory}
                isLoading={templatesLoading}
                onOpenDetail={(id) => setSelectedTemplateDetailId(id)}
                onEdit={(id) => setEditTemplateId(id)}
                onBatchGenerate={(id, vendor) => {
                  setBatchTemplateId(id)
                  setBatchTemplateVendor(vendor)
                }}
              />
            ) : docsLoading ? (
              <LoadingSpinner text="Chargement des documents..." />
            ) : !documents?.length ? (
              <div className="text-center py-16 text-text-muted">
                <p className="text-lg">Aucun document</p>
                <p className="text-sm mt-1">Sélectionnez un dossier ou lancez un scan</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {documents.map(doc => (
                  <GedDocumentCard
                    key={doc.doc_id}
                    document={doc}
                    isSelected={compareSelection.includes(doc.doc_id)}
                    onSelect={() => toggleCompareSelection(doc.doc_id)}
                    onClick={() => setSelectedDocId(doc.doc_id)}
                    compareMode={compareMode}
                  />
                ))}
              </div>
            ) : (
              <GedDocumentList
                documents={documents}
                postes={postes}
                onSelect={setSelectedDocId}
              />
            )}
          </div>
        </div>
      </div>

      {/* Contextual drawer: report vs document */}
      {selectedDoc && (
        selectedDoc.type === 'rapport' && selectedDoc.rapport_meta ? (
          <GedReportDrawer
            document={selectedDoc}
            onClose={() => setSelectedDocId(null)}
          />
        ) : (
          <GedDocumentDrawer
            docId={selectedDocId}
            postes={postes}
            onClose={() => setSelectedDocId(null)}
          />
        )
      )}

      {/* Upload & Postes drawers */}
      <GedPostesDrawer
        open={showPostesDrawer}
        onClose={() => setShowPostesDrawer(false)}
      />
      <GedUploadZone
        open={showUploadZone}
        onClose={() => setShowUploadZone(false)}
      />

      {/* Templates drawers */}
      {selectedTemplateDetailId && (
        <GedTemplateDetailDrawer
          templateId={selectedTemplateDetailId}
          onClose={() => setSelectedTemplateDetailId(null)}
          onOpenEditor={(id) => {
            setSelectedTemplateDetailId(null)
            setEditTemplateId(id)
          }}
          onBatchGenerate={(id, vendor) => {
            setSelectedTemplateDetailId(null)
            setBatchTemplateId(id)
            setBatchTemplateVendor(vendor)
          }}
          onOpenJustificatif={(filename) => {
            // Navigate to justificatifs view highlighting this file
            navigate(`/justificatifs?file=${encodeURIComponent(filename)}&filter=tous`)
          }}
        />
      )}
      {editTemplateId && (
        <TemplateEditDrawer
          templateId={editTemplateId}
          onClose={() => setEditTemplateId(null)}
        />
      )}
      {batchTemplateId && (
        <BatchGenerateDrawer
          templateId={batchTemplateId}
          vendor={batchTemplateVendor}
          onClose={() => {
            setBatchTemplateId(null)
            setBatchTemplateVendor('')
          }}
        />
      )}
    </div>
  )
}
