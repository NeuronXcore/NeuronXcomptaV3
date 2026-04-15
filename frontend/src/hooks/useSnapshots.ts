import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Operation } from '@/types'

export interface SnapshotOpRef {
  file: string
  index: number
}

export interface Snapshot {
  id: string
  name: string
  description?: string | null
  color?: string | null
  ops_refs: SnapshotOpRef[]
  context_year?: number | null
  context_month?: number | null
  context_filters?: Record<string, unknown> | null
  created_at: string
  updated_at?: string | null
}

export interface SnapshotCreatePayload {
  name: string
  description?: string
  color?: string
  ops_refs: SnapshotOpRef[]
  context_year?: number | null
  context_month?: number | null
  context_filters?: Record<string, unknown> | null
}

export interface SnapshotUpdatePayload {
  name?: string
  description?: string
  color?: string
  ops_refs?: SnapshotOpRef[]
}

export interface SnapshotResolvedResponse {
  snapshot: Snapshot
  operations: Operation[]
  resolved_count: number
  expected_count: number
}

export function useSnapshots() {
  return useQuery<Snapshot[]>({
    queryKey: ['snapshots'],
    queryFn: () => api.get('/snapshots/'),
  })
}

export function useSnapshot(id: string | null) {
  return useQuery<Snapshot>({
    queryKey: ['snapshots', id],
    queryFn: () => api.get(`/snapshots/${id}`),
    enabled: !!id,
  })
}

export function useSnapshotOperations(id: string | null) {
  return useQuery<SnapshotResolvedResponse>({
    queryKey: ['snapshots', id, 'operations'],
    queryFn: () => api.get(`/snapshots/${id}/operations`),
    enabled: !!id,
  })
}

export function useCreateSnapshot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: SnapshotCreatePayload) =>
      api.post<Snapshot>('/snapshots/', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
    },
  })
}

export function useUpdateSnapshot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SnapshotUpdatePayload }) =>
      api.patch<Snapshot>(`/snapshots/${id}`, payload),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      queryClient.invalidateQueries({ queryKey: ['snapshots', id] })
    },
  })
}

export function useDeleteSnapshot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/snapshots/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
    },
  })
}
