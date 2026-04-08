import { useState, useCallback } from 'react'
import { X } from 'lucide-react'

interface EmailChipsInputProps {
  emails: string[]
  onChange: (emails: string[]) => void
  placeholder?: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function EmailChipsInput({ emails, onChange, placeholder = 'Ajouter un email…' }: EmailChipsInputProps) {
  const [input, setInput] = useState('')

  const addEmail = useCallback(() => {
    const trimmed = input.trim()
    if (trimmed && EMAIL_REGEX.test(trimmed) && !emails.includes(trimmed)) {
      onChange([...emails, trimmed])
      setInput('')
    }
  }, [input, emails, onChange])

  const removeEmail = (email: string) => {
    onChange(emails.filter(e => e !== email))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addEmail()
    } else if (e.key === 'Backspace' && input === '' && emails.length > 0) {
      onChange(emails.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 bg-background border border-border rounded-lg px-2 py-1.5 min-h-[38px] focus-within:border-primary transition-colors">
      {emails.map(email => (
        <span
          key={email}
          className="flex items-center gap-1 bg-blue-500/10 text-blue-400 rounded-full px-3 py-0.5 text-sm"
        >
          {email}
          <button
            onClick={() => removeEmail(email)}
            className="hover:text-blue-200 transition-colors"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        type="email"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addEmail}
        placeholder={emails.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent text-sm text-text outline-none placeholder:text-text-muted/50"
      />
    </div>
  )
}
