/**
 * Wrapper commun aux chapitres : <ch-head> (number + title + tag + ch-totals) + <children>.
 */
import type { ReactNode } from 'react'
import { formatCurrency } from '@/lib/utils'

import type { LivretDelta } from '@/types/livret'
import LivretDeltaPill from './LivretDeltaPill'

interface Props {
  number: string
  title: string
  tag?: string | null
  totalYtd?: number
  totalProjectedAnnual?: number | null
  deltaN1?: LivretDelta | null
  children: ReactNode
}

export default function LivretChapterShell({
  number,
  title,
  tag,
  totalYtd,
  totalProjectedAnnual,
  deltaN1,
  children,
}: Props) {
  return (
    <section
      id={`livret-chapter-${number}`}
      className="bg-surface rounded-2xl border border-border overflow-hidden mb-8 scroll-mt-24"
    >
      <header className="flex items-start justify-between gap-4 px-6 py-5 border-b border-border bg-gradient-to-br from-surface to-surface-hover">
        <div className="flex items-start gap-4">
          <div className="text-[11px] font-mono uppercase tracking-widest text-text-muted bg-surface-hover px-2 py-1 rounded">
            {number}
          </div>
          <div>
            <h2 className="text-xl font-bold text-text">{title}</h2>
            {tag && <p className="text-xs text-text-muted mt-1">{tag}</p>}
          </div>
        </div>

        {(totalYtd !== undefined || totalProjectedAnnual !== undefined) && (
          <div className="text-right">
            {totalYtd !== undefined && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">YTD</div>
                <div className="text-lg font-semibold text-text tabular-nums flex items-center gap-2 justify-end">
                  {formatCurrency(totalYtd)}
                  {deltaN1 && <LivretDeltaPill delta={deltaN1} size="sm" />}
                </div>
              </div>
            )}
            {totalProjectedAnnual !== undefined && totalProjectedAnnual !== null && (
              <div className="mt-1">
                <div className="text-[10px] uppercase tracking-wider text-primary/80">
                  Projeté annuel
                </div>
                <div className="text-sm font-medium text-primary tabular-nums">
                  {formatCurrency(totalProjectedAnnual)}
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="p-6">{children}</div>
    </section>
  )
}
