import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import toast from 'react-hot-toast'
import type {
  CheckEnvoiInstance,
  CheckCoverage,
  CheckPeriod,
  CheckReminderState,
} from '../types'

function instanceUrl(year: number, period: CheckPeriod, month?: number | null): string {
  const base = `/check-envoi/${year}/${period}`
  if (period === 'month' && month != null) return `${base}?month=${month}`
  return base
}

export function useCheckInstance(year: number, period: CheckPeriod, month?: number | null) {
  return useQuery<CheckEnvoiInstance>({
    queryKey: ['check-envoi', year, period, month ?? null],
    queryFn: () => api.get(instanceUrl(year, period, month)),
    enabled: period === 'year' || (period === 'month' && month != null),
    staleTime: 30_000,
  })
}

export function useCheckCoverage(year: number) {
  return useQuery<CheckCoverage>({
    queryKey: ['check-coverage', year],
    queryFn: () => api.get(`/check-envoi/${year}/coverage`),
    staleTime: 60_000,
  })
}

interface PatchItemArgs {
  year: number
  period: CheckPeriod
  month?: number | null
  itemKey: string
  comment?: string | null
  manual_ok?: boolean | null
}

export function useUpdateCheckItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: PatchItemArgs) => {
      const monthQs = args.period === 'month' && args.month != null ? `?month=${args.month}` : ''
      const body: Record<string, unknown> = {}
      if (args.comment !== undefined) body.comment = args.comment
      if (args.manual_ok !== undefined) body.manual_ok = args.manual_ok
      return api.patch<CheckEnvoiInstance>(
        `/check-envoi/${args.year}/${args.period}/items/${encodeURIComponent(args.itemKey)}${monthQs}`,
        body,
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['check-envoi'] })
      qc.invalidateQueries({ queryKey: ['check-coverage'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

interface ValidateArgs {
  year: number
  period: CheckPeriod
  month?: number | null
}

export function useValidateCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: ValidateArgs) => {
      const monthQs = args.period === 'month' && args.month != null ? `?month=${args.month}` : ''
      return api.post<CheckEnvoiInstance>(
        `/check-envoi/${args.year}/${args.period}/validate${monthQs}`,
      )
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ['check-envoi'] })
      qc.invalidateQueries({ queryKey: ['check-coverage'] })
      qc.invalidateQueries({ queryKey: ['cloture', args.year] })
      qc.invalidateQueries({ queryKey: ['check-reminder-state'] })
      toast.success('Check validé')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUnvalidateCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: ValidateArgs) => {
      const monthQs = args.period === 'month' && args.month != null ? `?month=${args.month}` : ''
      return api.post<CheckEnvoiInstance>(
        `/check-envoi/${args.year}/${args.period}/unvalidate${monthQs}`,
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['check-envoi'] })
      qc.invalidateQueries({ queryKey: ['check-coverage'] })
      qc.invalidateQueries({ queryKey: ['check-reminder-state'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCheckReminderState() {
  return useQuery<CheckReminderState>({
    queryKey: ['check-reminder-state'],
    queryFn: () => api.get('/check-envoi/reminders/state'),
    staleTime: 5 * 60_000,
  })
}

export function useSnoozeReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { period_key: string; until_iso: string }) =>
      api.post('/check-envoi/reminders/snooze', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['check-reminder-state'] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDismissReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (period_key: string) =>
      api.post('/check-envoi/reminders/dismiss', { period_key }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['check-reminder-state'] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCheckNotesForEmail(year: number | null, month: number | null) {
  return useQuery<{ notes: string }>({
    queryKey: ['check-notes', year, month],
    queryFn: () => api.get(`/check-envoi/notes/${year}/${month}`),
    enabled: year != null && month != null,
    staleTime: 30_000,
  })
}
