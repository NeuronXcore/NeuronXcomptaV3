import { useMemo } from 'react'
import { Lock } from 'lucide-react'
import { usePlaquetteSummary } from '@/hooks/usePlaquetteCheck'
import { cn } from '@/lib/utils'

interface PlaquetteSidebarBadgeProps {
  year: number
}

/**
 * Badge dynamique pour l'entrée sidebar « Vérification plaquette » (Session 39 P3).
 *
 * Tableau de priorités (premier match gagne) :
 *   1. status === 'declare'  → vert + icône Lock (exercice déclaré)
 *   2. n_risque_critique > 0 → rouge + `{n}!`
 *   3. n_risque_eleve > 0    → orange + `{n}!`
 *   4. n_a_challenger > 0    → ambre + `{n}`
 *   5. sinon                 → pas de badge (composant rend null)
 */
export default function PlaquetteSidebarBadge({ year }: PlaquetteSidebarBadgeProps) {
  const { data } = usePlaquetteSummary(year)

  const view = useMemo(() => {
    if (!data || !data.exists) return null

    if (data.status === 'declare') {
      const dateShort = data.declared_at
        ? new Date(data.declared_at).toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
          })
        : null
      return {
        node: <Lock size={11} strokeWidth={2.5} />,
        cls: 'bg-emerald-500/15 text-emerald-400',
        title: dateShort ? `Déclaré le ${dateShort}` : 'Exercice déclaré',
      }
    }

    const nCrit = data.n_risque_critique ?? 0
    if (nCrit > 0) {
      return {
        node: <>{nCrit}!</>,
        cls: 'bg-red-500/15 text-red-400',
        title: `${nCrit} risque(s) critique(s) à traiter`,
      }
    }

    const nEleve = data.n_risque_eleve ?? 0
    if (nEleve > 0) {
      return {
        node: <>{nEleve}!</>,
        cls: 'bg-orange-500/15 text-orange-400',
        title: `${nEleve} risque(s) élevé(s) à traiter`,
      }
    }

    const nChall = data.n_a_challenger ?? 0
    if (nChall > 0) {
      return {
        node: <>{nChall}</>,
        cls: 'bg-amber-500/15 text-amber-400',
        title: `${nChall} item(s) à challenger`,
      }
    }

    return null
  }, [data])

  if (!view) return null

  return (
    <span
      className={cn(
        'ml-auto text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1.5',
        view.cls,
      )}
      title={view.title}
    >
      {view.node}
    </span>
  )
}
