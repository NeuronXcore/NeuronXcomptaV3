import { useImmobilisationDrawerStore } from '@/stores/immobilisationDrawerStore'
import { useImmobilisation } from '@/hooks/useAmortissements'
import ImmobilisationDrawer from './ImmobilisationDrawer'

/**
 * Instance globale de `ImmobilisationDrawer` montée dans `App.tsx`.
 * S'ouvre via `useImmobilisationDrawerStore.open(immoId)` depuis n'importe
 * quelle page (badges Immo dans Editor/Justif/Alertes, cartes immo dans
 * `DotationsVirtualDrawer`).
 *
 * Mode lecture seule pour éviter d'éditer une immo depuis un contexte
 * périphérique — l'utilisateur édite dans `AmortissementsPage` (instance locale).
 */
export default function GlobalImmobilisationDrawer() {
  const { isOpen, immoId, close } = useImmobilisationDrawerStore()
  const { data: immo } = useImmobilisation(immoId)

  if (!isOpen) return null

  return (
    <ImmobilisationDrawer
      isOpen={isOpen}
      onClose={close}
      immobilisation={immo ?? null}
      readonly
    />
  )
}
