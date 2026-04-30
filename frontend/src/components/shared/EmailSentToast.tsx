import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface Props {
  toastId: string
  visible: boolean
  destinatairesCount: number
  attachmentsCount: number
  sizeMb: number
}

export default function EmailSentToast({
  toastId,
  visible,
  destinatairesCount,
  attachmentsCount,
  sizeMb,
}: Props) {
  const handleDismiss = () => toast.dismiss(toastId)

  return (
    <div
      className={cn(
        'relative w-[380px] bg-surface border border-border/50 rounded-xl p-4 pl-5 flex items-start gap-4 overflow-hidden shadow-lg',
        visible ? 'animate-enter' : 'animate-leave',
      )}
    >
      {/* Accent gauche gradient indigo → sky */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
        style={{ background: 'linear-gradient(to bottom, #6366F1, #38BDF8)' }}
      />

      {/* Icône boîte aux lettres animée */}
      <div className="relative shrink-0 w-12 h-12 rounded-[12px] bg-gradient-to-br from-[#E0E7FF] to-[#DBEAFE] flex items-center justify-center">
        {/* Anneaux pulsants */}
        <div
          className="absolute inset-[-4px] rounded-[16px] border-[1.5px] border-[#6366F1]"
          style={{ animation: 'nx-mailbox-glow 2.4s ease-out infinite', opacity: 0 }}
        />
        <div
          className="absolute inset-[-4px] rounded-[16px] border-[1.5px] border-[#38BDF8]"
          style={{ animation: 'nx-mailbox-glow 2.4s ease-out 1.2s infinite', opacity: 0 }}
        />

        {/* SVG Mailbox custom */}
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          {/* Poteau */}
          <rect x="14.5" y="22" width="3" height="8" rx="0.5" fill="#6366F1" />
          {/* Corps de la boîte (arrière) */}
          <path
            d="M5 13 Q5 9 9 9 L23 9 Q27 9 27 13 L27 23 Q27 24 26 24 L6 24 Q5 24 5 23 Z"
            fill="#6366F1"
          />
          {/* Porte avant */}
          <path
            d="M5 13 Q5 9 9 9 L17 9 L17 24 L6 24 Q5 24 5 23 Z"
            fill="#4F46E5"
          />
          {/* Poignée porte */}
          <circle cx="14" cy="17" r="0.8" fill="#A5B4FC" />
          {/* Slot d'entrée (ligne horizontale sur la porte) */}
          <line x1="7" y1="13" x2="15" y2="13" stroke="#3730A3" strokeWidth="0.7" strokeLinecap="round" />

          {/* Drapeau (animation raise après l'arrivée de la lettre) */}
          <g style={{
            transformOrigin: '27px 17px',
            animation: 'nx-mailbox-flag 1.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          }}>
            <rect x="27" y="13" width="3.5" height="4" rx="0.4" fill="#EF4444" />
            <rect x="26.7" y="13" width="0.7" height="4" fill="#B91C1C" />
          </g>

          {/* Lettre animée — vole depuis le haut-gauche, entre dans le slot, disparaît */}
          <g style={{
            transformOrigin: '11px 9px',
            animation: 'nx-mailbox-letter 1s cubic-bezier(0.4, 0, 0.6, 1) forwards',
          }}>
            <rect x="6" y="3" width="10" height="7" rx="0.6" fill="white" stroke="#6366F1" strokeWidth="0.5" />
            <path d="M6 3 L11 7 L16 3" stroke="#6366F1" strokeWidth="0.5" fill="none" strokeLinejoin="round" />
          </g>
        </svg>
      </div>

      {/* Contenu */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <p className="text-sm font-semibold text-text">Email envoyé au comptable</p>
          <button
            onClick={handleDismiss}
            aria-label="Fermer"
            className="shrink-0 -mt-0.5 -mr-0.5 text-text-muted/70 hover:text-text transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">
          Distribué à <span className="font-semibold text-text">{destinatairesCount}</span>{' '}
          destinataire{destinatairesCount > 1 ? 's' : ''}.
        </p>

        {/* Pills méta */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#E0E7FF] text-[#4338CA]">
            {attachmentsCount} pièce{attachmentsCount > 1 ? 's' : ''} jointe{attachmentsCount > 1 ? 's' : ''}
          </span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#DBEAFE] text-[#1E40AF] tabular-nums">
            {sizeMb.toFixed(1)} Mo
          </span>
        </div>
      </div>
    </div>
  )
}
