import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CheckEnvoiSection, CheckPeriod } from '@/types'
import CheckItem from './CheckItem'

interface CheckSectionProps {
  section: CheckEnvoiSection
  index: number
  year: number
  period: CheckPeriod
  month: number | null
}

function summary(section: CheckEnvoiSection): { label: string; tone: 'ok' | 'warning' | 'blocking' | 'pending' } {
  const counts = { ok: 0, warning: 0, blocking: 0, pending: 0 }
  for (const it of section.items) {
    if (it.status === 'auto_ok' || it.status === 'manual_ok') counts.ok += 1
    else if (it.status === 'auto_warning') counts.warning += 1
    else if (it.status === 'blocking') counts.blocking += 1
    else counts.pending += 1
  }
  // Priorité : bloquant > warning > pending > ok
  if (counts.blocking > 0) {
    return {
      label: counts.blocking === 1 ? '1 BLOQUANT' : `${counts.blocking} BLOQUANTS`,
      tone: 'blocking',
    }
  }
  if (counts.warning > 0) {
    return { label: `${counts.warning} à revoir`, tone: 'warning' }
  }
  if (counts.pending > 0) {
    return { label: `${counts.pending} en attente`, tone: 'pending' }
  }
  return {
    label: section.items.length === 1 ? 'OK' : `${section.items.length}/${section.items.length}`,
    tone: 'ok',
  }
}

export default function CheckSection({ section, index, year, period, month }: CheckSectionProps) {
  const [open, setOpen] = useState(false)
  const sum = summary(section)

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-background/40 transition-colors text-left"
      >
        {open ? (
          <ChevronDown size={18} className="text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight size={18} className="text-text-muted flex-shrink-0" />
        )}
        <span className="text-xs font-mono text-text-muted w-5 flex-shrink-0">{index + 1}.</span>
        <span className="flex-1 text-sm font-semibold text-text">{section.label}</span>
        <span
          className={cn(
            'text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider',
            sum.tone === 'blocking' && 'bg-danger/15 text-danger ring-1 ring-danger/30',
            sum.tone === 'warning' && 'bg-warning/15 text-warning ring-1 ring-warning/30',
            sum.tone === 'pending' && 'bg-text-muted/15 text-text-muted ring-1 ring-text-muted/20',
            sum.tone === 'ok' && 'bg-success/15 text-success ring-1 ring-success/30',
          )}
        >
          {sum.label}
        </span>
      </button>
      {open && (
        <div className="border-t border-border p-3 space-y-2 bg-background/30">
          {section.items.map((item) => (
            <CheckItem key={item.key} item={item} year={year} period={period} month={month} />
          ))}
        </div>
      )}
    </div>
  )
}
