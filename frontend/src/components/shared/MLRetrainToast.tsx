import { Zap, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface Props {
  toastId: string
  visible: boolean
  correctionsCount: number
  daysSince: number
  onClickRetrain: () => void
}

/**
 * Toast custom "Modèle IA à réentraîner" affiché 1× par session depuis AppLayout
 * quand la tâche auto `ml_retrain` existe. Persistant (duration Infinity) — se
 * ferme uniquement au clic utilisateur (Entraîner maintenant / Plus tard / X).
 *
 * Design :
 * - Card 360px, accent gauche violet #7F77DD
 * - Icône cerveau entourée de 2 anneaux pulsants décalés
 * - 2 pills : nb corrections (violet) + jours sans entraînement (amber)
 * - 2 boutons : primary violet (retrain) + ghost (dismiss)
 */
export default function MLRetrainToast({
  toastId,
  visible,
  correctionsCount,
  daysSince,
  onClickRetrain,
}: Props) {
  const handleRetrain = () => {
    toast.dismiss(toastId)
    onClickRetrain()
  }
  const handleDismiss = () => toast.dismiss(toastId)

  return (
    <div
      className={cn(
        'relative w-[360px] bg-surface border border-border/50 rounded-xl p-3.5 pl-5 flex items-start gap-3.5 overflow-hidden shadow-lg',
        visible ? 'animate-enter' : 'animate-leave',
      )}
    >
      {/* Barre accent gauche */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#7F77DD] rounded-l-xl" />

      {/* Icône cerveau avec anneaux pulsants */}
      <div className="relative shrink-0 w-10 h-10 rounded-[10px] bg-[#EEEDFE] flex items-center justify-center">
        <div
          className="absolute inset-[-4px] rounded-[14px] border-[1.5px] border-[#7F77DD]"
          style={{ animation: 'ml-pulse-ring 2s ease-out infinite', opacity: 0 }}
        />
        <div
          className="absolute inset-[-4px] rounded-[14px] border-[1.5px] border-[#7F77DD]"
          style={{ animation: 'ml-pulse-ring 2s ease-out 0.7s infinite', opacity: 0 }}
        />
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9.5 2C7.6 2 6 3.3 5.5 5.1C4.1 5.4 3 6.6 3 8c0 .9.4 1.7 1 2.3C3.4 11 3 11.9 3 13c0 1.9 1.3 3.5 3 3.9V18c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2v-1.1c1.7-.4 3-2 3-3.9 0-1.1-.4-2-1-2.7.6-.6 1-1.4 1-2.3 0-1.4-1.1-2.6-2.5-2.9C18 3.3 16.4 2 14.5 2c-1 0-1.9.4-2.5 1C11.4 2.4 10.5 2 9.5 2z"
            fill="#7F77DD"
          />
          <circle cx="9" cy="9" r="1.2" fill="#EEEDFE" />
          <circle cx="15" cy="9" r="1.2" fill="#EEEDFE" />
          <path
            d="M9 13.5c.8.8 2 1.3 3 1.3s2.2-.5 3-1.3"
            stroke="#EEEDFE"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Contenu */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <p className="text-sm font-medium text-text">Modèle IA à réentraîner</p>
          <button
            onClick={handleDismiss}
            aria-label="Fermer"
            className="shrink-0 -mt-0.5 -mr-0.5 text-text-muted/70 hover:text-text transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <p className="text-xs text-text-muted mb-2.5 leading-relaxed">
          {correctionsCount} correction{correctionsCount > 1 ? 's' : ''} depuis le dernier entraînement — le modèle peut être amélioré.
        </p>

        {/* Pills */}
        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#EEEDFE] text-[#534AB7]">
            {correctionsCount} correction{correctionsCount > 1 ? 's' : ''}
          </span>
          {daysSince < 999 && daysSince > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#854F0B]">
              {daysSince}j sans entraînement
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRetrain}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#7F77DD] text-white rounded-md text-xs font-medium hover:bg-[#534AB7] transition-colors"
          >
            <Zap size={11} />
            Entraîner maintenant
          </button>
          <button
            onClick={handleDismiss}
            className="px-2.5 py-1.5 text-xs text-text-muted border border-border rounded-md hover:bg-surface-hover transition-colors"
          >
            Plus tard
          </button>
        </div>
      </div>
    </div>
  )
}
