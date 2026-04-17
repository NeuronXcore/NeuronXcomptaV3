import { Inbox, AlertCircle, X, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface Props {
  toastId: string
  visible: boolean
  filename: string
  originalFilename?: string | null
  onClickOpen: () => void
}

/**
 * Toast riche persistent d'arrivée d'un fichier non-canonique dans sandbox/.
 *
 * Miroir amber de `SandboxArrivalToast` (qui est pour les events `processed`
 * — canoniques traités automatiquement). Ici c'est pour `arrived` :
 * le fichier reste dans sandbox/ et attend une action manuelle.
 *
 * Design :
 * - Card 380px, dégradé amber→orange, icône Inbox
 * - Clic → navigue vers /ocr?tab=sandbox (l'onglet Sandbox)
 * - Bouton X pour dismiss (duration: Infinity, comme le SandboxArrivalToast)
 */
export default function SandboxPendingToast({
  toastId,
  visible,
  filename,
  originalFilename,
  onClickOpen,
}: Props) {
  return (
    <div
      className={cn(
        'relative max-w-[420px] w-full rounded-2xl p-[1px] shadow-2xl cursor-pointer group',
        'bg-gradient-to-br from-amber-500/60 via-orange-500/40 to-amber-400/60',
        visible ? 'animate-enter' : 'animate-leave',
      )}
      onClick={() => {
        toast.dismiss(toastId)
        onClickOpen()
      }}
      role="button"
      tabIndex={0}
      aria-label={`Nouveau fichier en attente : ${filename}`}
    >
      <div className="rounded-2xl bg-background/95 backdrop-blur-sm px-4 py-3.5 flex items-start gap-3">
        {/* Icône Inbox animée */}
        <div className="shrink-0 relative">
          <div className="w-11 h-11 rounded-xl border flex items-center justify-center bg-gradient-to-br from-amber-500/20 to-orange-500/20 border-amber-500/40">
            <Inbox size={20} className="text-amber-300" />
          </div>
          <span className="absolute inset-0 rounded-xl border-2 border-amber-400/60 animate-ping-slow pointer-events-none" />
        </div>

        {/* Contenu */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <AlertCircle size={12} className="shrink-0 text-amber-300" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              À renommer avant OCR
            </span>
          </div>
          <div
            className="text-sm font-medium text-text truncate"
            title={originalFilename || filename}
          >
            {originalFilename || filename}
          </div>
          <div className="mt-1 text-[11px] text-text-muted leading-snug">
            Nom non-canonique · le fichier reste dans la boîte d'arrivée jusqu'à
            renommage manuel.
          </div>

          <div className="flex items-center gap-1 mt-2 text-[11px] font-medium text-amber-300 group-hover:gap-1.5 transition-all">
            Ouvrir la boîte d'arrivée
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
