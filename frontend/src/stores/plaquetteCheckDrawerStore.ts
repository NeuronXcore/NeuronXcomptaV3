import { create } from 'zustand'

export type PlaquetteJournalView = 'timeline' | 'by-item'

interface PlaquetteCheckDrawerState {
  isOpen: boolean
  year: number | null
  gedDocumentId: string | null
  // Session 39 P1 — vue alternative onglet Journal
  journalView: PlaquetteJournalView
  // Session 40 P1 — sous-drawer Position de repli
  negociationDrawerOpen: boolean
  open: (opts: { year: number; gedDocumentId?: string | null }) => void
  close: () => void
  setJournalView: (view: PlaquetteJournalView) => void
  openNegociationDrawer: () => void
  closeNegociationDrawer: () => void
}

export const usePlaquetteCheckDrawerStore = create<PlaquetteCheckDrawerState>((set) => ({
  isOpen: false,
  year: null,
  gedDocumentId: null,
  journalView: 'timeline',
  negociationDrawerOpen: false,
  open: ({ year, gedDocumentId = null }) =>
    set({ isOpen: true, year, gedDocumentId }),
  close: () =>
    set({
      isOpen: false,
      year: null,
      gedDocumentId: null,
      negociationDrawerOpen: false, // ferme aussi le sous-drawer
    }),
  setJournalView: (view) => set({ journalView: view }),
  openNegociationDrawer: () => set({ negociationDrawerOpen: true }),
  closeNegociationDrawer: () => set({ negociationDrawerOpen: false }),
}))
