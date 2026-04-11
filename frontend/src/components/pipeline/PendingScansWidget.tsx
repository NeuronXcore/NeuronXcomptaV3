import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Paperclip, ChevronDown, ChevronRight, Loader2, Stamp,
  FileText, Search, Wand2,
} from 'lucide-react'
import { cn, formatCurrency, isReconstitue, MOIS_FR } from '@/lib/utils'
import { useJustificatifs, useJustificatifOperationSuggestions } from '@/hooks/useJustificatifs'
import { useManualAssociate } from '@/hooks/useRapprochement'
import type { JustificatifInfo, OperationSuggestion } from '@/types'

const MAX_VISIBLE = 10
const HIGH_CONFIDENCE = 0.80
const LOW_CONFIDENCE = 0.60

function getScoreValue(score: unknown): number {
  if (typeof score === 'number') return score
  if (score && typeof score === 'object' && 'total' in score) return (score as { total: number }).total
  return 0
}

function scoreBadgeClass(score: number): string {
  const pct = score * 100
  if (pct >= HIGH_CONFIDENCE * 100) return 'bg-success/10 text-success'
  if (pct >= LOW_CONFIDENCE * 100) return 'bg-warning/10 text-warning'
  return 'bg-surface-hover text-text-muted'
}

/** Extrait année/mois d'un filename canonique `supplier_YYYYMMDD_amount.pdf` */
function extractYearMonth(filename: string): { year: number; month: number } | null {
  const m = filename.match(/_(\d{4})(\d{2})\d{2}_/)
  if (!m) return null
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) }
}

interface PendingScanCardProps {
  scan: JustificatifInfo
}

