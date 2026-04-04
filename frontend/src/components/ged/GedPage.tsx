import { useState, useMemo } from 'react'
import { Upload, Settings2, RefreshCw, Calendar, FolderTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import GedTree from './GedTree'
import GedSearchBar from './GedSearchBar'
import GedToolbar from './GedToolbar'
import GedBreadcrumb from './GedBreadcrumb'
import GedDocumentGrid from './GedDocumentGrid'
import GedDocumentList from './GedDocumentList'
import GedDocumentDrawer from './GedDocumentDrawer'
import GedUploadZone from './GedUploadZone'
import GedPostesDrawer from './GedPostesDrawer'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import {
  useGedTree,
  useGedDocuments,
  useGedPostes,
  useGedStats,
  useGedScan,
} from '@/hooks/useGed'
import type { GedFilters, GedTreeNode } from '@/types'

type TreeMode = 'by_year' | 'by_type'

export default function GedPage() {
  const [treeMode, setTreeMode] = useState<TreeMode>('by_year')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null)
  const [showPostesDrawer, setShowPostesDrawer] = useState(false)
  const [showUploadZone, setShowUploadZone] = useState(false)
  const [filters, setFilters] = useState<GedFilters>({ sort_by: 'added_at', sort_order: 'desc' })

  const { data: treeData, isLoading: treeLoading } = useGedTree()
  const { data: documents, isLoading: docsLoading } = useGedDocuments(filters)
  const { data: postesConfig } = useGedPostes()
  const { data: stats } = useGedStats()
  const scanMutation = useGedScan()

  const postes = postesConfig?.postes ?? []
  const activeTree = treeData ? treeData[treeMode] ?? [] : []

  // Derive breadcrumb path from selected node
  const breadcrumbPath = useMemo(() => {
    if (!selectedNode || !activeTree.length) return [{ id: 'root', label: 'Bibliothèque' }]
    const path = [{ id: 'root', label: 'Bibliothèque' }]
    const findNode = (nodes: GedTreeNode[], targetId: string, trail: { id: string; label: string }[]): boolean => {
      for (const node of nodes) {
        const current = [...trail, { id: node.id, label: node.label }]
        if (node.id === targetId) {
          path.push(...current)
          return true
        }
        if (node.children?.length && findNode(node.children, targetId, current)) return true
      }
      return false
    }
    findNode(activeTree, selectedNode, [])
    return path
  }, [selectedNode, activeTree])

  const handleNodeSelect = (nodeId: string) => {
    setSelectedNode(nodeId === selectedNode ? null : nodeId)
    const newFilters: GedFilters = { sort_by: filters.sort_by, sort_order: filters.sort_order }

    // ── "Par année" tree IDs: year-{y}, year-{y}-{type}, year-{y}-{type}-{m}
    if (nodeId.startsWith('year-')) {
      const parts = nodeId.replace('year-', '').split('-')
      // year-{y}
      if (parts.length === 1 && parts[0] !== 'none') {
        newFilters.year = parseInt(parts[0])
      }
      // year-none
      if (parts[0] === 'none' && parts.length === 1) {
        // All docs without year — no specific filter, handled by backend
      }
      // year-{y}-{type} or year-none-{type}
      if (parts.length === 2) {
        if (parts[0] !== 'none') newFilters.year = parseInt(parts[0])
        const typeMap: Record<string, string> = { releve: 'releve', justificatif: 'justificatif', rapport: 'rapport', 'document_libre': 'document_libre' }
        if (typeMap[parts[1]]) newFilters.type = typeMap[parts[1]]
      }
      // year-{y}-{type}-{m}
      if (parts.length === 3) {
        newFilters.year = parseInt(parts[0])
        const typeMap: Record<string, string> = { releve: 'releve', justificatif: 'justificatif', rapport: 'rapport', 'document_libre': 'document_libre' }
        if (typeMap[parts[1]]) newFilters.type = typeMap[parts[1]]
        const m = parseInt(parts[2])
        if (!isNaN(m) && m > 0) newFilters.month = m
      }
    }
    // ── "Par type" tree IDs (existing logic)
    else if (nodeId.startsWith('releve')) {
      newFilters.type = 'releve'
      const parts = nodeId.split('-')
      if (parts.length >= 2 && parts[1] !== 'releve') {
        newFilters.year = parseInt(parts[1])
      }
      if (parts.length >= 3) {
        const m = parseInt(parts[2])
        if (!isNaN(m) && m > 0) newFilters.month = m
      }
    } else if (nodeId.startsWith('justificatif-date-')) {
      newFilters.type = 'justificatif'
      const parts = nodeId.replace('justificatif-date-', '').split('-')
      if (parts[0]) newFilters.year = parseInt(parts[0])
      if (parts[1]) {
        const m = parseInt(parts[1])
        if (!isNaN(m) && m > 0) newFilters.month = m
      }
    } else if (nodeId.startsWith('justificatif-poste-')) {
      newFilters.type = 'justificatif'
      const posteId = nodeId.replace('justificatif-poste-', '')
      if (posteId !== 'none') newFilters.poste_comptable = posteId
    } else if (nodeId === 'justificatifs' || nodeId.startsWith('justificatifs-par-')) {
      newFilters.type = 'justificatif'
    } else if (nodeId.startsWith('rapport')) {
      newFilters.type = 'rapport'
      if (nodeId.startsWith('rapport-poste-')) {
        newFilters.poste_comptable = nodeId.replace('rapport-poste-', '')
      }
    } else if (nodeId === 'documents-libres' || nodeId.startsWith('libre-')) {
      newFilters.type = 'document_libre'
    } else if (nodeId === 'releves') {
      newFilters.type = 'releve'
    } else if (nodeId === 'rapports') {
      newFilters.type = 'rapport'
    }

    setFilters(newFilters)
  }

  const handleBreadcrumbNav = (nodeId: string) => {
    if (nodeId === 'root') {
      setSelectedNode(null)
      setFilters({ sort_by: filters.sort_by, sort_order: filters.sort_order })
    } else {
      handleNodeSelect(nodeId)
    }
  }

  const handleSearch = (query: string) => {
    setFilters(prev => ({ ...prev, search: query || undefined }))
  }

  const handleTreeModeChange = (mode: TreeMode) => {
    setTreeMode(mode)
    setSelectedNode(null)
    setFilters({ sort_by: filters.sort_by, sort_order: filters.sort_order })
  }

  return (
    <div className="h-full">
      <PageHeader
        title="Bibliothèque Documents"
        description="Gestion électronique de documents — indexation, recherche et fiscalité"
        actions={
          <div className="flex items-center gap-2">
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

      <div className="flex mt-6" style={{ height: 'calc(100vh - 200px)' }}>
        {/* Left panel: tabs + search + tree */}
        <div className="w-[260px] shrink-0 border-r border-border flex flex-col">
          {/* Tree mode tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => handleTreeModeChange('by_year')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
                treeMode === 'by_year'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text'
              )}
            >
              <Calendar size={13} />
              Par année
            </button>
            <button
              onClick={() => handleTreeModeChange('by_type')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
                treeMode === 'by_type'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text'
              )}
            >
              <FolderTree size={13} />
              Par type
            </button>
          </div>

          <div className="p-3 border-b border-border">
            <GedSearchBar onSearch={handleSearch} onSelect={setSelectedDoc} />
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {treeLoading ? (
              <LoadingSpinner text="Chargement..." />
            ) : (
              <GedTree
                tree={activeTree}
                selectedNode={selectedNode}
                onSelect={handleNodeSelect}
              />
            )}
          </div>
        </div>

        {/* Right panel: content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 pt-3 pb-2 border-b border-border">
            <GedBreadcrumb path={breadcrumbPath} onNavigate={handleBreadcrumbNav} />
          </div>
          <div className="px-4 py-2 border-b border-border">
            <GedToolbar
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              filters={filters}
              onFiltersChange={setFilters}
              totalCount={documents?.length ?? 0}
              totalSize={stats?.disk_size_human ?? ''}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {docsLoading ? (
              <LoadingSpinner text="Chargement des documents..." />
            ) : !documents?.length ? (
              <div className="text-center py-16 text-text-muted">
                <p className="text-lg">Aucun document</p>
                <p className="text-sm mt-1">Sélectionnez un dossier ou lancez un scan</p>
              </div>
            ) : viewMode === 'grid' ? (
              <GedDocumentGrid
                documents={documents}
                postes={postes}
                onSelect={setSelectedDoc}
              />
            ) : (
              <GedDocumentList
                documents={documents}
                postes={postes}
                onSelect={setSelectedDoc}
              />
            )}
          </div>
        </div>
      </div>

      {/* Drawers & modals */}
      <GedDocumentDrawer
        docId={selectedDoc}
        postes={postes}
        onClose={() => setSelectedDoc(null)}
      />
      <GedPostesDrawer
        open={showPostesDrawer}
        onClose={() => setShowPostesDrawer(false)}
      />
      <GedUploadZone
        open={showUploadZone}
        onClose={() => setShowUploadZone(false)}
      />
    </div>
  )
}
