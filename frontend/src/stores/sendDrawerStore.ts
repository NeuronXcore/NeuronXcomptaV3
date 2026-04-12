import { create } from 'zustand'
import type { DocumentRef } from '@/types'

interface SendDrawerState {
  isOpen: boolean
  preselected: DocumentRef[]
  defaultFilter?: string
  defaultSubject?: string
  open: (opts?: { preselected?: DocumentRef[]; defaultFilter?: string; defaultSubject?: string }) => void
  close: () => void
}

export const useSendDrawerStore = create<SendDrawerState>((set) => ({
  isOpen: false,
  preselected: [],
  defaultFilter: undefined,
  defaultSubject: undefined,
  open: (opts) => set({
    isOpen: true,
    preselected: opts?.preselected ?? [],
    defaultFilter: opts?.defaultFilter,
    defaultSubject: opts?.defaultSubject,
  }),
  close: () => set({
    isOpen: false,
    preselected: [],
    defaultFilter: undefined,
    defaultSubject: undefined,
  }),
}))
