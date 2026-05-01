/**
 * Hooks TanStack Query pour le Livret comptable vivant — Phase 1.
 *
 * Stratégie de rafraîchissement :
 * - `useLivret(year)` : refetchInterval 60s + refetchOnWindowFocus → vue live.
 * - `useLivretMetadata(year)` : poll 30s (payload léger pour le live indicator).
 * - `invalidateLivret(qc, year?)` : helper pour les mutations qui veulent forcer
 *   un refresh immédiat après une action utilisateur impactante.
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'
import { useLivretStore } from '@/stores/useLivretStore'
import type { Livret, LivretMetadata, ProjectionResult } from '@/types/livret'

export function useLivret(year: number) {
  const compareMode = useLivretStore((s) => s.compareMode)
  const qs = compareMode !== 'none' ? `?compare_n1=${compareMode}` : ''
  return useQuery<Livret>({
    // queryKey inclut compareMode pour invalidation propre au changement de mode.
    queryKey: ['livret', year, compareMode],
    queryFn: () => api.get<Livret>(`/livret/${year}${qs}`),
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  })
}

export function useLivretMetadata(year: number) {
  return useQuery<LivretMetadata>({
    queryKey: ['livret', year, 'metadata'],
    queryFn: () => api.get<LivretMetadata>(`/livret/${year}/metadata`),
    refetchInterval: 30_000,
    staleTime: 0,
  })
}

export function useLivretProjection(year: number) {
  return useQuery<ProjectionResult>({
    queryKey: ['livret', year, 'projection'],
    queryFn: () => api.get<ProjectionResult>(`/livret/${year}/projection`),
  })
}

/**
 * Helper d'invalidation à câbler dans les `onSuccess` des mutations qui
 * impactent le contenu du livret (édition op, ventilation, lock, lettrage,
 * association justif, calcul forfait/dotation, etc.).
 *
 * Usage :
 *   const qc = useQueryClient()
 *   useMutation({ ..., onSuccess: () => invalidateLivret(qc, year) })
 *
 * `year` optionnel : si omis, invalide toutes les années (utile quand l'année
 * impactée n'est pas connue à coup sûr).
 */
export function invalidateLivret(qc: QueryClient, year?: number) {
  qc.invalidateQueries({ queryKey: year ? ['livret', year] : ['livret'] })
}

export function useInvalidateLivret() {
  const qc = useQueryClient()
  return (year?: number) => invalidateLivret(qc, year)
}
