import { useState, useCallback } from 'react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { cn } from '@/lib/utils'
import { GitCompareArrows } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/shared/PageHeader'
import ReportFilters from './ReportFilters'
import ReportGallery from './ReportGallery'
import ReportPreviewDrawer from './ReportPreviewDrawer'
import ReportCompareDrawer from './ReportCompareDrawer'
import { useReportsGallery, useGenerateReport } from '@/hooks/useReports'
import { api } from '@/api/client'
import type { ReportFiltersV2, ReportMetadata, ReportTemplate, ReportGenerateRequest } from '@/types'

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<'generate' | 'library'>('generate')
  const { selectedYear, setYear } = useFiscalYearStore()
  const [filters, setFilters] = useState<ReportFiltersV2>({ year: selectedYear })
  const [format, setFormat] = useState<'pdf' | 'csv' | 'excel'>('pdf')
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [previewReport, setPreviewReport] = useState<ReportMetadata | null>(null)
  const [selectedReports, setSelectedReports] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)
  const [isBatchGenerating, setIsBatchGenerating] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const { data: gallery } = useReportsGallery()
  const generateMutation = useGenerateReport()

  const handleGenerate = () => {
    generateMutation.mutate(
      { format, filters, template_id: templateId },
      { onSuccess: () => setActiveTab('library') }
    )
  }

  const handleBatchGenerate = useCallback(async () => {
    const year = filters.year || selectedYear
    if (!year) {
      toast.error('Sélectionnez une année pour le batch')
      return
    }

    setIsBatchGenerating(true)
    const toastId = toast.loading(`Génération batch ${year}...`)
    let generated = 0
    let errors = 0

    try {
      for (let month = 1; month <= 12; month++) {
        const monthFilters: ReportFiltersV2 = {
          ...filters,
          year,
          month,
          quarter: undefined,
        }
        try {
          await api.post<{ replaced?: string }>('/reports/generate', {
            format,
            filters: monthFilters,
            template_id: templateId,
          } as ReportGenerateRequest)
          generated++
          toast.loading(`Génération batch ${year}... (${generated}/12)`, { id: toastId })
        } catch {
          errors++
        }
      }

      if (generated > 0) {
        toast.success(`${generated} rapport${generated > 1 ? 's' : ''} généré${generated > 1 ? 's' : ''}${errors > 0 ? ` (${errors} erreur${errors > 1 ? 's' : ''})` : ''}`, { id: toastId })
        setActiveTab('library')
      } else {
        toast.error('Aucun rapport généré — vérifiez les données', { id: toastId })
      }
    } catch {
      toast.error('Erreur lors de la génération batch', { id: toastId })
    } finally {
      setIsBatchGenerating(false)
    }
  }, [filters, format, templateId, selectedYear])

  // ── Selection helpers ──
  const handleToggleSelect = (filename: string) => {
    setSelectedReports(prev =>
      prev.includes(filename) ? prev.filter(f => f !== filename) : [...prev, filename]
    )
  }

  const handleSelectAll = (filenames: string[]) => {
    setSelectedReports(prev => {
      const set = new Set(prev)
      filenames.forEach(f => set.add(f))
      return Array.from(set)
    })
  }

  const handleClearSelection = () => setSelectedReports([])

  // ── Export ZIP for accountant ──
  const handleExportZip = useCallback(async () => {
    if (selectedReports.length === 0) return
    setIsExporting(true)
    try {
      const response = await fetch('/api/reports/export-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: selectedReports }),
      })
      if (!response.ok) throw new Error('Erreur export')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const disposition = response.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="?([^"]+)"?/)
      a.href = url
      a.download = match ? match[1] : 'Rapports_Comptable.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`ZIP exporté (${selectedReports.length} rapports)`)
    } catch {
      toast.error("Erreur lors de l'export ZIP")
    } finally {
      setIsExporting(false)
    }
  }, [selectedReports])

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

  const reportCount = gallery?.total_count ?? 0

  return (
    <div>
      <PageHeader
        title="Rapports"
        description="Génération et bibliothèque de rapports comptables"
        actions={
          activeTab === 'library' && selectedReports.length === 2 ? (
            <button
              onClick={() => setShowCompare(true)}
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-sm hover:bg-surface-hover"
            >
              <GitCompareArrows size={16} />
              Comparer
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
          onBatchGenerate={handleBatchGenerate}
          isGenerating={generateMutation.isPending}
          isBatchGenerating={isBatchGenerating}
          onTemplateSelect={handleTemplateSelect}
        />
      ) : (
        <ReportGallery
          onPreview={setPreviewReport}
          onSwitchToGenerate={() => setActiveTab('generate')}
          selectedReports={selectedReports}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
          onExportZip={handleExportZip}
          isExporting={isExporting}
        />
      )}

      {/* Drawers */}
      <ReportPreviewDrawer
        report={previewReport}
        isOpen={previewReport != null}
        onClose={() => setPreviewReport(null)}
      />
      <ReportCompareDrawer
        filenameA={selectedReports[0] || null}
        filenameB={selectedReports[1] || null}
        isOpen={showCompare}
        onClose={() => setShowCompare(false)}
      />
    </div>
  )
}
