import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { RappelRuleInfo, RappelsSummary } from '@/types'

/**
 * Hook de lecture des rappels Dashboard.
 *
 * - `staleTime: 5 min` : les rappels sont informatifs, pas temps-réel.
 * - `refetchOnWindowFocus: true` : refresh quand l'utilisateur revient sur l'onglet
 *   après une action (clôture, association justif, etc.). Couvre les cas pratiques
 *   sans modifier les 5+ mutations existantes.
 */
export function useRappels() {
  return useQuery<RappelsSummary>({
    queryKey: ['rappels'],
    queryFn: () => api.get('/rappels'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

export function useSnoozeRappel() {
  const qc = useQueryClient()
  return useMutation<{ rule_id: string; expiry: string }, Error, { ruleId: string; days: number }>({
    mutationFn: ({ ruleId, days }) =>
      api.post(`/rappels/${ruleId}/snooze`, { days }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rappels'] })
    },
  })
}

/**
 * Liste les règles enregistrées avec leur état activé/désactivé.
 * Source de vérité backend (ALL_RULES). Utilisé par le menu « Régler les rappels ».
 */
export function useRappelRules() {
  return useQuery<RappelRuleInfo[]>({
    queryKey: ['rappels', 'rules'],
    queryFn: () => api.get('/rappels/rules'),
    staleTime: 60 * 1000,
  })
}
