import { ScanLine, Sparkles, X, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn, formatCurrency } from '@/lib/utils'

interface Props {
  toastId: string
  visible: boolean
  filename: string
  supplier?: string | null
  bestDate?: string | null
  bestAmount?: number | null
  autoRenamed?: boolean
  originalFilename?: string | null
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
  onClickOpen,
}: Props) {
  const formatDateDisplay = (iso: string | null | undefined): string => {
    if (!iso || iso.length < 10) return '—'
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  }

  return (
    <div
      className={cn(
        'relative max-w-[420px] w-full rounded-2xl p-[1px] shadow-2xl cursor-pointer group',
        // Gradient border violet→indigo
        'bg-gradient-to-br from-violet-500/60 via-indigo-500/40 to-violet-400/60',
        visible ? 'animate-enter' : 'animate-leave',
      )}
      onClick={() => {
        toast.dismiss(toastId)
        onClickOpen()
      }}
      role="button"
      tabIndex={0}
      aria-label={`Nouveau scan : ${filename}`}
    >
      <div className="rounded-2xl bg-background/95 backdrop-blur-sm px-4 py-3.5 flex items-start gap-3">
        {/* Icône animée */}
        <div className="shrink-0 relative">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/40 flex items-center justify-center">
            <ScanLine size={20} className="text-violet-300" />
          </div>
          {/* Pulse ring */}
          <span className="absolute inset-0 rounded-xl border-2 border-violet-400/60 animate-ping-slow pointer-events-none" />
        </div>

        {/* Contenu */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Sparkles size={12} className="text-violet-300 shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">
              Nouveau scan re&#xe7;u
            </span>
          </div>
          <div className="text-sm font-medium text-text truncate" title={filename}>
            {filename}
          </div>
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

          <div className="flex items-center gap-1 mt-2 text-[11px] text-violet-300 font-medium group-hover:gap-1.5 transition-all">
            Voir dans l&#39;historique
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
