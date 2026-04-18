import { ScanLine, Sparkles, X, ArrowRight, Link2, Lock, Trophy } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn, formatCurrency } from '@/lib/utils'

/**
 * Confetti burst — 8 particules qui explosent en étoile autour de l'icône.
 * Angles équidistants (0° à 315° par 45°) à un rayon de ~42px, couleurs variées.
 * Animation one-shot 900ms via `@keyframes victory-confetti` (index.css).
 */
const CONFETTI_PARTICLES: Array<{ cx: number; cy: number; cr: number; color: string; delay: number }> = [
  { cx:  42, cy:   0, cr: 180, color: 'bg-emerald-400', delay: 0   },
  { cx:  30, cy: -30, cr: 220, color: 'bg-lime-400',    delay: 30  },
  { cx:   0, cy: -42, cr: 160, color: 'bg-yellow-300',  delay: 60  },
  { cx: -30, cy: -30, cr: 200, color: 'bg-amber-300',   delay: 90  },
  { cx: -42, cy:   0, cr: 180, color: 'bg-teal-400',    delay: 40  },
  { cx: -30, cy:  30, cr: 240, color: 'bg-rose-300',    delay: 70  },
  { cx:   0, cy:  42, cr: 160, color: 'bg-sky-300',     delay: 20  },
  { cx:  30, cy:  30, cr: 200, color: 'bg-violet-400',  delay: 50  },
]

function ConfettiBurst() {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {CONFETTI_PARTICLES.map((p, i) => (
        <span
          key={i}
          className={cn('absolute left-1/2 top-1/2 w-1.5 h-1.5 rounded-sm animate-victory-confetti', p.color)}
          style={{
            ['--cx' as string]: `${p.cx}px`,
            ['--cy' as string]: `${p.cy}px`,
            ['--cr' as string]: `${p.cr}deg`,
            animationDelay: `${p.delay}ms`,
          }}
        />
      ))}
    </div>
  )
}

interface Props {
  toastId: string
  visible: boolean
  filename: string
  supplier?: string | null
  bestDate?: string | null
  bestAmount?: number | null
  autoRenamed?: boolean
  originalFilename?: string | null
  autoAssociated?: boolean
  operationLibelle?: string | null
  operationDate?: string | null
  operationMontant?: number | null
  operationLocked?: boolean
  onClickOpen: () => void
}

/**
 * Toast riche et moderne d'arrivée d'un nouveau scan via le watchdog sandbox.
 *
 * Design :
 * - Card 380×140, fond dégradé violet→indigo, glow ring subtil
 * - Icône scanner animée (pulse)
 * - Supplier + montant + date OCR si disponibles
 * - Badge "auto-renommé" (suppliers + dates corrigées depuis le filename source)
 * - Clic → onClickOpen (navigation vers /ocr Historique tri scan_date + highlight)
 * - Bouton X pour dismiss manuel (persistant, duration: Infinity)
 */
