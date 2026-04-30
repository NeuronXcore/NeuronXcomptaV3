import { useState } from 'react'
import { Bell, ChevronDown, Check, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettings, useUpdateSettings } from '@/hooks/useApi'
import { useRappels } from '@/hooks/useRappels'
import type { RappelLevel } from '@/types'
import RappelItem from './RappelItem'
import RappelRulesMenu from './RappelRulesMenu'

/**
 * Détermine le niveau de criticité le plus haut parmi les comptes.
 * Critical > Warning > Info > null (cas vide géré ailleurs).
 */
function highestLevel(counts: Record<RappelLevel, number>): RappelLevel | null {
  if (counts.critical > 0) return 'critical'
  if (counts.warning > 0) return 'warning'
  if (counts.info > 0) return 'info'
  return null
}

/**
 * Bandeau « À ne pas oublier » placé en tête du Dashboard.
 *
 * - Replié par défaut (settings.rappels_collapsed === true).
 * - Si total === 0 → carte « Tout est à jour » (icône Check verte).
 * - Sinon → header cliquable (Bell + titre + 3 badges niveau + ChevronDown rotate).
 * - Le toggle persiste `rappels_collapsed` via useUpdateSettings (pattern miroir
 *   de auto_pointage).
 *
 * Tant que `useRappels()` n'a pas répondu, ne rend rien (évite un flash visuel
 * « Tout est à jour » avant d'afficher 5 rappels critiques).
 */
export default function DashboardRappels() {
  const { data: rappelsData, isLoading } = useRappels()
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const [rulesMenuOpen, setRulesMenuOpen] = useState(false)

  if (isLoading || !rappelsData) return null

  const collapsed = settings?.rappels_collapsed ?? true
  const total = rappelsData.total
  const counts = rappelsData.counts

  const toggleCollapsed = () => {
    updateSettings.mutate({ rappels_collapsed: !collapsed })
  }

  // Cas : tout est à jour
  if (total === 0) {
    return (
      <div className="relative bg-surface border border-border rounded-lg">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-success/15 text-success shrink-0">
            <Check size={16} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-text">Tout est à jour</div>
            <div className="text-[13px] text-text-muted">
              Aucun rappel comptable ou fiscal en attente.
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setRulesMenuOpen((v) => !v)
            }}
            className="text-text-muted hover:text-text transition-colors p-1.5 rounded-md hover:bg-background"
            title="Régler les rappels"
            aria-label="Régler les rappels"
          >
            <Settings2 size={14} />
          </button>
        </div>
        <RappelRulesMenu
          open={rulesMenuOpen}
          onClose={() => setRulesMenuOpen(false)}
          anchorRight={12}
        />
      </div>
    )
  }

  // Niveau le plus haut → couleur cloche + couleur badge.
  // Le CADRE du bandeau reste orange systématique (identité du widget) ;
  // seuls la cloche et le badge varient selon la gravité.
  const level = highestLevel(counts)
  const bellColor =
    level === 'critical' ? 'text-danger' :
    level === 'warning'  ? 'text-warning' :
    level === 'info'     ? 'text-primary' :
    'text-text-muted'

  // Animation cloche : uniquement quand replié + au moins 1 rappel.
  // Animation badge pulse : uniquement quand niveau critical (urgence).
  // Animation glow bandeau : quand replié + au moins 1 rappel (toujours orange).
  const ringBell = collapsed && total > 0
  const pulseBadge = collapsed && level === 'critical'
  const glowBanner = collapsed && total > 0

  // Couleurs du badge compteur (fond plein + texte blanc, bien visible).
  const badgeBg =
    level === 'critical' ? 'bg-danger' :
    level === 'warning'  ? 'bg-warning' :
    level === 'info'     ? 'bg-primary' :
    'bg-text-muted'

  return (
    <div
      className={cn(
        'relative border rounded-lg transition-colors',
        collapsed ? 'bg-warning/[0.04] border-warning/40' : 'bg-surface border-border',
        glowBanner && 'animate-nx-rappels-glow',
      )}
      style={glowBanner ? ({ ['--nx-glow' as never]: 'rgba(245, 158, 11, 0.55)' }) : undefined}
    >
      <div className="flex items-stretch">
        <button
          onClick={toggleCollapsed}
          className="flex-1 flex items-center justify-between px-4 py-3 hover:bg-background transition-colors rounded-l-lg"
        >
          <div className="flex items-center gap-2.5">
            <span className="relative inline-flex shrink-0">
              <Bell
                className={cn(
                  'w-4 h-4 transition-colors',
                  bellColor,
                  ringBell && 'animate-nx-bell-ring',
                )}
              />
              {collapsed && total > 0 && (
                <span
                  className={cn(
                    'absolute -top-2 -right-2 min-w-[16px] h-4 px-1 rounded-full text-white text-[9px] font-bold leading-none flex items-center justify-center ring-2 ring-surface',
                    badgeBg,
                    pulseBadge && 'animate-nx-badge-pulse',
                  )}
                  aria-label={`${total} rappel${total > 1 ? 's' : ''} en attente`}
                >
                  {total > 99 ? '99+' : total}
                </span>
              )}
            </span>
            <span className="font-medium text-sm text-text">
              À ne pas oublier · {total}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {counts.critical > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-danger/15 text-danger">
                {counts.critical} critique{counts.critical > 1 ? 's' : ''}
              </span>
            )}
            {counts.warning > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-warning/15 text-warning">
                {counts.warning} à prévoir
              </span>
            )}
            {counts.info > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                {counts.info} info
              </span>
            )}
            <ChevronDown
              className={cn(
                'w-4 h-4 text-text-muted transition-transform',
                !collapsed && 'rotate-180',
              )}
            />
          </div>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setRulesMenuOpen((v) => !v)
          }}
          className="flex items-center justify-center px-3 text-text-muted hover:text-text hover:bg-background transition-colors border-l border-border rounded-r-lg"
          title="Régler les rappels"
          aria-label="Régler les rappels"
        >
          <Settings2 size={14} />
        </button>
      </div>
      {!collapsed && (
        <div className="border-t border-border divide-y divide-border">
          {rappelsData.rappels.map((r) => (
            <RappelItem key={r.id} rappel={r} />
          ))}
        </div>
      )}
      <RappelRulesMenu
        open={rulesMenuOpen}
        onClose={() => setRulesMenuOpen(false)}
        anchorRight={0}
      />
    </div>
  )
}