function PendingScanCard({ scan }: PendingScanCardProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: suggestions, isLoading: suggLoading } =
    useJustificatifOperationSuggestions(scan.filename)
  const associateMutation = useManualAssociate()

  const topSuggestion: OperationSuggestion | null = useMemo(() => {
    if (!suggestions || suggestions.length === 0) return null
    return suggestions[0]
  }, [suggestions])

  const topScore = topSuggestion ? getScoreValue(topSuggestion.score) : 0
  const isHighConfidence = topScore >= HIGH_CONFIDENCE
  const isMediumConfidence = topScore >= LOW_CONFIDENCE && !isHighConfidence
  const isLowConfidence = topScore < LOW_CONFIDENCE

  const handleAssociate = () => {
    if (!topSuggestion) return
    // Pour les scores faibles (<60%), demander confirmation avant d'associer —
    // le backend rapprochement peut mal scorer quand la date est hors fenêtre
    // alors que fournisseur + montant matchent parfaitement.
    if (isLowConfidence) {
      const ok = window.confirm(
        `Score faible (${Math.round(topScore * 100)}%). Associer quand même ?\n\n` +
        `${scan.filename}\n→ ${topSuggestion.libelle}\n${topSuggestion.date} · ${formatCurrency(topSuggestion.debit || topSuggestion.credit || 0)}`
      )
      if (!ok) return
    }
    associateMutation.mutate(
      {
        justificatif_filename: scan.filename,
        operation_file: topSuggestion.operation_file,
        operation_index: topSuggestion.operation_index,
        rapprochement_score: topScore,
        ventilation_index: topSuggestion.ventilation_index ?? undefined,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['justificatif-operation-suggestions'] })
          queryClient.invalidateQueries({ queryKey: ['justificatif-reverse-lookup'] })
          toast.success(`Associé : ${scan.filename}`)
        },
        onError: (err: Error) => {
          toast.error(err.message || "Erreur lors de l'association")
        },
      }
    )
  }

  const handleOpenManual = () => {
    const ym = extractYearMonth(scan.filename)
    const params = new URLSearchParams({ filter: 'sans' })
    if (ym) {
      params.set('year', String(ym.year))
      params.set('month', String(ym.month))
    }
    navigate(`/justificatifs?${params.toString()}`)
  }

  const thumbUrl = `/api/ged/documents/${encodeURIComponent(`data/justificatifs/en_attente/${scan.filename}`)}/thumbnail`
  const isFacsimile = isReconstitue(scan.filename)

  return (
    <div className="flex items-stretch gap-3 bg-background rounded-md px-3 py-2 hover:bg-background/70 transition-colors">
      {/* Thumbnail */}
      <div className="shrink-0 w-10 h-14 bg-white rounded overflow-hidden border border-border flex items-center justify-center">
        <img
          src={thumbUrl}
          alt=""
          className="w-full h-full object-contain"
          onError={(e) => {
            const img = e.target as HTMLImageElement
            img.style.display = 'none'
            const fallback = img.nextElementSibling as HTMLElement | null
            if (fallback) fallback.classList.remove('hidden')
          }}
        />
        <FileText size={16} className="hidden text-text-muted" />
      </div>

      {/* Infos — tout sur une seule ligne : filename + OCR résumé (orange) + badges */}
      <div className="flex-1 min-w-0 flex items-center justify-center">
        <div className="flex items-center gap-2 min-w-0 w-full">
          <span className="text-sm font-medium text-text truncate shrink" title={scan.filename}>
            {scan.filename}
          </span>
          <span className="text-xs text-orange-400 whitespace-nowrap shrink-0">
            {scan.ocr_supplier || '—'} · {scan.ocr_date || scan.date} · {scan.ocr_amount != null ? formatCurrency(scan.ocr_amount) : '—'}
          </span>
          {scan.auto_renamed && (
            <span
              className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-primary text-white shrink-0 cursor-help"
              title={`Nom de fichier généré automatiquement depuis l'OCR${scan.original_filename ? ` — original : ${scan.original_filename}` : ''}`}
            >
              auto
            </span>
          )}
          {isFacsimile && (
            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-purple-500 text-white shrink-0 flex items-center gap-1">
              <Stamp size={10} /> fac-similé
            </span>
          )}
        </div>
      </div>

      {/* Suggestion top-1 + actions */}
      <div className="shrink-0 flex items-center gap-2">
        {suggLoading ? (
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <Loader2 size={12} className="animate-spin" />
            Recherche...
          </div>
        ) : topSuggestion ? (
          <>
            <div className="flex flex-col items-end max-w-[200px]">
              <div className="flex items-center gap-1.5">
                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', scoreBadgeClass(topScore))}>
                  {Math.round(topScore * 100)}%
                </span>
                <span className="text-xs text-text truncate max-w-[150px]" title={topSuggestion.libelle}>
                  {topSuggestion.libelle}
                </span>
              </div>
              <span className="text-[10px] text-text-muted">
                {topSuggestion.date} · {formatCurrency(topSuggestion.debit || topSuggestion.credit || 0)}
              </span>
            </div>
            <button
              onClick={handleAssociate}
              disabled={associateMutation.isPending}
              title={
                isHighConfidence
                  ? `Associer (score ${Math.round(topScore * 100)}%)`
                  : isMediumConfidence
                    ? `Associer — score moyen ${Math.round(topScore * 100)}%`
                    : `Associer — score faible ${Math.round(topScore * 100)}%, confirmation demandée`
              }
              className={cn(
                'text-xs font-medium px-3 py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-background',
                isHighConfidence && 'bg-success hover:bg-success/90',
                isMediumConfidence && 'bg-warning hover:bg-warning/90',
                isLowConfidence && 'bg-danger hover:bg-danger/90'
              )}
            >
              {associateMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            </button>
          </>
        ) : (
          <span className="text-xs text-text-muted italic">Aucun match</span>
        )}
        <button
          onClick={handleOpenManual}
          title="Traiter manuellement dans Justificatifs"
          className="p-1.5 text-text-muted hover:text-text bg-surface hover:bg-surface-hover rounded-md transition-colors"
        >
          <Search size={14} />
        </button>
      </div>
    </div>
  )
}

interface PendingScansWidgetProps {
  year: number
  month: number
}

