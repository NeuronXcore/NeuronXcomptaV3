import { create } from 'zustand'

interface PlaquetteCheckDrawerState {
  isOpen: boolean
  year: number | null
  gedDocumentId: string | null
  open: (opts: { year: number; gedDocumentId?: string | null }) => void
  close: () => void
}

export const usePlaquetteCheckDrawerStore = create<PlaquetteCheckDrawerState>((set) => ({
  isOpen: false,
  year: null,
  gedDocumentId: null,
  open: ({ year, gedDocumentId = null }) =>
    set({ isOpen: true, year, gedDocumentId }),
  close: () => set({ isOpen: false, year: null, gedDocumentId: null }),
}))
