import { ScanLine, FileText, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface Props {
  toastId: string
  visible: boolean
  filename: string
  originalFilename?: string | null
}

/**
 * Toast « Analyse OCR en cours » — design scanner moderne.
 *
 * Animations :
 * - Ligne de scan horizontale qui balaie de haut en bas l'icône document
 *   (effet photocopieuse/OCR, infini, 2s par cycle)
 * - Anneau bleu/cyan pulsant autour de l'icône (2.5s ease-in-out)
 * - 3 dots progress (apparition séquentielle, 1.4s)
 * - Card gradient bleu→cyan cohérent avec l'état "en cours d'analyse"
 */
export default function SandboxScanningToast({
  toastId,
  visible,
  filename,
  originalFilename,
}: Props) {
  const displayName = originalFilename || filename

  return (
    <div
      className={cn(
        'relative max-w-[420px] w-full rounded-2xl p-[1px] shadow-2xl',
        'bg-gradient-to-br from-sky-500/60 via-cyan-500/40 to-sky-400/60',
        visible ? 'animate-enter' : 'animate-leave',
      )}
      role="status"
      aria-label={`Analyse OCR en cours : ${displayName}`}
    >
      <div className="rounded-2xl bg-background/95 backdrop-blur-sm px-4 py-3.5 flex items-start gap-3">
        {/* Icône scanner avec animation sweep */}
        <div className="shrink-0 relative w-11 h-11">
          {/* Anneau pulsant de fond */}
          <span
            className="absolute inset-0 rounded-xl border-2 border-sky-400/60 animate-scan-ring pointer-events-none"
            style={{ animationDuration: '2.5s' }}
          />

          {/* Box icône */}
          <div className="relative w-11 h-11 rounded-xl border bg-gradient-to-br from-sky-500/20 to-cyan-500/20 border-sky-500/40 flex items-center justify-center overflow-hidden">
            {/* Document icône (fond) */}
            <FileText size={18} className="text-sky-300/60" />

            {/* Overlay : ligne de scan horizontale qui balaie de haut en bas */}
            <span
              className="absolute left-1 right-1 h-[2px] rounded-full bg-gradient-to-r from-transparent via-cyan-300 to-transparent shadow-[0_0_8px_2px_rgba(103,232,249,0.7)] animate-scan-sweep pointer-events-none"
              aria-hidden
            />

            {/* Icône scanner au-dessus pour composition */}
            <ScanLine
              size={18}
              className="absolute text-cyan-300 drop-shadow-[0_0_4px_rgba(103,232,249,0.6)]"
            />
          </div>
        </div>

        {/* Contenu */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300">
              Analyse OCR
            </span>
            {/* 3 dots animés */}
            <span className="flex items-center gap-0.5" aria-hidden>
              <span
                className="w-1 h-1 rounded-full bg-cyan-300 animate-scan-dot"
                style={{ animationDelay: '0s' }}
              />
              <span
                className="w-1 h-1 rounded-full bg-cyan-300 animate-scan-dot"
                style={{ animationDelay: '0.2s' }}
              />
              <span
                className="w-1 h-1 rounded-full bg-cyan-300 animate-scan-dot"
                style={{ animationDelay: '0.4s' }}
              />
            </span>
          </div>
          <div className="text-sm font-medium text-text truncate" title={displayName}>
            {displayName}
          </div>
          <div className="mt-1 text-[11px] text-text-muted leading-snug">
            Extraction des données en cours — fournisseur, date, montant…
          </div>
        </div>

        {/* Close button (optionnel — dismiss manuel possible même si auto-dismiss au processed) */}
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