export default function PendingScansWidget({ year, month }: PendingScansWidgetProps) {
  const navigate = useNavigate()
  const { data: allScans, isLoading } = useJustificatifs({
    status: 'en_attente',
    search: '',
    sort_by: 'date',
    sort_order: 'desc',
  })

  // Filtre par mois de la pipeline — la date est au format YYYY-MM-DD
  // (extraite du filename canonique ou du mtime). On compare l'année+mois.
  const filtered = useMemo(() => {
    if (!allScans) return []
    const yyyy = String(year)
    const mm = String(month).padStart(2, '0')
    return allScans.filter(s => {
      const d = s.ocr_date || s.date
      if (!d || d.length < 7) return false
      return d.slice(0, 4) === yyyy && d.slice(5, 7) === mm
    })
  }, [allScans, year, month])

  const { ocrScans, facsimiles } = useMemo(() => ({
    ocrScans: filtered.filter(s => !isReconstitue(s.filename)),
    facsimiles: filtered.filter(s => isReconstitue(s.filename)),
  }), [filtered])

  const totalCount = ocrScans.length + facsimiles.length
  const [expanded, setExpanded] = useState(true)

  const visibleOcr = ocrScans.slice(0, MAX_VISIBLE)
  const visibleFacsimiles = facsimiles.slice(0, MAX_VISIBLE)
  const overflowOcr = ocrScans.length - visibleOcr.length
  const overflowFacsimiles = facsimiles.length - visibleFacsimiles.length

  const monthLabel = `${MOIS_FR[month - 1]} ${year}`

  // Statut visuel (aligné sur le pattern PipelineStepCard : not_started/in_progress/complete)
  // Ici "complete" = aucun scan en attente pour ce mois ; "in_progress" = au moins 1
  const hasPending = totalCount > 0
  const circleClasses = hasPending
    ? 'bg-amber-900/50 text-amber-400 border border-amber-500'
    : 'bg-emerald-900/50 text-emerald-400 border border-emerald-500'
  const textClasses = hasPending ? 'text-amber-400' : 'text-emerald-400'

  // Mini progress bar : ratio inverse (0 pending = 100% "clean", N pending = progression incomplète)
  // On utilise un simple indicateur : rempli si 0, vide sinon.
  const barFill = hasPending ? 0 : 100
  const barColor = hasPending ? 'bg-amber-500' : 'bg-emerald-500'

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 size={14} className="animate-spin" />
          Chargement des scans en attente...
        </div>
      </div>
    )
  }

  // Cacher totalement le widget si aucun scan pour ce mois (évite le bruit)
  if (totalCount === 0) {
    return null
  }

  return (
    <div className="bg-surface border border-border rounded-lg mb-6 overflow-hidden">
      {/* Header — aligné sur le design PipelineStepCard */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-surface-hover transition-colors text-left"
      >
        {/* Cercle icône (comme les steps) */}
        <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0', circleClasses)}>
          <Paperclip size={18} />
        </div>

        {/* Titre + sous-titre mois */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text">Scans en attente d'association</span>
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15', textClasses)}>
              {totalCount}
            </span>
          </div>
          <div className="text-xs text-text-muted">
            {monthLabel} · {ocrScans.length} OCR{facsimiles.length > 0 ? ` · ${facsimiles.length} fac-similés` : ''}
          </div>
        </div>

        {/* Mini progress bar */}
        <div className="w-[120px] h-1.5 bg-gray-700 rounded-full overflow-hidden shrink-0">
          <div
            className={cn('h-full rounded-full transition-all duration-500', barColor)}
            style={{ width: `${barFill}%` }}
          />
        </div>

        {/* Progression texte */}
        <span className={cn('text-xs font-medium w-10 text-right shrink-0', textClasses)}>
          {barFill}%
        </span>

        {/* Chevron */}
        {expanded
          ? <ChevronDown size={16} className="text-text-muted shrink-0" />
          : <ChevronRight size={16} className="text-text-muted shrink-0" />
        }
      </button>

      {/* Body expandable */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          expanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="px-4 pb-4 pt-3 ml-14 border-t border-border space-y-4">
          {/* Section 1 — OCR récents */}
          {ocrScans.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                OCR récents
              </div>
              <div className="space-y-1.5">
                {visibleOcr.map(scan => (
                  <PendingScanCard key={scan.filename} scan={scan} />
                ))}
              </div>
              {overflowOcr > 0 && (
                <button
                  onClick={() => navigate(`/justificatifs?filter=sans&year=${year}&month=${month}`)}
                  className="text-xs text-primary hover:underline"
                >
                  Voir {overflowOcr} scan(s) supplémentaire(s) →
                </button>
              )}
            </div>
          )}

          {/* Section 2 — Fac-similés */}
          {facsimiles.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1.5">
                <Stamp size={11} />
                Fac-similés
              </div>
              <div className="space-y-1.5">
                {visibleFacsimiles.map(scan => (
                  <PendingScanCard key={scan.filename} scan={scan} />
                ))}
              </div>
              {overflowFacsimiles > 0 && (
                <button
                  onClick={() => navigate(`/justificatifs?filter=facsimile&year=${year}&month=${month}`)}
                  className="text-xs text-primary hover:underline"
                >
                  Voir {overflowFacsimiles} fac-similé(s) supplémentaire(s) →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
