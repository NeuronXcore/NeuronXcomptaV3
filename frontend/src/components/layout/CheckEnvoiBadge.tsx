import { useMemo } from 'react'
import { useCheckReminderState, useCheckCoverage } from '@/hooks/useCheckEnvoi'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { cn } from '@/lib/utils'

/**
 * Badge sidebar Check d'envoi — couleur dynamique selon reminder actif.
 *
 * - rouge si N3 actif
 * - orange si N2
 * - amber si N1
 * - vert si tous mois clôturés validés
 * - rien sinon (mois courant pas encore clôturable)
 */
export default function CheckEnvoiBadge() {
  const { selectedYear } = useFiscalYearStore()
  const { data: reminder } = useCheckReminderState()
  const { data: coverage } = useCheckCoverage(selectedYear)

  const visual = useMemo(() => {
    const level = reminder?.should_show ? reminder.level : null
    if (level === 3) {
      return { tone: 'red', label: '!' }
    }
    if (level === 2) {
      return { tone: 'orange', label: '!' }
    }
    if (level === 1) {
      return { tone: 'amber', label: '!' }
    }
    // Tout vert si tous les mois clôturables validés
    if (coverage) {
      const now = new Date()
      const upTo = selectedYear < now.getFullYear() ? 12 : now.getMonth()
      let validated = 0
      let expected = 0
      for (let m = 1; m <= upTo; m++) {
        const key = String(m).padStart(2, '0')
        expected += 1
        if (coverage[key]) validated += 1
      }
      if (expected > 0 && validated === expected) {
        return { tone: 'green', label: '✓' }
      }
      if (validated > 0 && validated < expected) {
        return { tone: 'gray', label: `${expected - validated}` }
      }
    }
    return null
  }, [reminder, coverage, selectedYear])

  if (!visual) return null

  return (
    <span
      className={cn(
        'ml-auto text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1',
        visual.tone === 'red' && 'bg-danger',
        visual.tone === 'orange' && 'bg-orange-500',
        visual.tone === 'amber' && 'bg-amber-500',
        visual.tone === 'green' && 'bg-success',
        visual.tone === 'gray' && 'bg-text-muted/60',
      )}
      title={reminder?.message || (visual.tone === 'green' ? 'Tous validés' : 'Check d\'envoi en attente')}
    >
      {visual.label}
    </span>
  )
}
