/**
 * Store Zustand dédié au Livret comptable (Phase 4).
 *
 * Sépare l'état de comparaison N-1 du `useFiscalYearStore` (qui reste réservé
 * à l'année globale partagée par toutes les pages). Persisté en localStorage
 * avec la clé `livret-store`.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { CompareUiMode } from '@/types/livret'

interface LivretStore {
  /** Mode comparaison N-1 actif côté UI. `none` = aucune comparaison (défaut). */
  compareMode: CompareUiMode
  setCompareMode: (mode: CompareUiMode) => void

  /** Affiche la ligne N-1 sur la cadence mensuelle (séparé du toggle compareMode). */
  showN1OnCadence: boolean
  setShowN1OnCadence: (val: boolean) => void
}

export const useLivretStore = create<LivretStore>()(
  persist(
    (set) => ({
      compareMode: 'none',
      setCompareMode: (mode) => set({ compareMode: mode }),
      showN1OnCadence: false,
      setShowN1OnCadence: (val) => set({ showN1OnCadence: val }),
    }),
    { name: 'livret-store' },
  ),
)
