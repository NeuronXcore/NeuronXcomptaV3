import { useState, useCallback, useMemo, useEffect } from 'react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useNavigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/shared/PageHeader'
import ReportFilters from './ReportFilters'
import { useGenerateReport } from '@/hooks/useReports'
import { useCategories } from '@/hooks/useApi'
import { api } from '@/api/client'
import { MOIS_FR } from '@/lib/utils'
import type { ReportFiltersV2, ReportTemplate, ReportGenerateRequest } from '@/types'

const PSEUDO_UNCATEGORIZED = '__non_categorise__'

function buildReportTitle(
  selectedCategories: string[],
  allCategoriesCount: number,
  year?: number,
  month?: number,
  selectedSubcategories: string[] = [],
  allSubcategoriesCount: number = 0
): string {
  // Partie catégories
  const displayNames = selectedCategories.map(c =>
    c === PSEUDO_UNCATEGORIZED ? 'Non catégorisé' : c
  )
  let catPart: string
  if (displayNames.length === 0) {
    catPart = 'Rapport'
  } else if (displayNames.length === allCategoriesCount) {
    catPart = 'Toutes catégories'
  } else if (displayNames.length <= 4) {
    catPart = displayNames.join(', ')
  } else {
    const displayed = displayNames.slice(0, 3).join(', ')
    catPart = `${displayed}… (+${displayNames.length - 3})`
  }

  // Partie sous-catégories (seulement si sous-ensemble strict des sous-cats disponibles)
  let subPart = ''
  if (
    selectedSubcategories.length > 0 &&
    selectedSubcategories.length < allSubcategoriesCount
  ) {
    if (selectedSubcategories.length <= 4) {
      subPart = selectedSubcategories.join(', ')
    } else {
      const displayed = selectedSubcategories.slice(0, 3).join(', ')
      subPart = `${displayed}… (+${selectedSubcategories.length - 3})`
    }
  }

  // Partie période
  let periodPart = ''
  if (year && month) {
    periodPart = `${MOIS_FR[month - 1]} ${year}`
  } else if (year) {
    periodPart = `${year}`
  }

  const headPart = subPart ? `${catPart} · ${subPart}` : catPart
  return periodPart ? `${headPart} — ${periodPart}` : headPart
}

export default function ReportsPage() {
  const navigate = useNavigate()
  const { selectedYear, setYear } = useFiscalYearStore()
  const [filters, setFilters] = useState<ReportFiltersV2>({ year: selectedYear })
  const [format, setFormat] = useState<'pdf' | 'csv' | 'excel' | 'xlsx'>('pdf')
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [selectedTemplate, setSelectedTemplate] = useState<ReportTemplate | undefined>()
  const [isBatchGenerating, setIsBatchGenerating] = useState(false)
  const [title, setTitle] = useState('')
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false)

  const generateMutation = useGenerateReport()
  const { data: categoriesData } = useCategories()

  // Build allCatNames count (mirrors ReportFilters logic)
  const allCatCount = useMemo(() => {
    const cats = categoriesData?.categories ?? []
    let count = cats.length
    if (!cats.some(c => c.name === 'Perso')) count++
    count++ // __non_categorise__
    return count
  }, [categoriesData])

  // Nombre total de sous-catégories disponibles pour les catégories sélectionnées
  // (miroir de la mémoïsation `subcategories` dans ReportFilters)
  const allSubCount = useMemo(() => {
    const cats = categoriesData?.categories ?? []
    const selected = filters.categories ?? []
    if (selected.length === 0) return 0
    return cats
      .filter(c => selected.includes(c.name))
      .reduce((acc, c) => acc + c.subcategories.length, 0)
  }, [categoriesData, filters.categories])

  const autoTitle = useMemo(() => {
    return buildReportTitle(
      filters.categories ?? [],
      allCatCount,
      filters.year,
      filters.month,
      filters.subcategories ?? [],
      allSubCount
    )
  }, [filters.categories, allCatCount, filters.year, filters.month, filters.subcategories, allSubCount])

  useEffect(() => {
    if (!titleManuallyEdited) {
      setTitle(autoTitle)
    }
  }, [autoTitle, titleManuallyEdited])

  const handleGenerate = () => {
    generateMutation.mutate(
      { format, filters, template_id: templateId, title: title || undefined },
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
          const monthTitle = buildReportTitle(
            filters.categories ?? [],
            allCatCount,
            year,
            month,
            filters.subcategories ?? [],
            allSubCount
          )
          await api.post<{ replaced?: string }>('/reports/generate', {
            format,
            filters: monthFilters,
            template_id: templateId,
            title: monthTitle,
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
  }, [filters, format, templateId, selectedYear, navigate, allCatCount, allSubCount])

  const handleFiltersChange = (f: ReportFiltersV2) => {
    setFilters(f)
    if (f.year) setYear(f.year)
  }

  const handleTitleChange = (value: string) => {
    setTitle(value)
    if (value === '') {
      setTitleManuallyEdited(false)
    } else {
      setTitleManuallyEdited(true)
    }
  }

  const handleTemplateSelect = (t: ReportTemplate) => {
    const yr = t.filters.year || selectedYear
    setFilters({
      ...t.filters,
      year: yr,
    })
    if (yr) setYear(yr)
    setFormat(t.format as 'pdf' | 'csv' | 'excel' | 'xlsx')
    setTemplateId(t.id)
    setSelectedTemplate(t)
    setTitleManuallyEdited(false)
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
        title={title}
        autoTitle={autoTitle}
        onTitleChange={handleTitleChange}
        selectedTemplate={selectedTemplate}
      />
    </div>
  )
}
