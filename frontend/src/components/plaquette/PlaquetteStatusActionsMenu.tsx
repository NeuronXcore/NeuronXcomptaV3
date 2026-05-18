import { useState } from 'react'
import { CheckCircle2, Lock, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { usePatchPlaquetteStatus } from '@/hooks/usePlaquetteCheck'
import type { PlaquetteCheck } from '@/types'

interface PlaquetteStatusActionsMenuProps {
  check: PlaquetteCheck
  onOpenFinalize: () => void
}

/**
 * Boutons d'action contextuels selon le statut de la plaquette.
 *
 * - en_cours          → bouton primary "Passer en validation finale"
 * - validation_finale → outline "Revenir en cours" + primary "Finaliser et déclarer"
 * - declare           → bouton disabled "Exercice déclaré" avec tooltip prescription
 *
 * Session 39 P1.
 */
export function PlaquetteStatusActionsMenu({
  check,
  onOpenFinalize,
}: PlaquetteStatusActionsMenuProps) {
  const [confirmRevert, setConfirmRevert] = useState(false)
  const patchStatus = usePatchPlaquetteStatus(check.year)

  const handleValidationFinale = async () => {
    try {
      await patchStatus.mutateAsync({ new_status: 'validation_finale' })
      toast.success('Plaquette passée en validation finale — items verrouillés')
    } catch (e) {
      toast.error(`Échec : ${(e as Error).message}`)
    }
  }

  const handleRevert = async () => {
    try {
      await patchStatus.mutateAsync({ new_status: 'en_cours' })
      toast.success('Plaquette repassée en cours — items à nouveau éditables')
      setConfirmRevert(false)
    } catch (e) {
      toast.error(`Échec : ${(e as Error).message}`)
    }
  }

  if (check.status === 'en_cours') {
    return (
      <button
        type="button"
        onClick={handleValidationFinale}
        disabled={patchStatus.isPending}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
          'bg-primary text-white hover:bg-primary/90 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <CheckCircle2 size={14} />
        {patchStatus.isPending ? 'Passage…' : 'Passer en validation finale'}
      </button>
    )
  }

  if (check.status === 'validation_finale') {
    return (
      <div className="flex items-center gap-2">
        {!confirmRevert ? (
          <button
            type="button"
            onClick={() => setConfirmRevert(true)}
            disabled={patchStatus.isPending}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
              'border border-border text-text-muted hover:bg-surface hover:text-text transition-colors',
              'disabled:opacity-50',
            )}
            title="Repasser en édition libre (items à nouveau modifiables)"
          >
            <Undo2 size={14} />
            Revenir en cours
          </button>
        ) : (
          <div className="inline-flex items-center gap-1.5">
            <span className="text-xs text-text-muted italic">Déverrouiller ?</span>
            <button
              type="button"
              onClick={handleRevert}
              disabled={patchStatus.isPending}
              className="px-2 py-1 rounded-md text-xs font-medium bg-warning text-white hover:bg-warning/90 transition-colors disabled:opacity-50"
            >
              Confirmer
            </button>
            <button
              type="button"
              onClick={() => setConfirmRevert(false)}
              className="px-2 py-1 rounded-md text-xs font-medium border border-border text-text-muted hover:bg-surface"
            >
              Annuler
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onOpenFinalize}
          disabled={patchStatus.isPending}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
            'bg-emerald-600 text-white hover:bg-emerald-700 transition-colors',
            'disabled:opacity-50',
          )}
        >
          <Lock size={14} />
          Finaliser et déclarer
        </button>
      </div>
    )
  }

  // declare → bouton info disabled
  return (
    <button
      type="button"
      disabled
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
        'border border-emerald-500/30 bg-emerald-500/5 text-emerald-400/80',
        'cursor-not-allowed',
      )}
      title="Exercice déclaré — figé jusqu'à prescription (art. L169 LPF, 4 ans)"
    >
      <Lock size={14} />
      Exercice déclaré
    </button>
  )
}
