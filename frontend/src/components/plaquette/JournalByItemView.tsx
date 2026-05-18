import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Mail, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useJournalGroupedByItem } from '@/hooks/usePlaquetteCheck'
import type { PlaquetteJournalEntry } from '@/types'
import { JournalAttachmentList } from './JournalAttachmentList'

interface JournalByItemViewProps {
  year: number
}

function _entryIcon(type: PlaquetteJournalEntry['type']) {
  if (type === 'email_out') return { Icon: Mail, color: 'text-sky-400 bg-sky-500/15' }
  if (type === 'email_in')
    return { Icon: Mail, color: 'text-emerald-400 bg-emerald-500/15' }
  return { Icon: MessageSquare, color: 'text-text-muted bg-text-muted/15' }
}

function _formatTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ts
  }
}

/**
 * Vue alternative du journal : items expandables avec leurs entries chronologiques.
 * Items sans entry masqués par défaut (toggle "Voir aussi…").
 *
 * Session 39 P1.
 */
export function JournalByItemView({ year }: JournalByItemViewProps) {
  const { data, isLoading } = useJournalGroupedByItem(year)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showEmpty, setShowEmpty] = useState(false)

  const groups = useMemo(() => Object.values(data ?? {}), [data])

  const visibleGroups = useMemo(
    () => groups.filter((g) => showEmpty || g.entries.length > 0),
    [groups, showEmpty],
  )

  const emptyCount = useMemo(
    () => groups.filter((g) => g.entries.length === 0).length,
    [groups],
  )

  const toggle = (itemId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="py-6 text-center text-xs text-text-muted">
        Chargement de la vue par item…
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface/30 p-6 text-center">
        <p className="text-xs text-text-muted">Aucun item dans la plaquette.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">
          {visibleGroups.length} item(s) affiché(s) sur {groups.length}
        </span>
        {emptyCount > 0 && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span className="text-text-muted">
              Voir aussi les items sans échange ({emptyCount})
            </span>
          </label>
        )}
      </div>

      <div className="space-y-1.5">
        {visibleGroups.map((group) => {
          const isOpen = expanded.has(group.item_id)
          const hasEntries = group.entries.length > 0
          return (
            <div
              key={group.item_id}
              className={cn(
                'rounded-md border bg-surface/40',
                hasEntries ? 'border-border' : 'border-border/40',
              )}
            >
              <button
                type="button"
                onClick={() => toggle(group.item_id)}
                disabled={!hasEntries}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs',
                  hasEntries ? 'hover:bg-surface' : 'cursor-default opacity-60',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {hasEntries ? (
                    isOpen ? (
                      <ChevronDown size={14} className="flex-none text-text-muted" />
                    ) : (
                      <ChevronRight size={14} className="flex-none text-text-muted" />
                    )
                  ) : (
                    <span className="w-3.5" />
                  )}
                  <span className="font-mono text-[11px] text-text-muted flex-none">
                    {group.compte_pcg || '—'}
                  </span>
                  <span className="truncate text-text">{group.compte_label}</span>
                  {group.rubrique_2035 && (
                    <span className="hidden md:inline truncate text-text-muted">
                      · {group.rubrique_2035}
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    'flex-none rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                    hasEntries
                      ? 'bg-primary/15 text-primary'
                      : 'bg-text-muted/10 text-text-muted',
                  )}
                >
                  {group.entries.length}
                </span>
              </button>

              {isOpen && hasEntries && (
                <div className="border-t border-border bg-background/40 px-3 py-2 space-y-2">
                  {group.entries.map((entry) => {
                    const { Icon, color } = _entryIcon(entry.type)
                    return (
                      <div
                        key={entry.entry_id}
                        className={cn(
                          'rounded-md border border-border/60 bg-surface/40 p-2.5',
                          entry.type === 'email_in' &&
                            'border-emerald-500/30 bg-emerald-500/5',
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className={cn(
                              'mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full',
                              color,
                            )}
                          >
                            <Icon size={11} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs font-medium text-text truncate">
                                {entry.subject || '(sans objet)'}
                              </span>
                              <span className="text-[10px] tabular-nums text-text-muted flex-none">
                                {_formatTs(entry.timestamp)}
                              </span>
                            </div>
                            {entry.body_excerpt && (
                              <p className="mt-1 whitespace-pre-wrap text-[11px] text-text-muted">
                                {entry.body_excerpt}
                              </p>
                            )}
                            <JournalAttachmentList
                              year={year}
                              entryId={entry.entry_id}
                              attachments={entry.attachments || []}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
