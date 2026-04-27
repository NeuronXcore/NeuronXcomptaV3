import { X, TrendingDown, Info, ArrowRight, Loader2, Landmark, ExternalLink } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDotationVirtualDetail, useDotationRef } from '@/hooks/useAmortissements'
import { useImmobilisationDrawerStore } from '@/stores/immobilisationDrawerStore'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import type { DotationImmoRow } from '@/types'

interface Props {
  year: number
  isOpen: boolean
  onClose: () => void
}

export default function DotationsVirtualDrawer({ year, isOpen, onClose }: Props) {
  const navigate = useNavigate()
  const setYear = useFiscalYearStore((s) => s.setYear)
  const openImmoDrawer = useImmobilisationDrawerStore((s) => s.open)
  const { data: detail, isLoading } = useDotationVirtualDetail(year)
  const { data: dotationRef } = useDotationRef(year)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const goToRegister = () => {
    setYear(year)
    navigate('/amortissements')
  }

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[650px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <TrendingDown size={18} className="text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-text">Dotations aux amortissements</h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                  calculé
                </span>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                Exercice {year} · source amortissement_service
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-md hover:bg-surface flex items-center justify-center text-text-muted hover:text-text">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <SkeletonLoader />
          ) : !detail || detail.nb_immos_actives === 0 ? (
            <EmptyState year={year} onGoToRegister={goToRegister} />
          ) : (
            <>
              {/* 3 MetricCards */}
              <div className="px-5 py-4 grid grid-cols-3 gap-2.5">
                <MetricCard label="Dotation brute" value={formatCurrency(detail.total_brute)} />
                <MetricCard label="Déductible" value={formatCurrency(detail.total_deductible)} accent />
                <MetricCard label="Immos actives" value={String(detail.nb_immos_actives)} />
              </div>

              {/* Bandeau info */}
              <div className="mx-5 mb-4 px-3 py-2.5 bg-blue-500/10 border border-blue-500/20 rounded-md flex items-start gap-2.5">
                <Info size={14} className="shrink-0 mt-0.5 text-blue-400" />
                <p className="text-xs text-blue-400 leading-relaxed">
                  Ces lignes sont virtuelles — elles ne proviennent pas du relevé bancaire.
                  Elles remplacent les sorties de trésorerie de la catégorie{' '}
                  <code className="font-mono bg-background/40 px-1 rounded text-[11px]">Immobilisations</code>
                  {' '}dans le calcul du BNC.
                </p>
              </div>

              {/* Liste immos */}
              <div className="px-5 pb-4">
                <p className="text-xs text-text-muted uppercase tracking-wide font-medium mb-2.5">
                  Immobilisations contributives
                </p>
                {detail.immos.map((immo) => (
                  <ImmoCard
                    key={immo.immobilisation_id}
                    immo={immo}
                    onClick={() => openImmoDrawer(immo.immobilisation_id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {detail && detail.nb_immos_actives > 0 && (
          <div className="px-5 py-3 bg-background border-t border-border flex items-center justify-between gap-3 shrink-0">
            <p className="text-xs text-text-muted">
              {detail.nb_immos_actives} immos · total déductible{' '}
              <span className="font-medium text-primary">
                {formatCurrency(detail.total_deductible)}
              </span>
            </p>
            <div className="flex items-center gap-2">
              {dotationRef && (
                <button
                  onClick={() => navigate(
                    `/editor?file=${encodeURIComponent(dotationRef.filename)}&highlight=${dotationRef.index}&from=visualization`
                  )}
                  className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-surface flex items-center gap-1 text-text"
                  title={`OD enregistrée dans ${dotationRef.filename}`}
                >
                  Voir l'OD <ExternalLink size={11} />
                </button>
              )}
              <button
                onClick={goToRegister}
                className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-surface flex items-center gap-1 text-text"
              >
                Voir le registre <ArrowRight size={12} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Sous-composants ───

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg border p-3',
      accent ? 'bg-primary/10 border-primary/30' : 'bg-surface border-border',
    )}>
      <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">{label}</p>
      <p className={cn('text-lg font-semibold tabular-nums', accent ? 'text-primary' : 'text-text')}>
        {value}
      </p>
    </div>
  )
}

function Stat({ label, value, warning, success }: { label: string; value: string; warning?: boolean; success?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className={cn(
        'text-xs font-medium tabular-nums',
        warning && 'text-amber-400',
        success && 'text-emerald-400',
        !warning && !success && 'text-text',
      )}>
        {value}
      </p>
    </div>
  )
}

function ImmoCard({ immo, onClick }: { immo: DotationImmoRow; onClick?: () => void }) {
  const STATUT_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
    en_cours: { label: 'en cours', bg: '#EAF3DE', text: '#27500A' },
    complement: { label: 'complément', bg: '#FAEEDA', text: '#633806' },
    derniere: { label: 'dernière', bg: '#EAF3DE', text: '#27500A' },
    cedee: { label: 'cédée', bg: '#FCEBEB', text: '#791F1F' },
  }
  const statutConfig = STATUT_CONFIG[immo.statut] ?? STATUT_CONFIG.en_cours

  const isPartialQuotePart = immo.quote_part_pro < 100

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      title={onClick ? 'Voir la fiche immobilisation' : undefined}
      className={cn(
        'bg-surface border border-border rounded-md p-3 mb-2',
        onClick && 'cursor-pointer hover:border-primary/40 hover:bg-surface-hover transition-colors',
      )}
    >
      <div className="flex justify-between items-start gap-3 mb-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium text-text truncate">{immo.designation}</p>
            {immo.is_reprise && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-medium">
                Reprise {immo.exercice_entree_neuronx}
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Acquis le {formatDate(immo.date_acquisition)} · {immo.mode} {immo.duree} ans · base {formatCurrency(immo.base_amortissable)}
          </p>
        </div>
        <span
          className="text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0"
          style={{ background: statutConfig.bg, color: statutConfig.text }}
        >
          {statutConfig.label}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-xs">
        <Stat label="VNC début" value={formatCurrency(immo.vnc_debut)} />
        <Stat label="Dotation brute" value={formatCurrency(immo.dotation_brute)} />
        <Stat label="Quote-part" value={`${immo.quote_part_pro.toFixed(0)} %`} warning={isPartialQuotePart} />
        <Stat label="VNC fin" value={formatCurrency(immo.vnc_fin)} success={immo.vnc_fin === 0} />
      </div>
    </div>
  )
}

function SkeletonLoader() {
  return (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-16 rounded-lg bg-surface border border-border animate-pulse" />
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-24 rounded-md bg-surface border border-border animate-pulse" />
        ))}
      </div>
      <div className="flex items-center justify-center pt-4">
        <Loader2 size={18} className="animate-spin text-primary" />
      </div>
    </div>
  )
}

function EmptyState({ year, onGoToRegister }: { year: number; onGoToRegister: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-5 text-center">
      <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mb-3">
        <Landmark size={20} className="text-text-muted" />
      </div>
      <p className="text-sm font-medium text-text mb-1">Aucune dotation pour {year}</p>
      <p className="text-xs text-text-muted max-w-xs mb-4">
        Aucune immobilisation active n'a généré de dotation cette année.
      </p>
      <button
        onClick={onGoToRegister}
        className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-surface flex items-center gap-1 text-text"
      >
        Voir le registre <ArrowRight size={12} />
      </button>
    </div>
  )
}
