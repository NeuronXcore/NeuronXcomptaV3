import { useState } from 'react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { cn } from '@/lib/utils'
import { GitCompareArrows } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import ReportFilters from './ReportFilters'
import ReportGallery from './ReportGallery'
import ReportPreviewDrawer from './ReportPreviewDrawer'
import ReportCompareDrawer from './ReportCompareDrawer'
import { useReportsGallery, useGenerateReport } from '@/hooks/useReports'
import type { ReportFiltersV2, ReportMetadata, ReportTemplate } from '@/types'

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<'generate' | 'library'>('generate')
  const { selectedYear, setYear } = useFiscalYearStore()
  const [filters, setFilters] = useState<ReportFiltersV2>({ year: selectedYear })
  const [format, setFormat] = useState<'pdf' | 'csv' | 'excel'>('pdf')
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [previewReport, setPreviewReport] = useState<ReportMetadata | null>(null)
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)

  const { data: gallery } = useReportsGallery()
  const generateMutation = useGenerateReport()

  const handleGenerate = () => {
    generateMutation.mutate(
      { format, filters, template_id: templateId },
      { onSuccess: () => setActiveTab('library') }
    )
  }

  const handleFiltersChange = (f: ReportFiltersV2) => {
    setFilters(f)
    if (f.year) setYear(f.year)
  }

  const handleTemplateSelect = (t: ReportTemplate) => {
    const yr = t.filters.year || selectedYear
    setFilters({
      ...t.filters,
      year: yr,
    })
    if (yr) setYear(yr)
    setFormat(t.format as 'pdf' | 'csv' | 'excel')
    setTemplateId(t.id)
  }

  const handleToggleCompareSelect = (filename: string) => {
    setSelectedForCompare(prev => {
      if (prev.includes(filename)) return prev.filter(f => f !== filename)
      if (prev.length >= 2) return [prev[1], filename]
      return [...prev, filename]
    })
  }

  const reportCount = gallery?.total_count ?? 0

  return (
    <div>
      <PageHeader
        title="Rapports"
        description="Génération et bibliothèque de rapports comptables"
        actions={
          activeTab === 'library' && selectedForCompare.length === 2 ? (
            <button
              onClick={() => setShowCompare(true)}
              className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90"
            >
              <GitCompareArrows size={16} />
              Comparer ({selectedForCompare.length})
            </button>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="flex border-b border-border mb-6">
        <button
          onClick={() => setActiveTab('generate')}
          className={cn(
            'px-4 py-2.5 text-sm font-medium transition-colors',
            activeTab === 'generate'
              ? 'text-primary border-b-2 border-primary'
              : 'text-text-muted hover:text-text'
          )}
        >
          Générer
        </button>
        <button
          onClick={() => setActiveTab('library')}
          className={cn(
            'px-4 py-2.5 text-sm font-medium transition-colors flex items-center gap-2',
            activeTab === 'library'
              ? 'text-primary border-b-2 border-primary'
              : 'text-text-muted hover:text-text'
          )}
        >
          Bibliothèque
          {reportCount > 0 && (
            <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-bold">
              {reportCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'generate' ? (
        <ReportFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
          format={format}
          onFormatChange={setFormat}
          onGenerate={handleGenerate}
          isGenerating={generateMutation.isPending}
          onTemplateSelect={handleTemplateSelect}
        />
      ) : (
        <ReportGallery
          onPreview={setPreviewReport}
          onSwitchToGenerate={() => setActiveTab('generate')}
          selectedForCompare={selectedForCompare}
          onToggleCompareSelect={handleToggleCompareSelect}
        />
      )}

      {/* Drawers */}
      <ReportPreviewDrawer
        report={previewReport}
        isOpen={previewReport != null}
        onClose={() => setPreviewReport(null)}
      />
      <ReportCompareDrawer
        filenameA={selectedForCompare[0] || null}
        filenameB={selectedForCompare[1] || null}
        isOpen={showCompare}
        onClose={() => setShowCompare(false)}
      />
    </div>
  )
}
