import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { useSnoozeRappel } from '@/hooks/useRappels'
import type { Rappel } from '@/types'
import RappelLevelIcon from './RappelLevelIcon'

interface RappelItemProps {
  rappel: Rappel
}

const SNOOZE_OPTIONS: { days: number; label: string; toastMsg: string }[] = [
  { days: 1, label: '1 jour', toastMsg: 'Reporté à demain' },
  { days: 7, label: '7 jours', toastMsg: 'Reporté de 7 jours' },
  { days: 30, label: '30 jours', toastMsg: 'Reporté de 30 jours' },
]

const CATEGORY_LABEL: Record<Rappel['categorie'], string> = {
  fiscal: 'Fiscal',
  comptable: 'Comptable',
  scp: 'SCP',
  patrimoine: 'Patrimoine',
  tresorerie: 'Trésorerie',
}

/**
 * Ligne individuelle d'un rappel.
 *
 * Layout : icône colorée 28px à gauche, bloc central (catégorie / titre / message),
 * boutons à droite (CTA conditionnel + menu Reporter conditionnel).
 *
 * Interactions :
 * - Clic CTA → navigate(rappel.cta.route).
 * - Clic Reporter → ouvre un mini-menu avec 3 durées (1j / 7j / 30j). Sélection →
 *   animation slide-out 280ms puis mutation. Toast confirm contextuel.
 * - Clic outside ou Esc → ferme le menu.
 */
export default function RappelItem({ rappel }: RappelItemProps) {
  const navigate = useNavigate()
  const snoozeMutation = useSnoozeRappel()
  const [removing, setRemoving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Fermeture du menu sur clic outside ou Esc
  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [menuOpen])

  const handleCta = () => {
    if (rappel.cta) navigate(rappel.cta.route)
  }

  const handleSnooze = (days: number, toastMsg: string) => {
    if (!rappel.snoozable || removing) return
    setMenuOpen(false)
    setRemoving(true)
    // Laisse l'animation slide-out se jouer avant l'invalidation TanStack
    // (sinon le re-render flash plutôt qu'une transition fluide).
    setTimeout(() => {
      snoozeMutation.mutate(
        { ruleId: rappel.id, days },
        {
          onSuccess: () => toast.success(toastMsg),
          onError: () => {
            toast.error('Impossible de reporter le rappel')
            setRemoving(false)
          },
        },
      )
    }, 280)
  }

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 transition-all duration-[280ms] ease-out',
        removing && 'opacity-0 -translate-x-5 max-h-0 py-0 overflow-hidden',
      )}
      style={{ maxHeight: removing ? 0 : 200 }}
    >
      <RappelLevelIcon level={rappel.niveau} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
          {CATEGORY_LABEL[rappel.categorie] ?? rappel.categorie}
        </div>
        <div className="text-sm font-medium text-text leading-tight mt-0.5">{rappel.titre}</div>
        <div className="text-[13px] text-text-muted mt-0.5">{rappel.message}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {rappel.cta && (
          <button
            onClick={handleCta}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
            title={`Aller à ${rappel.cta.route}`}
          >
            {rappel.cta.label}
            <ArrowRight size={12} />
          </button>
        )}
        {rappel.snoozable && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              disabled={removing || snoozeMutation.isPending}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50',
                menuOpen
                  ? 'bg-surface-hover text-text'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text',
              )}
              title="Reporter ce rappel"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              Reporter
              <Clock size={12} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-20 min-w-[140px] bg-surface border border-border rounded-md shadow-lg py-1"
              >
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted font-medium border-b border-border">
                  Reporter de…
                </div>
                {SNOOZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.days}
                    role="menuitem"
                    onClick={() => handleSnooze(opt.days, opt.toastMsg)}
                    className="w-full text-left px-3 py-1.5 text-xs text-text hover:bg-surface-hover transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
