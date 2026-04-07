import { useState, useCallback } from 'react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useNavigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/shared/PageHeader'
import ReportFilters from './ReportFilters'
import { useGenerateReport } from '@/hooks/useReports'
import { api } from '@/api/client'
import type { ReportFiltersV2, ReportTemplate, ReportGenerateRequest } from '@/types'

export default function ReportsPage() {
  const navigate = useNavigate()
  const { selectedYear, setYear } = useFiscalYearStore()
  const [filters, setFilters] = useState<ReportFiltersV2>({ year: selectedYear })
  const [format, setFormat] = useState<'pdf' | 'csv' | 'excel'>('pdf')
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [isBatchGenerating, setIsBatchGenerating] = useState(false)

  const generateMutation = useGenerateReport()

  const handleGenerate = () => {
    generateMutation.mutate(
      { format, filters, template_id: templateId },
      {
        onSuccess: () => {
          toast.success(
            <span>
              Rapport généré avec succès.{' '}
              <button
                onClick={() => navigate('/ged?type=rapport')}
                className="underline text-primary hover:text-primary/80"
              >
                Voir dans la bibliothèque
              </button>
            </span>,
            { duration: 5000 }
          )
        },
      }
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
        toast.success(
          <span>
            {generated} rapport{generated > 1 ? 's' : ''} généré{generated > 1 ? 's' : ''}{errors > 0 ? ` (${errors} erreur${errors > 1 ? 's' : ''})` : ''}.{' '}
            <button
              onClick={() => navigate('/ged?type=rapport')}
              className="underline text-primary hover:text-primary/80"
            >
              Voir dans la bibliothèque
            </button>
          </span>,
          { id: toastId, duration: 5000 }
        )
      } else {
        toast.error('Aucun rapport généré — vérifiez les données', { id: toastId })
      }
    } catch {
      toast.error('Erreur lors de la génération batch', { id: toastId })
    } finally {
      setIsBatchGenerating(false)
    }
  }, [filters, format, templateId, selectedYear, navigate])

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

  return (
    <div>
      <PageHeader
        title="Rapports"
        description="Génération de rapports comptables"
        actions={
          <button
            onClick={() => navigate('/ged?type=rapport')}
            className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-text rounded-lg text-sm hover:bg-surface-hover transition-colors"
          >
            <ExternalLink size={15} />
            Voir dans la bibliothèque
          </button>
        }
      />

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
    </div>
  )
}
