import { useState } from 'react'
import { AlertCircle, AlertOctagon, AlertTriangle, RotateCcw, Save, ShieldCheck, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { usePatchItemRisque, useResetItemRisque } from '@/hooks/usePlaquetteCheck'
import type { PlaquetteItem, RisqueNiveau } from '@/types'

interface PlaquetteRisqueOverrideModalProps {
  year: number
  item: PlaquetteItem
  onClose: () => void
}

const NIVEAU_OPTIONS: {
  value: RisqueNiveau
  label: string
  description: string
  Icon: typeof AlertCircle
  classes: string
}[] = [
  {
    value: 'faible',
    label: 'Faible',
    description: 'Déduction documentée, pas de zone sensible',
    Icon: ShieldCheck,
    classes: 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-400',
  },
  {
    value: 'modere',
    label: 'Modéré',
    description: '1-2 drivers de risque (catégorie sensible OU forfait)',
    Icon: AlertCircle,
    classes: 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10 text-amber-400',
  },
  {
    value: 'eleve',
    label: 'Élevé',
    description: '3 drivers cumulés OU montant élevé sur catégorie sensible',
    Icon: AlertTriangle,
    classes: 'border-orange-500/40 bg-orange-500/5 hover:bg-orange-500/10 text-orange-400',
  },
  {
    value: 'critique',
    label: 'Critique',
    description: 'Anomalie majeure — documentation défensive renforcée requise',
    Icon: AlertOctagon,
    classes: 'border-red-500/40 bg-red-500/5 hover:bg-red-500/10 text-red-400',
  },
]

/**
 * Modal d'édition manuelle du niveau de risque (motif obligatoire pour traçabilité).
 * Affiche le niveau auto-calculé en référence.
 *
 * Session 39 P2.
 */
export function PlaquetteRisqueOverrideModal({
  year,
  item,
  onClose,
}: PlaquetteRisqueOverrideModalProps) {
  const currentRisque = item.risque_fiscal
  const [niveau, setNiveau] = useState<RisqueNiveau>(currentRisque?.niveau || 'faible')
  const [motif, setMotif] = useState<string>(currentRisque?.overridden_motif || '')

  const patchMutation = usePatchItemRisque(year)
  const resetMutation = useResetItemRisque(year)

  const isOverridden = currentRisque && !currentRisque.auto_calcule
  const canSave = motif.trim().length > 0 && (niveau !== currentRisque?.niveau || !isOverridden)

  // Calcul du niveau auto (avant override) pour info
  const autoLevel: RisqueNiveau | null = currentRisque
    ? (currentRisque.auto_calcule ? currentRisque.niveau : null)
    : null
  const autoScore = currentRisque?.score ?? 0

  const handleSave = async () => {
    if (!canSave) return
    try {
      await patchMutation.mutateAsync({
        item_id: item.item_id,
        payload: { niveau, motif: motif.trim() },
      })
      toast.success(`Niveau forcé : ${NIVEAU_OPTIONS.find(o => o.value === niveau)?.label}`)
      onClose()
    } catch (e) {
      toast.error(`Échec : ${(e as Error).message}`)
    }
  }

  const handleReset = async () => {
    try {
      await resetMutation.mutateAsync(item.item_id)
      toast.success('Repassé en mode auto-calculé')
      onClose()
    } catch (e) {
      toast.error(`Échec : ${(e as Error).message}`)
    }
  }

  const isPending = patchMutation.isPending || resetMutation.isPending

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm"
        onClick={onClose}
        role="presentation"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Modifier le niveau de risque"
        className="fixed left-1/2 top-1/2 z-[70] w-[540px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text">Modifier le niveau de risque</h2>
            <p className="text-[11px] text-text-muted mt-0.5 truncate">
              <span className="font-mono">{item.compte_pcg || '—'}</span>{' '}
              <span className="text-text">— {item.compte_label}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface hover:text-text"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto space-y-3">
          {/* Calcul auto en référence */}
          {currentRisque && (
            <div className="rounded-md border border-border bg-surface/40 p-2.5 text-[11px]">
              <div className="text-text-muted">
                <strong>Calcul automatique :</strong>{' '}
                {autoLevel ? (
                  <>
                    Niveau <strong className="text-text">{NIVEAU_OPTIONS.find(o => o.value === autoLevel)?.label}</strong>
                    {' · '}score {autoScore >= 0 ? '+' : ''}{autoScore}
                    {' · '}{currentRisque.drivers.length} driver(s)
                  </>
                ) : (
                  <>
                    Override manuel actif{' · '}
                    {currentRisque.drivers.length} driver(s) détectés
                  </>
                )}
              </div>
            </div>
          )}

          {/* Radio niveaux */}
          <div>
            <label className="block text-xs font-medium text-text mb-1.5">Nouveau niveau</label>
            <div className="space-y-1.5">
              {NIVEAU_OPTIONS.map(({ value, label, description, Icon, classes }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNiveau(value)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-xs transition-all',
                    classes,
                    niveau === value
                      ? 'ring-2 ring-offset-1 ring-offset-background'
                      : 'opacity-70 hover:opacity-100',
                  )}
                >
                  <Icon size={14} className="mt-0.5 flex-none" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-text">{label}</div>
                    <div className="text-text-muted text-[10px] mt-0.5">{description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Motif obligatoire */}
          <div>
            <label htmlFor="risque-motif" className="block text-xs font-medium text-text mb-1.5">
              Motif d'override <span className="text-warning">*</span>
            </label>
            <textarea
              id="risque-motif"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              rows={3}
              placeholder="Pourquoi forcer ce niveau ? (ex : carnet de bord véhicule fourni, BOI cité, etc.)"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-text resize-y focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-[10px] text-text-muted mt-1">
              Le motif est enregistré pour traçabilité — visible dans le tooltip de la pastille
              et le PDF final.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <div>
            {isOverridden && (
              <button
                type="button"
                onClick={handleReset}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface hover:text-text disabled:opacity-50"
              >
                <RotateCcw size={12} />
                Repasser en automatique
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface hover:text-text disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={12} />
              {isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
