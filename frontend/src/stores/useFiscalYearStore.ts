import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FiscalYearState {
  selectedYear: number
  setYear: (year: number) => void
}

export const useFiscalYearStore = create<FiscalYearState>()(
  persist(
    (set) => ({
      selectedYear: new Date().getFullYear(),
      setYear: (year: number) => set({ selectedYear: year }),
    }),
    {
      name: 'neuronx-fiscal-year',
    }
  )
)