export default function SandboxArrivalToast({
  toastId,
  visible,
  filename,
  supplier,
  bestDate,
  bestAmount,
  autoRenamed,
  originalFilename,
  autoAssociated,
  operationLibelle,
  operationDate,
  operationMontant,
  operationLocked,
  onClickOpen,
}: Props) {
  const formatDateDisplay = (iso: string | null | undefined): string => {
    if (!iso || iso.length < 10) return '—'
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  }

  const accent = autoAssociated
    ? {
        gradient: 'bg-gradient-to-br from-emerald-400/80 via-lime-400/60 to-yellow-300/70',
        iconBg: 'bg-gradient-to-br from-emerald-500/30 to-yellow-300/30 border-emerald-400/60',
        iconColor: 'text-yellow-200',
        ring: 'border-emerald-300/80',
        label: 'text-emerald-200',
        cta: 'text-emerald-100',
        LabelIcon: Trophy,
        title: "C'est dans la boîte !",
        ctaText: "Voir l'opération",
      }
    : {
        gradient: 'bg-gradient-to-br from-violet-500/60 via-indigo-500/40 to-violet-400/60',
        iconBg: 'bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border-violet-500/40',
        iconColor: 'text-violet-300',
        ring: 'border-violet-400/60',
        label: 'text-violet-300',
        cta: 'text-violet-300',
        LabelIcon: Sparkles,
        title: 'Nouveau scan reçu',
        ctaText: "Voir en attente",
      }

  const enterAnimation = autoAssociated ? 'animate-victory-bounce' : 'animate-enter'

  return (
    <div
      className={cn(
        'relative max-w-[420px] w-full rounded-2xl p-[1px] shadow-2xl cursor-pointer group',
        accent.gradient,
        visible ? enterAnimation : 'animate-leave',
      )}
      onClick={() => {
        toast.dismiss(toastId)
        onClickOpen()
      }}
      role="button"
      tabIndex={0}
      aria-label={`${accent.title} : ${filename}`}
    >
      <div className="rounded-2xl bg-background/95 backdrop-blur-sm px-4 py-3.5 flex items-start gap-3">
        {/* Icône animée */}
        <div className="shrink-0 relative">
          <div className={cn('w-11 h-11 rounded-xl border flex items-center justify-center', accent.iconBg)}>
            {autoAssociated ? (
              <Trophy size={20} className={accent.iconColor} />
            ) : (
              <ScanLine size={20} className={accent.iconColor} />
            )}
          </div>
          <span
            className={cn(
              'absolute inset-0 rounded-xl border-2 pointer-events-none',
              accent.ring,
              autoAssociated ? 'animate-victory-ring' : 'animate-ping-slow',
            )}
          />
          {autoAssociated && <ConfettiBurst />}
        </div>

        {/* Contenu */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <accent.LabelIcon size={12} className={cn('shrink-0', accent.label)} />
            <span className={cn('text-[11px] font-semibold uppercase tracking-wider', accent.label)}>
              {accent.title}
            </span>
          </div>
          <div className="text-sm font-medium text-text truncate" title={originalFilename || filename}>
            {originalFilename || filename}
          </div>
          {autoRenamed && originalFilename && originalFilename !== filename && (
            <div className="text-[11px] text-text-muted truncate" title={filename}>
              → {filename}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1 text-[11px] text-text-muted">
            {supplier ? (
              <span className="truncate font-medium text-orange-400" title={supplier}>
                {supplier}
              </span>
            ) : (
              <span className="italic">fournisseur inconnu</span>
            )}
            {bestDate && (
              <>
                <span>&middot;</span>
                <span>{formatDateDisplay(bestDate)}</span>
              </>
            )}
            {bestAmount != null && (
              <>
                <span>&middot;</span>
                <span className="font-semibold text-text">{formatCurrency(bestAmount)}</span>
              </>
            )}
          </div>
          {autoRenamed && originalFilename && (
            <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
              <Sparkles size={9} /> auto-renomm&#xe9;
            </div>
          )}

          {autoAssociated && operationLibelle && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-1.5">
              <Link2 size={11} className="shrink-0 text-emerald-300 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className="text-emerald-300 font-medium truncate flex-1" title={operationLibelle}>
                    {operationLibelle}
                  </div>
                  {operationLocked && (
                    <span
                      className="shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-warning/20 text-warning font-semibold uppercase tracking-wider"
                      title="Opération verrouillée automatiquement (score ≥ 0.95)"
                    >
                      <Lock size={8} /> locked
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-text-muted mt-0.5">
                  {operationDate && <span>{formatDateDisplay(operationDate)}</span>}
                  {operationMontant != null && (
                    <>
                      <span>&middot;</span>
                      <span className="font-semibold text-text">{formatCurrency(operationMontant)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className={cn('flex items-center gap-1 mt-2 text-[11px] font-medium group-hover:gap-1.5 transition-all', accent.cta)}>
            {accent.ctaText}
            <ArrowRight size={11} />
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            toast.dismiss(toastId)
          }}
          className="shrink-0 p-1 text-text-muted hover:text-text rounded-md hover:bg-surface transition-colors"
          aria-label="Fermer"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
