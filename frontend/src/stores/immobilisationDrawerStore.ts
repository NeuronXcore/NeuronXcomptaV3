import { create } from 'zustand'

/**
 * Store global pour ouvrir l'`ImmobilisationDrawer` en mode lecture
 * depuis n'importe quelle page (clic sur `ImmoBadge` dans Editor/Justif/Alertes
 * ou cartes immo dans `DotationsVirtualDrawer`).
 *
 * AmortissementsPage continue de monter sa propre instance pour les flows
 * création/édition/candidate (avec form complet + footer Save).
 */
interface ImmobilisationDrawerState {
  isOpen: boolean
  immoId: string | null
  open: (immoId: string) => void
  close: () => void
}

export const useImmobilisationDrawerStore = create<ImmobilisationDrawerState>((set) => ({
  isOpen: false,
  immoId: null,
  open: (immoId) => set({ isOpen: true, immoId }),
  close: () => set({ isOpen: false, immoId: null }),
}))
