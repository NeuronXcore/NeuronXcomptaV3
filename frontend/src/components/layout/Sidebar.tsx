import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Upload, Pencil, Tags, BarChart3,
  Settings, Bot, FileText, Paperclip, ScanLine, PackageCheck, Home,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: 'Accueil', icon: Home },
  { to: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/import', label: 'Importation', icon: Upload },
  { to: '/editor', label: 'Édition', icon: Pencil },
  { to: '/categories', label: 'Catégories', icon: Tags },
  { to: '/reports', label: 'Rapports', icon: FileText },
  { to: '/visualization', label: 'Compta Analytique', icon: BarChart3 },
  { to: '/justificatifs', label: 'Justificatifs', icon: Paperclip },
  { to: '/agent-ai', label: 'Agent IA', icon: Bot },
  { to: '/export', label: 'Export Comptable', icon: PackageCheck },
  { to: '/ocr', label: 'OCR', icon: ScanLine },
  { to: '/settings', label: 'Paramètres', icon: Settings },
]

export default function Sidebar() {
  return (
    <aside className="w-64 h-screen bg-surface border-r border-border flex flex-col fixed left-0 top-0">
      {/* Logo */}
      <div className="p-6 border-b border-border">
        <h1 className="text-xl font-bold text-primary">
          NeuronX<span className="text-text">compta</span>
        </h1>
        <p className="text-xs text-text-muted mt-1">Assistant Comptable IA</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-6 py-2.5 text-sm transition-colors',
                isActive
                  ? 'text-primary bg-primary/10 border-r-2 border-primary font-medium'
                  : 'text-text-muted hover:text-text hover:bg-surface-hover'
              )
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border text-xs text-text-muted">
        v3.0.0
      </div>
    </aside>
  )
}
