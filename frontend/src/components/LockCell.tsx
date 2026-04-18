import { useState } from 'react'
import { Lock, LockOpen, ShieldCheck, MousePointerClick } from 'lucide-react'
import toast from 'react-hot-toast'
import { useToggleLock } from '@/hooks/useToggleLock'
import { UnlockConfirmModal } from './UnlockConfirmModal'

interface Props {
  filename: string
  index: number
  locked: boolean
  hasJustificatif: boolean
}

export function LockCell({ filename, index, locked, hasJustificatif }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const toggleLock = useToggleLock()

  // Affiche aussi quand l'op est déjà verrouillée sans justif direct
  // (cas parent ventilé auto-locké via une sous-ligne ≥0.95) pour permettre le déverrouillage.
  if (!hasJustificatif && !locked) return null

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (locked) {
      setConfirmOpen(true)
    } else {
      toggleLock.mutate(
        { filename, index, locked: true },
        {
          onSuccess: () => toast.success('Opération verrouillée'),
          onError: () => toast.error('Erreur lors du verrouillage'),
        }
      )
    }
  }

  const handleConfirmUnlock = () => {
    toggleLock.mutate(
      { filename, index, locked: false },
      {
        onSuccess: () => {
          setConfirmOpen(false)
          toast.success('Opération déverrouillée')
        },
        onError: () => toast.error('Erreur lors du déverrouillage'),
      }
    )
  }

  return (
    <>
      <span className="relative inline-flex group/lock">
        <button
          onClick={handleClick}
          aria-label={locked ? 'Opération verrouillée — cliquer pour déverrouiller' : 'Cliquer pour verrouiller'}
          className="p-1 rounded hover:bg-surface-hover transition-colors"
        >
          {locked ? (
            <Lock className="w-3.5 h-3.5 text-warning" />
          ) : (
            <LockOpen className="w-3.5 h-3.5 text-text-muted/40 group-hover/lock:text-text-muted transition-colors" />
          )}
        </button>

        {/* Tooltip custom — aligné à droite pour éviter le débordement (colonne en bord de tableau) */}
        <span
          role="tooltip"
          className={
            'pointer-events-none absolute bottom-full right-0 mb-2 z-50 ' +
            'w-60 rounded-lg shadow-xl border text-left ' +
            'opacity-0 translate-y-1 group-hover/lock:opacity-100 group-hover/lock:translate-y-0 ' +
            'transition-all duration-150 group-hover/lock:delay-150 ' +
            (locked
              ? 'bg-gradient-to-br from-amber-500 to-orange-500 border-amber-300/40 text-white'
              : 'bg-surface border-border text-text')
          }
        >
          <span className="flex items-center gap-2 px-3 pt-2.5">
            <span
              className={
                'inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 ' +
                (locked ? 'bg-white/20' : 'bg-warning/15 text-warning')
              }
            >
              {locked ? <ShieldCheck className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            </span>
            <span className="text-[12px] font-semibold leading-tight">
              {locked ? 'Association verrouillée' : 'Association non verrouillée'}
            </span>
          </span>
          <span className={'block px-3 pt-1.5 pb-2 text-[11px] leading-snug ' + (locked ? 'text-white/90' : 'text-text-muted')}>
            {locked
              ? 'Le rapprochement automatique ne peut plus toucher à ce justificatif tant que l’opération reste verrouillée.'
              : 'Verrouillez pour protéger ce justificatif contre l’écrasement par le rapprochement automatique.'}
          </span>
          <span className={'flex items-center gap-1.5 px-3 pb-2.5 text-[10.5px] font-medium ' + (locked ? 'text-white' : 'text-warning')}>
            <MousePointerClick className="w-3 h-3" />
            {locked ? 'Cliquer pour déverrouiller' : 'Cliquer pour verrouiller'}
          </span>
          {/* Flèche — positionnée sous le bouton (le bouton fait ~22px, donc right ~7px pour centrer la flèche dessous) */}
          <span
            className={
              'absolute top-full right-[7px] w-2 h-2 rotate-45 -mt-1 border-r border-b ' +
              (locked ? 'bg-orange-500 border-amber-300/40' : 'bg-surface border-border')
            }
          />
        </span>
      </span>

      <UnlockConfirmModal
        open={confirmOpen}
        onConfirm={handleConfirmUnlock}
        onCancel={() => setConfirmOpen(false)}
        loading={toggleLock.isPending}
      />
    </>
  )
}
