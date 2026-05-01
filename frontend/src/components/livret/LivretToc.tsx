/**
 * Sommaire grid 9 chapitres. Clic = scrollIntoView vers la section.
 * Phase 1 : seuls 01/02/03 sont actifs ; les autres sont stubbed.
 */
import type { TocEntry } from '@/types/livret'
import { cn } from '@/lib/utils'

interface Props {
  toc: TocEntry[]
  activeChapters: Set<string>
}

export default function LivretToc({ toc, activeChapters }: Props) {
  const handleClick = (number: string) => {
    const el = document.getElementById(`livret-chapter-${number}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav className="my-6">
      <h2 className="text-xs uppercase tracking-wider text-text-muted mb-3 font-semibold">
        Sommaire
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        {toc.map((entry) => {
          const isActive = activeChapters.has(entry.number)
          return (
            <button
              key={entry.number}
              type="button"
              onClick={() => isActive && handleClick(entry.number)}
              disabled={!isActive}
              className={cn(
                'text-left px-3 py-2 rounded-lg border transition-all',
                isActive
                  ? 'bg-surface border-border hover:border-primary hover:ring-2 hover:ring-primary/20 text-text cursor-pointer'
                  : 'bg-surface-hover border-border text-text-muted opacity-50 cursor-not-allowed',
              )}
              title={!isActive ? 'Chapitre disponible en Phase 2' : undefined}
            >
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-mono">
                {entry.number}
              </div>
              <div className="text-sm font-medium leading-tight">{entry.title}</div>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
