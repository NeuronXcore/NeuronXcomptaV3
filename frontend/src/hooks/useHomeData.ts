import { useMemo } from 'react'
import { useAnnualStatus } from './useCloture'
import { useAlertesSummary } from './useAlertes'
import { useEcheances } from './usePrevisionnel'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { MOIS_FR } from '@/lib/utils'
import type { AlerteSeverity, HomeData, PulseCardData } from '@/types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Sévérité des alertes calculée client-side depuis le breakdown par type.
 * Pas de champ `impact` dans `AlerteSummary` — on utilise les types comme proxy.
 */
function deriveSeverity(summary: ReturnType<typeof useAlertesSummary>['data']): AlerteSeverity {
  if (!summary || summary.total_en_attente === 0) return 'faible'
  const par = summary.par_type
  // Doublon suspect ou montant à vérifier = critique
  if ((par.doublon_suspect ?? 0) > 0 || (par.montant_a_verifier ?? 0) > 0) return 'critique'
  // Justif manquant ou catégorie manquante en gros volume = moyenne
  if ((par.justificatif_manquant ?? 0) >= 5 || (par.a_categoriser ?? 0) >= 5) return 'moyenne'
  return 'faible'
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY)
}

/**
 * Agrège les données nécessaires aux 3 pulse cards de la HomePage.
 *
 * Sources :
 * - Pulse 1 (mois courant) : `useAnnualStatus(year)` → MonthStatus[currentMonth]
 *   On utilise `taux_justificatifs` comme proxy de complétion (le chiffre que
 *   l'utilisateur perçoit comme "où j'en suis").
 * - Pulse 2 (prochaine échéance) : `useEcheances(year, 'attendu')` triée par date.
 * - Pulse 3 (alertes) : `useAlertesSummary().total_en_attente` + sévérité dérivée.
 */
export function useHomeData(): HomeData {
  const selectedYear = useFiscalYearStore((s) => s.selectedYear)

  const { data: annualStatus, isLoading: isStatusLoading } = useAnnualStatus(selectedYear)
  const { data: alertesSummary, isLoading: isAlertesLoading } = useAlertesSummary()
  const { data: echeances, isLoading: isEcheancesLoading } = useEcheances(selectedYear, 'attendu')

  const pulse = useMemo<PulseCardData>(() => {
    const now = new Date()
    const currentMonth = now.getMonth() + 1   // 1-12
    const currentMonthIdx = now.getMonth()    // 0-11

    // Pulse 1
    const monthEntry = annualStatus?.find((m) => m.mois === currentMonth)
    const monthCompletion = Math.round(monthEntry?.taux_justificatifs ?? 0)
    const monthLabel = `${MOIS_FR[currentMonthIdx]} ${selectedYear}`

    // Pulse 2 — prochaine échéance "attendue" la plus proche
    let nextEcheanceDays: number | null = null
    let nextEcheanceName: string | null = null
    if (echeances && echeances.length > 0) {
      const upcoming = [...echeances]
        .filter((e) => e.statut === 'attendu')
        .sort((a, b) => a.date_attendue.localeCompare(b.date_attendue))
      const next = upcoming[0]
      if (next) {
        const days = daysUntil(next.date_attendue)
        if (days >= 0) {
          nextEcheanceDays = days
          nextEcheanceName = next.periode_label || 'Échéance'
        }
      }
    }

    // Pulse 3
    const alertesCount = alertesSummary?.total_en_attente ?? 0
    const alertesSeverity = deriveSeverity(alertesSummary)

    return {
      monthLabel,
      monthCompletion,
      nextEcheanceDays,
      nextEcheanceName,
      alertesCount,
      alertesSeverity,
    }
  }, [annualStatus, alertesSummary, echeances, selectedYear])

  return {
    pulse,
    isLoading: isStatusLoading || isAlertesLoading || isEcheancesLoading,
  }
}
