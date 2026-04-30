import { useEffect, useRef } from 'react'
import { Settings2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettings, useUpdateSettings } from '@/hooks/useApi'
import { useRappelRules } from '@/hooks/useRappels'

interface RappelRulesMenuProps {
  open: boolean
  onClose: () => void
  /** Coordonnée droite (px) pour ancrer le popover sous le bouton trigger. */
  anchorRight?: number
}

/**
 * Popover « Régler les rappels » — toggle on/off pour chaque règle.
 *
 * Source backend : `GET /api/rappels/rules` (rule_id, label, description, enabled).
 * Persistance : `PUT /api/settings { rappels_disabled_rules }`.
 *
 * Pas de drawer ici (overkill pour ~7 toggles) — popover absolute ancré au bouton
 * trigger. Clic outside / Esc → ferme. Optimistic UI : on update settings, le
 * fetch `/rules` se rafraîchit via invalidation de `['settings']` (pas de
 * mutation directe sur `['rappels', 'rules']` — l'enabled est dérivé).
 */
export default function RappelRulesMenu({ open, onClose, anchorRight = 0 }: RappelRulesMenuProps) {
  const { data: rules } = useRappelRules()
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open, onClose])

  if (!open) return null

  const disabled = new Set(settings?.rappels_disabled_rules ?? [])

  const toggleRule = (ruleId: string, currentlyEnabled: boolean) => {
    const next = new Set(disabled)
    if (currentlyEnabled) {
      next.add(ruleId)
    } else {
      next.delete(ruleId)
    }
    updateSettings.mutate({ rappels_disabled_rules: Array.from(next) })
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Régler les rappels"
      className="absolute top-full mt-2 z-30 w-[420px] max-w-[90vw] bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
      style={{ right: anchorRight }}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/50">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-text-muted" />
          <span className="text-sm font-medium text-text">Régler les rappels</span>
        </div>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text transition-colors"
          title="Fermer"
        >
          <X size={16} />
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
        {!rules && (
          <div className="px-4 py-6 text-center text-xs text-text-muted">Chargement…</div>
        )}
        {rules?.map((rule) => {
          const enabled = !disabled.has(rule.rule_id)
          return (
            <button
              key={rule.rule_id}
              onClick={() => toggleRule(rule.rule_id, enabled)}
              className="w-full text-left px-4 py-3 hover:bg-background/50 transition-colors flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className={cn(
                  'text-sm font-medium leading-tight',
                  enabled ? 'text-text' : 'text-text-muted',
                )}>
                  {rule.label}
                </div>
                <div className="text-[12px] text-text-muted mt-0.5 leading-snug">
                  {rule.description}
                </div>
              </div>
              <div
                className={cn(
                  'shrink-0 mt-0.5 inline-flex items-center w-9 h-5 rounded-full transition-colors',
                  enabled ? 'bg-primary' : 'bg-border',
                )}
                aria-pressed={enabled}
              >
                <span
                  className={cn(
                    'inline-block w-4 h-4 rounded-full bg-surface shadow transition-transform',
                    enabled ? 'translate-x-[18px]' : 'translate-x-[2px]',
                  )}
                />
              </div>
            </button>
          )
        })}
      </div>
      <div className="px-4 py-2 text-[11px] text-text-muted bg-background/30 border-t border-border">
        Les règles désactivées ne génèrent plus de rappels. Modifiable à tout moment.
      </div>
    </div>
  )
}
