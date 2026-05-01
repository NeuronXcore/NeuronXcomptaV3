/**
 * Chapitre 01 — Synthèse exécutive : 4 MetricCards + Cadence mensuelle.
 */
import { Sparkles, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import type { LivretSynthese } from '@/types/livret'
import { formatCurrency } from '@/lib/utils'
import MetricCard from '@/components/shared/MetricCard'
import LivretChapterShell from './LivretChapterShell'
import LivretCadenceMensuelle from './LivretCadenceMensuelle'
import LivretDeltaPill from './LivretDeltaPill'

interface Props {
  chapter: LivretSynthese
}

export default function LivretSyntheseChapter({ chapter }: Props) {
  const { synthese } = chapter
  const metrics = synthese.metrics

  // Mapping label → icon (heuristique simple)
  const iconFor = (label: string) => {
    const l = label.toLowerCase()
    if (l.includes('recettes')) return <Wallet size={16} />
    if (l.includes('charges')) return <TrendingDown size={16} />
    if (l.includes('projeté')) return <Sparkles size={16} />
    if (l.includes('bnc')) return <TrendingUp size={16} />
    return null
  }

  return (
    <LivretChapterShell number={chapter.number} title={chapter.title} tag={chapter.tag}>
      {metrics.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {metrics.map((m) => (
            <div key={m.label} className="relative">
              <MetricCard
                title={m.label}
                value={formatCurrency(m.value)}
                icon={iconFor(m.label)}
                trend={m.value < 0 ? 'down' : m.label.toLowerCase().includes('charges') ? 'down' : 'up'}
                className={m.is_projection ? 'border-dashed border-primary/40' : undefined}
              />
              {m.is_projection && (
                <span className="absolute top-2 right-2 text-[9px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  projeté
                </span>
              )}
              {m.delta_n1 && !m.is_projection && (
                <div className="absolute bottom-2 right-2">
                  <LivretDeltaPill delta={m.delta_n1} size="sm" />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-text-muted italic mb-6 text-center py-6">
          Aucune métrique disponible — exercice à venir ou aucune donnée.
        </div>
      )}

      <LivretCadenceMensuelle cadence={synthese.cadence_mensuelle} />
    </LivretChapterShell>
  )
}
