import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import type {
  BaremeBlanchissage,
  ForfaitResult,
  GenerateODRequest,
  GenerateODResponse,
  ForfaitGenere,
} from '@/types'

// Barème blanchissage (via endpoint simulation barèmes existant)
export function useBaremeBlanchissage(year: number) {
  return useQuery<BaremeBlanchissage>({
    queryKey: ['bareme', 'blanchissage', year],
    queryFn: () => api.get(`/simulation/baremes/blanchissage?year=${year}`),
  })
}

// Sauvegarder le barème blanchissage modifié
export function useUpdateBaremeBlanchissage() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, { year: number; data: BaremeBlanchissage }>({
    mutationFn: ({ year, data }) => api.put(`/simulation/baremes/blanchissage?year=${year}`, data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['bareme', 'blanchissage', variables.year] })
    },
  })
}

// Calcul blanchissage (mutation car prend des paramètres)
export function useCalculerBlanchissage() {
  return useMutation<ForfaitResult, Error, { year: number; jours_travailles: number; mode: string }>({
    mutationFn: (data) => api.post('/charges-forfaitaires/calculer/blanchissage', data),
  })
}

// Génération OD + PDF + GED
export function useGenererOD() {
  const qc = useQueryClient()
  return useMutation<GenerateODResponse, Error, GenerateODRequest>({
    mutationFn: (data) => api.post('/charges-forfaitaires/generer', data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['forfaits-generes', variables.year] })
      qc.invalidateQueries({ queryKey: ['operations'] })
      qc.invalidateQueries({ queryKey: ['ged'] })
    },
  })
}

// Forfaits déjà générés pour l'année
export function useForfaitsGeneres(year: number) {
  return useQuery<ForfaitGenere[]>({
    queryKey: ['forfaits-generes', year],
    queryFn: () => api.get(`/charges-forfaitaires/generes?year=${year}`),
  })
}

// Config persistée par année (honoraires liasse, jours travaillés)
export interface ChargesForfaitairesConfig {
  honoraires_liasse?: number | null
  jours_travailles?: number | null
}

export function useChargesForfaitairesConfig(year: number) {
  return useQuery<ChargesForfaitairesConfig>({
    queryKey: ['charges-forfaitaires-config', year],
    queryFn: () => api.get(`/charges-forfaitaires/config?year=${year}`),
  })
}

export function useUpdateChargesForfaitairesConfig() {
  const qc = useQueryClient()
  return useMutation<ChargesForfaitairesConfig, Error, { year: number; data: Partial<ChargesForfaitairesConfig> }>({
    mutationFn: ({ year, data }) => api.put(`/charges-forfaitaires/config?year=${year}`, data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['charges-forfaitaires-config', variables.year] })
    },
  })
}

// Suppression forfait
export function useSupprimerForfait() {
  const qc = useQueryClient()
  return useMutation<{ deleted: boolean }, Error, { type_forfait: string; year: number }>({
    mutationFn: ({ type_forfait, year }) =>
      api.delete(`/charges-forfaitaires/supprimer/${type_forfait}?year=${year}`),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['forfaits-generes', variables.year] })
      qc.invalidateQueries({ queryKey: ['operations'] })
      qc.invalidateQueries({ queryKey: ['ged'] })
      toast.success('Forfait supprimé')
    },
  })
}
