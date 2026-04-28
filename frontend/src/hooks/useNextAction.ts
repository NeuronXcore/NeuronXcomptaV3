import { useMemo } from 'react'
import { useOperationFiles, useOperations } from './useOperations'
import { useAnnualStatus } from './useCloture'
import { useEcheances } from './usePrevisionnel'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { MOIS_FR } from '@/lib/utils'
import type { NextActionData } from '@/types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY)
}

/**
 * Calcule la prochaine action contextuelle de l'utilisateur — premier match gagne.
 *
 * Règles dans l'ordre :
 *  1. Échéance fiscale dans ≤ 7 jours → bouton vers Prévisionnel
 *  2. > 5 ops sans catégorie sur le mois courant → bouton vers Éditeur (filtre uncategorized)
 *  3. > 3 justificatifs orphelins sur le mois courant → bouton vers Justificatifs
 *  4. Mois N-1 ≥ 95% complétion ET non clôturé → bouton vers Clôture
 *  5. Idle chaleureux → bouton vers Pipeline
 */
export function useNextAction(): { data: NextActionData; isLoading: boolean } {
  const selectedYear = useFiscalYearStore((s) => s.selectedYear)
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1
  const previousMonthYear = currentMonth === 1 ? selectedYear - 1 : selectedYear

  const { data: files, isLoading: isFilesLoading } = useOperationFiles()
  const { data: annualStatus, isLoading: isStatusLoading } = useAnnualStatus(selectedYear)
  const { data: previousAnnualStatus, isLoading: isPrevStatusLoading } = useAnnualStatus(previousMonthYear)
  const { data: echeances, isLoading: isEcheancesLoading } = useEcheances(selectedYear, 'attendu')

  // Trouve le fichier d'opérations du mois courant pour la règle 2.
  const currentMonthFile = useMemo(() => {
    if (!files) return null
    return files.find((f) => f.year === selectedYear && f.month === currentMonth) ?? null
  }, [files, selectedYear, currentMonth])

  const { data: currentMonthOps, isLoading: isOpsLoading } = useOperations(
    currentMonthFile?.filename ?? null,
  )

  const isLoading = isFilesLoading || isStatusLoading || isPrevStatusLoading || isEcheancesLoading || isOpsLoading

  const data = useMemo<NextActionData>(() => {
    // ── Règle 1 : échéance fiscale ≤ 7 jours ─────────────────────────────
    const upcoming = (echeances ?? [])
      .filter((e) => e.statut === 'attendu')
      .map((e) => ({ ...e, days: daysUntil(e.date_attendue) }))
      .filter((e) => e.days >= 0 && e.days <= 7)
      .sort((a, b) => a.days - b.days)
    const firstUpcoming = upcoming[0]
    if (firstUpcoming) {
      const montantStr = firstUpcoming.montant_reel != null
        ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(firstUpcoming.montant_reel)
        : null
      return {
        kind: 'echeance',
        iconName: 'Clock',
        label: 'À faire maintenant',
        title: `Déclaration ${firstUpcoming.periode_label || 'fiscale'} dans ${firstUpcoming.days} jour${firstUpcoming.days > 1 ? 's' : ''}`,
        subtitle: montantStr ? `Provision : ${montantStr}` : null,
        ctaText: 'Voir',
        ctaPath: '/previsionnel?tab=echeances',
      }
    }

    // ── Règle 2 : > 5 ops sans catégorie sur le mois courant ─────────────
    if (currentMonthOps) {
      const uncategorized = currentMonthOps.filter((op) => {
        const cat = (op.Catégorie ?? '').trim()
        return cat === '' || cat === 'Autres'
      })
      if (uncategorized.length > 5) {
        return {
          kind: 'uncategorized',
          iconName: 'Tags',
          label: 'À faire maintenant',
          title: `${uncategorized.length} opérations à catégoriser sur ${MOIS_FR[currentMonth - 1]}`,
          subtitle: null,
          ctaText: "Ouvrir l'éditeur",
          ctaPath: '/editor?filter=uncategorized',
        }
      }
    }

    // ── Règle 3 : > 3 justificatifs orphelins sur le mois courant ────────
    const monthEntry = annualStatus?.find((m) => m.mois === currentMonth)
    if (monthEntry) {
      const orphans = monthEntry.nb_justificatifs_total - monthEntry.nb_justificatifs_ok
      if (orphans > 3) {
        return {
          kind: 'orphan_justif',
          iconName: 'Paperclip',
          label: 'À faire maintenant',
          title: `${orphans} justificatifs en attente d'association`,
          subtitle: null,
          ctaText: 'Voir les justificatifs',
          ctaPath: '/justificatifs?filter=sans',
        }
      }
    }

    // ── Règle 4 : mois N-1 ≥ 95% ET non clôturé ──────────────────────────
    const prevEntry = previousAnnualStatus?.find((m) => m.mois === previousMonth)
    if (prevEntry && prevEntry.taux_justificatifs >= 95 && prevEntry.statut !== 'complet') {
      return {
        kind: 'cloture_ready',
        iconName: 'CheckCircle2',
        label: 'À faire maintenant',
        title: `${MOIS_FR[previousMonth - 1]} prêt à clôturer`,
        subtitle: null,
        ctaText: 'Aller à la clôture',
        ctaPath: '/cloture',
      }
    }

    // ── Règle 5 : idle chaleureux ────────────────────────────────────────
    return {
      kind: 'idle',
      iconName: 'Sparkles',
      label: 'Bel ouvrage',
      title: 'Tout est à jour',
      subtitle: "Plus rien d'urgent — bel exercice",
      ctaText: 'Ouvrir le pipeline',
      ctaPath: '/pipeline',
    }
  }, [echeances, currentMonthOps, annualStatus, previousAnnualStatus, currentMonth, previousMonth])

  return { data, isLoading }
}
