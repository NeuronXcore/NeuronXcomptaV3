import { useState, useRef, useEffect, useCallback } from 'react'
import { Users2, Check } from 'lucide-react'

interface ParticipantsCellProps {
  value: string | null | undefined
  onSave: (value: string) => void
  disabled?: boolean
}

export function ParticipantsCell({ value, onSave, disabled }: ParticipantsCellProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const popoverRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const filled = !!value?.trim()
  const count = filled ? value!.split(',').filter(s => s.trim()).length : 0

  // Sync draft when value changes externally
  useEffect(() => {
    if (!open) setDraft(value || '')
  }, [value, open])

  // Focus textarea on open
  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [open])

  // Click-outside handler
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSave = useCallback(() => {
    onSave(draft.trim())
    setOpen(false)
  }, [draft, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  return (
    <div className="relative flex items-center justify-center">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex items-center gap-0.5 p-1 rounded hover:bg-white/5 transition-colors disabled:opacity-40"
        title={filled ? value! : 'Ajouter des participants'}
      >
        <Users2
          size={16}
          className={filled ? 'text-violet-400' : 'text-text-muted'}
        />
        {count > 0 && (
          <span className="text-[10px] font-medium text-violet-400 min-w-[14px]">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 w-72 bg-surface border border-border rounded-lg shadow-lg p-3"
        >
          <textarea
            ref={textareaRef}
            rows={3}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Dr Martin (chirurgien), Dr Blanc (cardiologue)..."
            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm text-text resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-text-muted">Ctrl+Entrée pour enregistrer</span>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
            >
              <Check size={12} />
              Enregistrer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
