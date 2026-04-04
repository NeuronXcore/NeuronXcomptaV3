import { ChevronRight } from 'lucide-react'

interface GedBreadcrumbProps {
  path: Array<{ id: string; label: string }>
  onNavigate: (nodeId: string) => void
}

export default function GedBreadcrumb({ path, onNavigate }: GedBreadcrumbProps) {
  return (
    <div className="flex items-center gap-1 text-sm">
      {path.map((segment, i) => (
        <div key={segment.id} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={14} className="text-text-muted" />}
          {i < path.length - 1 ? (
            <button
              onClick={() => onNavigate(segment.id)}
              className="text-text-muted hover:text-primary transition-colors"
            >
              {segment.label}
            </button>
          ) : (
            <span className="text-text font-medium">{segment.label}</span>
          )}
        </div>
      ))}
    </div>
  )
}
