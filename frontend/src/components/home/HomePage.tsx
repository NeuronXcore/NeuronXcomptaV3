import { useHomeData } from '@/hooks/useHomeData'
import { useNextAction } from '@/hooks/useNextAction'
import { AuroraBackground } from './AuroraBackground'
import { LogoLockup } from './LogoLockup'
import { HeroBlock } from './HeroBlock'
import { NextActionCard } from './NextActionCard'
import { PulseCard } from './PulseCard'
import { QuickActions } from './QuickActions'

/**
 * Page d'accueil — répond à « *que dois-je faire maintenant ?* ».
 *
 * Chorégraphie complète sur ~1.9s — voir prompt source pour la timeline détaillée.
 *
 * Architecture :
 * - z-0 : AuroraBackground (3 blobs en pointer-events: none)
 * - z-10 : main content (logo, hero, next action, 3 pulse cards, 5 quick actions)
 *
 * Aucun nouvel endpoint backend — les données viennent de hooks existants
 * (`useAnnualStatus`, `useAlertesSummary`, `useEcheances`, `useOperations`).
 */
export default function HomePage() {
  const { pulse } = useHomeData()
  const { data: nextAction } = useNextAction()

  return (
    <div className="relative min-h-full overflow-hidden">
      <AuroraBackground />

      <main className="relative z-10 max-w-6xl mx-auto px-2 py-4">
        <LogoLockup />
        <HeroBlock />

        <div className="mb-6">
          <NextActionCard data={nextAction} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mb-8">
          <PulseCard
            variant="ring"
            label={pulse.monthLabel}
            percent={pulse.monthCompletion}
            delay={1100}
            countUpDelay={1300}
          />
          <PulseCard
            variant="value"
            label="Prochaine échéance"
            value={pulse.nextEcheanceDays ?? 0}
            prefix={pulse.nextEcheanceDays != null ? 'J–' : undefined}
            subtitle={pulse.nextEcheanceName}
            delay={1200}
            countUpDelay={1300}
          />
          <PulseCard
            variant="dot"
            label="Alertes actives"
            count={pulse.alertesCount}
            severity={pulse.alertesSeverity}
            delay={1300}
            countUpDelay={1400}
          />
        </div>

        <QuickActions />
      </main>
    </div>
  )
}
