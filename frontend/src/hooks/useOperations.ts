import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '@/api/client'
import type { Operation, OperationFile } from '@/types'

export function useOperationFiles() {
  return useQuery<OperationFile[]>({
    queryKey: ['operation-files'],
    queryFn: () => api.get('/operations/files'),
    staleTime: 60 * 1000, // 1 min — dropdown mois ne refetch pas à chaque navigation
  })
}

export function useOperations(filename: string | null) {
  return useQuery<Operation[]>({
    queryKey: ['operations', filename],
    queryFn: () => api.get(`/operations/${filename}`),
    enabled: !!filename,
    staleTime: 30 * 1000, // 30s — changement de mois déjà visité = instantané
  })
}

export function useSaveOperations() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ filename, operations }: { filename: string; operations: Operation[] }) =>
      api.put(`/operations/${filename}`, operations),
    onSuccess: (_, { filename }) => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      // Livret comptable : invalidation toutes années (l'année du fichier n'est pas
      // toujours connue ici sans parsing du filename — coût négligeable sur 1-3 ans actifs).
      queryClient.invalidateQueries({ queryKey: ['livret'] })
    },
  })
}

export function useHasPdf(filename: string | null) {
  return useQuery<{ has_pdf: boolean; pdf_filename: string | null }>({
    queryKey: ['has-pdf', filename],
    queryFn: () => api.get(`/operations/${filename}/has-pdf`),
    enabled: !!filename,
  })
}

export function useYearOperations(filesForYear: OperationFile[], enabled: boolean) {
  const queries = useQueries({
    queries: filesForYear.map(f => ({
      queryKey: ['operations', f.filename],
      queryFn: () => api.get<Operation[]>(`/operations/${f.filename}`),
      enabled,
      staleTime: 5 * 60 * 1000,
    })),
  })

  const isLoading = queries.some(q => q.isLoading)
  const allDone = enabled && queries.length > 0 && queries.every(q => q.isSuccess)
  // Stable key for memo: use dataUpdatedAt timestamps
  const dataKey = queries.map(q => q.dataUpdatedAt).join(',')

  const data = useMemo(() => {
    if (!allDone) return undefined
    // Dedup defensive : si plusieurs fichiers contiennent la même op (Date+Libellé+Débit+Crédit),
    // on garde la première occurrence rencontrée. Évite le double-comptage des totaux/lignes
    // en mode "Toute l'année" si jamais des fichiers se chevauchent.
    // Aussi : enrichit avec _index (position locale dans le fichier source) pour permettre
    // l'édition / bulk-lock par row en year-wide.
    const merged: Operation[] = []
    const seen = new Set<string>()
    queries.forEach((q, i) => {
      if (!q.data) return
      const filename = filesForYear[i].filename
      const arr = q.data as Operation[]
      arr.forEach((op, idx) => {
        const k = `${op.Date ?? ''}|${(op['Libellé'] ?? '').trim()}|${op['Débit'] ?? 0}|${op['Crédit'] ?? 0}`
        if (seen.has(k)) return
        seen.add(k)
        merged.push({ ...op, _sourceFile: filename, _index: idx })
      })
    })
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, allDone])

  return { data, isLoading }
}

/**
 * Crée un fichier d'opérations vide pour (year, month) — utilisé pour saisir des NDF
 * ou autres opérations manuelles avant l'import du relevé bancaire PDF correspondant.
 */
export function useCreateEmptyMonth() {
  const queryClient = useQueryClient()
  return useMutation<{ filename: string; year: number; month: number }, Error, { year: number; month: number }>({
    mutationFn: ({ year, month }) => api.post('/operations/create-empty', { year, month }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operation-files'] })
    },
  })
}

export function useCategorizeOperations() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ filename, mode }: { filename: string; mode: string }) =>
      api.post<{ modified: number; total: number }>(`/operations/${filename}/categorize`, { mode }),
    onSuccess: (_, { filename }) => {
      queryClient.invalidateQueries({ queryKey: ['operations', filename] })
      queryClient.invalidateQueries({ queryKey: ['livret'] })
    },
  })
}
