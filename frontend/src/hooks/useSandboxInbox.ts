import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type {
  SandboxFileItem,
  SandboxProcessResult,
  SandboxRenameResult,
} from '@/types'

/**
 * Hook liste des fichiers sandbox en attente de traitement manuel.
 *
 * Les events SSE `arrived` / `processed` sont captés par `useSandbox()` dans
 * `AppLayout` qui invalide `['sandbox', 'list']` → refetch automatique. Un
 * refetch interval 5s sert de filet de sécurité en cas de déconnexion SSE.
 */
export function useSandboxList() {
  return useQuery<SandboxFileItem[]>({
    queryKey: ['sandbox', 'list'],
    queryFn: () => api.get('/sandbox/list'),
    refetchInterval: 5000,
    staleTime: 2000,
  })
}

/**
 * Rename inplace d'un fichier sandbox (avant OCR). Déclenche PAS l'OCR.
 * Invalide la liste + les stats (badge sidebar).
 */
export function useRenameInSandbox() {
  const queryClient = useQueryClient()
  return useMutation<
    SandboxRenameResult,
    Error,
    { filename: string; newFilename: string }
  >({
    mutationFn: ({ filename, newFilename }) =>
      api.post(`/sandbox/${encodeURIComponent(filename)}/rename`, {
        new_filename: newFilename,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
    },
  })
}

/**
 * Déclenche OCR + rapprochement sur un fichier sandbox unitairement.
 * À l'issue : le fichier quitte sandbox/ (vers en_attente ou traites selon
 * auto-rapprochement). Invalide sandbox, justificatifs, ocr-history, stats.
 */
export function useProcessSandboxFile() {
  const queryClient = useQueryClient()
  return useMutation<SandboxProcessResult, Error, string>({
    mutationFn: (filename) =>
      api.post(`/sandbox/${encodeURIComponent(filename)}/process`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox'] })
      queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
      queryClient.invalidateQueries({ queryKey: ['ocr-history'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['ged'] })
    },
  })
}

/**
 * Supprime un fichier sandbox sans le traiter.
 */
export function useDeleteFromSandbox() {
  const queryClient = useQueryClient()
  return useMutation<{ status: string; filename: string }, Error, string>({
    mutationFn: (filename) =>
      api.delete(`/sandbox/${encodeURIComponent(filename)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandbox'] })
      queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
    },
  })
}
