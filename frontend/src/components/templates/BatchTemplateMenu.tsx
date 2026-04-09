import { useState, useRef, useEffect } from 'react'
import { Layers, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTemplates } from '@/hooks/useTemplates'
import type { JustificatifTemplate } from '@/types'

interface Props {
  onSelect: (template: JustificatifTemplate) => void
  className?: string
}

export default function BatchTemplateMenu({ onSelect, className }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data: templates } = useTemplates()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!templates?.length) return null

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors"
      >
        <Layers size={14} />
        Batch fac-simile
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 overflow-hidden">
          <p className="px-3 py-1.5 text-[10px] text-text-muted font-medium uppercase">Templates</p>
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => { onSelect(tpl); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs text-text hover:bg-surface-hover transition-colors flex items-center justify-between"
            >
              <span className="truncate">{tpl.vendor}</span>
              {tpl.category && (
                <span className="text-[10px] text-text-muted ml-2 shrink-0">{tpl.category}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
