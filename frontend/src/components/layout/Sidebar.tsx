import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Upload, Pencil, Tags, BarChart3,
  Settings, Bot, FileText, Paperclip, ScanLine, PackageCheck,
  GitCompareArrows, CalendarCheck, CalendarClock, AlertTriangle,
  Library, Landmark, Calculator,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAlertesSummary } from '@/hooks/useAlertes'

const NAV_SECTIONS = [
  {
    label: 'Saisie',
    items: [
      { to: '/import', label: 'Importation', icon: Upload },
      { to: '/editor', label: 'Édition', icon: Pencil },
      { to: '/categories', label: 'Catégories', icon: Tags },
      { to: '/ocr', label: 'OCR', icon: ScanLine },
    ],
  },
  {
    label: 'Traitement',
    items: [
      { to: '/justificatifs', label: 'Justificatifs', icon: Paperclip },
      { to: '/rapprochement', label: 'Rapprochement', icon: GitCompareArrows },
      { to: '/alertes', label: "Compte d'attente", icon: AlertTriangle },
      { to: '/echeancier', label: 'Échéancier', icon: CalendarClock },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { to: '/', label: 'Tableau de bord', icon: LayoutDashboard },
      { to: '/visualization', label: 'Compta Analytique', icon: BarChart3 },
      { to: '/reports', label: 'Rapports', icon: FileText },
      { to: '/simulation', label: 'Simulation BNC', icon: Calculator },
    ],
  },
  {
    label: 'Clôture',
    items: [
      { to: '/export', label: 'Export Comptable', icon: PackageCheck },
      { to: '/cloture', label: 'Clôture', icon: CalendarCheck },
      { to: '/amortissements', label: 'Amortissements', icon: Landmark },
    ],
  },
  {
    label: 'Documents',
    items: [
      { to: '/ged', label: 'Bibliothèque', icon: Library },
    ],
  },
  {
    label: 'Outils',
    items: [
      { to: '/agent-ai', label: 'Agent IA', icon: Bot },
      { to: '/settings', label: 'Paramètres', icon: Settings },
    ],
  },
]

export default function Sidebar() {
  const { data: alertesSummary } = useAlertesSummary()
  const alertesCount = alertesSummary?.total_en_attente ?? 0

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
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mt-1">
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold px-6 pt-3 pb-1">
              {section.label}
            </p>
            {section.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-6 py-2 text-sm transition-colors',
                    isActive
                      ? 'text-primary bg-primary/10 border-r-2 border-primary font-medium'
                      : 'text-text-muted hover:text-text hover:bg-surface-hover'
                  )
                }
              >
                <Icon size={18} />
                <span className="flex-1">{label}</span>
                {to === '/alertes' && alertesCount > 0 && (
                  <span className="ml-auto bg-danger text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {alertesCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border text-xs text-text-muted">
        v3.0.0
      </div>
    </aside>
  )
}
