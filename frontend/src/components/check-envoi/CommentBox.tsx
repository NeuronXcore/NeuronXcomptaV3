import { useEffect, useRef, useState } from 'react'

interface CommentBoxProps {
  initialValue: string | null
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
}

/**
 * Textarea avec debounce 500ms qui appelle onChange.
 * Mode preview "Visible dans l'email : "{comment}"" sous le textarea.
 */
export default function CommentBox({
  initialValue,
  onChange,
  placeholder = 'Commentaire libre…',
  required = false,
}: CommentBoxProps) {
  const [value, setValue] = useState(initialValue ?? '')
  const lastCommitted = useRef(initialValue ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync depuis le parent (ex. invalidation cache)
  useEffect(() => {
    if ((initialValue ?? '') !== lastCommitted.current) {
      setValue(initialValue ?? '')
      lastCommitted.current = initialValue ?? ''
    }
  }, [initialValue])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (value === lastCommitted.current) return
    timer.current = setTimeout(() => {
      lastCommitted.current = value
      onChange(value)
    }, 500)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, onChange])

  const isEmpty = !value.trim()
  const showError = required && isEmpty

  return (
    <div className="space-y-1">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className={
          'w-full bg-background border rounded-md px-3 py-2 text-sm text-text resize-y ' +
          'focus:outline-none focus:ring-2 transition-all ' +
          (showError
            ? 'border-danger focus:ring-danger/40'
            : 'border-border focus:ring-primary/40 focus:border-primary')
        }
      />
      {!isEmpty && (
        <p className="text-xs text-text-muted italic">
          Visible dans l'email : "{value.trim()}"
        </p>
      )}
      {showError && (
        <p className="text-xs text-danger">Commentaire obligatoire pour valider cet item.</p>
      )}
    </div>
  )
}
