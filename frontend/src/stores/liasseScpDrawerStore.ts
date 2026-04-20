import { create } from 'zustand'

interface LiasseScpDrawerState {
  isOpen: boolean
  // Année résolue à l'ouverture (corrigeable dans le drawer via selector)
  initialYear: number | null
  // Document GED référencé (optionnel, permet preview + lien "Ouvrir" dans le drawer)
  gedDocumentId: string | null
  // Source de résolution de l'année (affichée comme pastille dans le drawer si != fiscal_store)
  yearSource: 'ged_year' | 'ged_date' | 'ged_filename' | 'fiscal_store' | null
  open: (opts: {
    initialYear: number
    gedDocumentId?: string | null
    yearSource?: 'ged_year' | 'ged_date' | 'ged_filename' | 'fiscal_store' | null
  }) => void
  close: () => void
}

export const useLiasseScpDrawerStore = create<LiasseScpDrawerState>((set) => ({
  isOpen: false,
  initialYear: null,
  gedDocumentId: null,
  yearSource: null,
  open: ({ initialYear, gedDocumentId = null, yearSource = 'fiscal_store' }) =>
    set({ isOpen: true, initialYear, gedDocumentId, yearSource }),
  close: () =>
    set({ isOpen: false, initialYear: null, gedDocumentId: null, yearSource: null }),
}))
