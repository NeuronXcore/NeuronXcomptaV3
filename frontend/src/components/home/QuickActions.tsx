import { useNavigate } from 'react-router-dom'
import { Activity, Paperclip, Pencil, ScanLine, Upload, type LucideIcon } from 'lucide-react'

interface QuickAction {
  label: string
  Icon: LucideIcon
  path: string
}

const ACTIONS: QuickAction[] = [
  { label: 'Importer',      Icon: Upload,    path: '/import' },
  { label: 'OCR',           Icon: ScanLine,  path: '/ocr' },
  { label: 'Éditeur',       Icon: Pencil,    path: '/editor' },
  { label: 'Justificatifs', Icon: Paperclip, path: '/justificatifs' },
  { label: 'Rapprocher',    Icon: Activity,  path: '/justificatifs?filter=sans' },
]

/**
 * 5 boutons en grid 1fr × 5, gap 10px.
 *
 * Animation : label "Actions rapides" fade-in à t=1500, puis chaque bouton
 * en stagger 50ms (t=1600 → t=1800).
 */
export function QuickActions() {
  const navigate = useNavigate()

  return (
    <div>
      <div
        className="text-[11px] uppercase tracking-[0.10em] text-text-muted mb-3"
        style={{ opacity: 0, animation: 'nx-fade 300ms ease-out 1500ms forwards' }}
      >
        Actions rapides
      </div>
      <div className="grid grid-cols-5 gap-2.5">
        {ACTIONS.map((a, i) => (
          <button
            key={a.label}
            type="button"
            onClick={() => navigate(a.path)}
            className="group flex flex-col items-center justify-center gap-2 px-2 py-4 rounded-xl
                       bg-white/[0.025] border border-white/[0.06]
                       hover:bg-primary/10 hover:border-primary/30 hover:-translate-y-0.5
                       transition-all duration-[180ms] ease-out"
            style={{
              opacity: 0,
              animation: `nx-fade-up 280ms ease-out ${1600 + i * 50}ms forwards`,
            }}
          >
            <a.Icon
              size={20}
              className="text-text-muted group-hover:text-primary-light transition-colors"
            />
            <span className="text-[12px] font-medium text-text">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
