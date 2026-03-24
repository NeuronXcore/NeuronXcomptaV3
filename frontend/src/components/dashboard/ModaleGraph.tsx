import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ExternalLink } from 'lucide-react'

interface ModaleGraphProps {
  title: string
  linkLabel?: string
  linkTo?: string
  onClose: () => void
  children: ReactNode
}

export default function ModaleGraph({ title, linkLabel, linkTo, onClose, children }: ModaleGraphProps) {
  const navigate = useNavigate()

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="max-w-3xl w-full bg-background border border-border rounded-xl p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-text">{title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="mb-6">{children}</div>

        {/* Optional link */}
        {linkLabel && linkTo && (
          <div className="flex justify-end">
            <button
              onClick={() => {
                navigate(linkTo)
                onClose()
              }}
              className="flex items-center gap-2 text-sm text-primary hover:text-primary-light transition-colors"
            >
              {linkLabel}
              <ExternalLink size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
