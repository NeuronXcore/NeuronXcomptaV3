import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import toast from 'react-hot-toast'
import type {
  BaremeBlanchissage,
  ForfaitResult,
  GenerateODRequest,
  GenerateODResponse,
  ForfaitGenere,
  VehiculeRequest,
  VehiculeResult,
  ApplyVehiculeResponse,
  VehiculeGenere,
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
  return useMutation<ForfaitResult, Error, { year: number; jours_travailles: number; mode: string; honoraires_liasse?: number | null }>({
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
  vehicule_distance_km?: number | null
  vehicule_km_supplementaires?: number | null
  vehicule_km_totaux_compteur?: number | null
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

// ── Véhicule ──

// Calcul véhicule (mutation car prend des paramètres)
export function useCalculerVehicule() {
  return useMutation<VehiculeResult, Error, VehiculeRequest>({
    mutationFn: (data) => api.post('/charges-forfaitaires/calculer/vehicule', data),
  })
}

// Application véhicule (poste GED + PDF + GED)
export function useAppliquerVehicule() {
  const qc = useQueryClient()
  return useMutation<ApplyVehiculeResponse, Error, VehiculeRequest>({
    mutationFn: (data) => api.post('/charges-forfaitaires/appliquer/vehicule', data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['forfaits-generes', variables.year] })
      qc.invalidateQueries({ queryKey: ['charges-forfaitaires-config', variables.year] })
      qc.invalidateQueries({ queryKey: ['vehicule-genere', variables.year] })
      qc.invalidateQueries({ queryKey: ['ged'] })
      qc.invalidateQueries({ queryKey: ['ged-postes'] })
      qc.invalidateQueries({ queryKey: ['ged-stats'] })
    },
  })
}

// Véhicule déjà appliqué pour l'année
export function useVehiculeGenere(year: number) {
  return useQuery<VehiculeGenere | null>({
    queryKey: ['vehicule-genere', year],
    queryFn: () => api.get(`/charges-forfaitaires/vehicule/genere?year=${year}`),
  })
}

// Regénération PDF véhicule (silencieuse, met à jour les dépenses dans le PDF)
export function useRegenerPdfVehicule() {
  const qc = useQueryClient()
  return useMutation<{ pdf_filename: string }, Error, { year: number }>({
    mutationFn: ({ year }) => api.post(`/charges-forfaitaires/regenerer-pdf/vehicule?year=${year}`),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['vehicule-genere', variables.year] })
      qc.invalidateQueries({ queryKey: ['ged'] })
    },
  })
}

// Suppression véhicule (pour regénérer)
export function useSupprimerVehicule() {
  const qc = useQueryClient()
  return useMutation<{ deleted: boolean }, Error, { year: number }>({
    mutationFn: ({ year }) =>
      api.delete(`/charges-forfaitaires/supprimer/vehicule?year=${year}`),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['forfaits-generes', variables.year] })
      qc.invalidateQueries({ queryKey: ['vehicule-genere', variables.year] })
      qc.invalidateQueries({ queryKey: ['charges-forfaitaires-config', variables.year] })
      qc.invalidateQueries({ queryKey: ['ged'] })
      qc.invalidateQueries({ queryKey: ['ged-postes'] })
    },
  })
}


// ── Repas ──

export interface BaremeRepas {
  year: number
  seuil_repas_maison: number
  plafond_repas_restaurant: number
  forfait_jour: number
  reference_legale: string
  source: string
}

export function useBaremeRepas(year: number) {
  return useQuery<BaremeRepas>({
    queryKey: ['bareme-repas', year],
    queryFn: () => api.get(`/charges-forfaitaires/bareme/repas?year=${year}`),
  })
}

export interface RepasResult {
  type_forfait: string
  year: number
  montant_deductible: number
  cout_jour: number
  seuil_repas_maison: number
  plafond_repas_restaurant: number
  jours_travailles: number
  reference_legale: string
}

export function useCalculerRepas() {
  return useMutation<RepasResult, Error, { year: number; jours_travailles: number }>({
    mutationFn: (data) => api.post('/charges-forfaitaires/calculer/repas', data),
  })
}

export function useSupprimerRepas() {
  const qc = useQueryClient()
  return useMutation<{ deleted: boolean }, Error, { year: number }>({
    mutationFn: ({ year }) =>
      api.delete(`/charges-forfaitaires/supprimer/repas?year=${year}`),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['forfaits-generes', variables.year] })
      qc.invalidateQueries({ queryKey: ['operations'] })
      qc.invalidateQueries({ queryKey: ['ged'] })
      toast.success('Forfait repas supprimé')
    },
  })
}
