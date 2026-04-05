import { useMemo, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Upload, Pencil, Tags, BarChart3,
  Settings, Bot, FileText, Paperclip, ScanLine, PackageCheck,
  GitCompareArrows, CalendarCheck, AlertTriangle, TrendingUp,
  Library, Landmark, Calculator, ListChecks, ChevronLeft, ChevronRight, CheckSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAlertesSummary } from '@/hooks/useAlertes'
import { usePipeline } from '@/hooks/usePipeline'
import { useOperationFiles } from '@/hooks/useOperations'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useTasks } from '@/hooks/useTasks'
import SidebarLogo from './SidebarLogo'

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
    ],
  },
  {
    label: 'Analyse',
    items: [
      { to: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
      { to: '/previsionnel', label: 'Prévisionnel', icon: TrendingUp },
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
      { to: '/tasks', label: 'Tâches', icon: CheckSquare },
      { to: '/agent-ai', label: 'Agent IA', icon: Bot },
      { to: '/settings', label: 'Paramètres', icon: Settings },
    ],
  },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const { data: alertesSummary } = useAlertesSummary()
  const alertesCount = alertesSummary?.total_en_attente ?? 0
  const { globalProgress } = usePipeline()
  const { selectedYear, setYear } = useFiscalYearStore()
  const { data: files } = useOperationFiles()

  const filesLoaded = !!files
  const availableYears = useMemo(() => {
    if (!files?.length) return [new Date().getFullYear()]
    const years = [...new Set(files.filter(f => f.year).map(f => f.year!))] as number[]
    years.sort((a, b) => b - a)
    return years.length > 0 ? years : [new Date().getFullYear()]
  }, [files])

  useEffect(() => {
    if (!filesLoaded) return
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setYear(availableYears[0])
    }
  }, [filesLoaded, availableYears, selectedYear, setYear])

  const { data: tasksList } = useTasks(selectedYear)
  const tasksToDoCount = useMemo(() => {
    if (!tasksList) return 0
    return tasksList.filter(t => t.status !== 'done').length
  }, [tasksList])

  return (
    <aside className="w-64 h-screen bg-surface border-r border-border flex flex-col fixed left-0 top-0">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5 border-b border-border">
        <SidebarLogo />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {/* Pipeline - standalone item above sections */}
        <div className="pb-2 mb-1 border-b border-border">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-6 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'text-primary bg-primary/10 border-r-2 border-primary'
                  : 'text-text hover:text-primary hover:bg-surface-hover'
              )
            }
          >
            <ListChecks size={18} />
            <span className="flex-1">Pipeline</span>
          </NavLink>
          {/* Pipeline progress badge */}
          <button
            onClick={() => navigate('/')}
            className={cn(
              'flex items-center gap-2 mx-6 mt-1 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer',
              'transition-colors hover:bg-primary/20',
              globalProgress === 100
                ? 'bg-emerald-900/20 text-emerald-400'
                : globalProgress > 50
                ? 'bg-amber-900/20 text-amber-400'
                : 'bg-gray-700/50 text-gray-400'
            )}
          >
            <div className="w-2 h-2 rounded-full" style={{
              background: globalProgress === 100 ? '#0F6E56' : globalProgress > 50 ? '#BA7517' : '#5F5E5A'
            }} />
            {globalProgress}%
          </button>
        </div>

        {/* Year selector */}
        <div className="px-3 py-2 mb-2">
          <div className="flex items-center justify-between bg-surface/50 rounded-lg px-2 py-1.5 border border-border/50">
            <button
              onClick={() => {
                const idx = availableYears.indexOf(selectedYear)
                if (idx < availableYears.length - 1) setYear(availableYears[idx + 1])
              }}
              disabled={availableYears.indexOf(selectedYear) >= availableYears.length - 1}
              className="p-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed text-text-muted hover:text-text transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-semibold text-text tabular-nums">{selectedYear}</span>
            <button
              onClick={() => {
                const idx = availableYears.indexOf(selectedYear)
                if (idx > 0) setYear(availableYears[idx - 1])
              }}
              disabled={availableYears.indexOf(selectedYear) <= 0}
              className="p-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed text-text-muted hover:text-text transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Section groups */}
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mt-1">
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold px-6 pt-3 pb-1">
              {section.label}
            </p>
            {section.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
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
                {to === '/tasks' && tasksToDoCount > 0 && (
                  <span className="ml-auto bg-amber-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {tasksToDoCount}
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
