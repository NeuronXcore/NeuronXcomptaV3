import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import toast from 'react-hot-toast'
import type { Task, TaskCreate, TaskUpdate } from '../types'

export function useTasks(year: number) {
  return useQuery<Task[]>({
    queryKey: ['tasks', year],
    queryFn: () => api.get(`/tasks/?year=${year}`),
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TaskCreate) => api.post<Task>('/tasks/', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('Tâche créée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TaskUpdate }) =>
      api.patch<Task>(`/tasks/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('Tâche supprimée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useRefreshAutoTasks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (year: number) => api.post<{ added: number; updated: number; removed: number }>(`/tasks/refresh?year=${year}`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      const { added, updated, removed } = data
      toast.success(`Auto-tâches : ${added} ajoutées, ${updated} mises à jour, ${removed} supprimées`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
