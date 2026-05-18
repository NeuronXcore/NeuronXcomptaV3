import { create } from 'zustand'

export type PlaquetteJournalView = 'timeline' | 'by-item'

interface PlaquetteCheckDrawerState {
  isOpen: boolean
  year: number | null
  gedDocumentId: string | null
  // Session 39 P1 — vue alternative onglet Journal
  journalView: PlaquetteJournalView
  open: (opts: { year: number; gedDocumentId?: string | null }) => void
  close: () => void
  setJournalView: (view: PlaquetteJournalView) => void
}

export const usePlaquetteCheckDrawerStore = create<PlaquetteCheckDrawerState>((set) => ({
  isOpen: false,
  year: null,
  gedDocumentId: null,
  journalView: 'timeline',
  open: ({ year, gedDocumentId = null }) =>
    set({ isOpen: true, year, gedDocumentId }),
  close: () => set({ isOpen: false, year: null, gedDocumentId: null }),
  setJournalView: (view) => set({ journalView: view }),
}))
