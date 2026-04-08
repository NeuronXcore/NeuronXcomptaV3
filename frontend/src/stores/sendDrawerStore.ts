import { create } from 'zustand'
import type { DocumentRef } from '@/types'

interface SendDrawerState {
  isOpen: boolean
  preselected: DocumentRef[]
  defaultFilter?: string
  open: (opts?: { preselected?: DocumentRef[]; defaultFilter?: string }) => void
  close: () => void
}

export const useSendDrawerStore = create<SendDrawerState>((set) => ({
  isOpen: false,
  preselected: [],
  defaultFilter: undefined,
  open: (opts) => set({
    isOpen: true,
    preselected: opts?.preselected ?? [],
    defaultFilter: opts?.defaultFilter,
  }),
  close: () => set({
    isOpen: false,
    preselected: [],
    defaultFilter: undefined,
  }),
}))
