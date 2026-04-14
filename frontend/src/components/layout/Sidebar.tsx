import { useMemo, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Upload, Pencil, Tags, BarChart3,
  Settings, Bot, FileText, Paperclip, ScanLine, PackageCheck,
  CalendarCheck, AlertTriangle, TrendingUp,
  Boxes, Landmark, Calculator, ListChecks, ChevronLeft, ChevronRight, CheckSquare,
  Send, Receipt,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAlertesSummary } from '@/hooks/useAlertes'
import { usePipeline } from '@/hooks/usePipeline'
import { useOperationFiles } from '@/hooks/useOperations'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useTasks } from '@/hooks/useTasks'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import { useMLModel } from '@/hooks/useApi'
import { useEmailHistory } from '@/hooks/useEmail'
import { useJustificatifStats } from '@/hooks/useJustificatifs'
import { useGedStats } from '@/hooks/useGed'
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
      { to: '/charges-forfaitaires', label: 'Charges forfaitaires', icon: Receipt },
    ],
  },
  {
    label: 'Documents',
    items: [
      { to: '/ged', label: 'HUB', icon: Boxes },
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

  const { data: mlModel } = useMLModel()
  const agentBadgeCount = useMemo(() => {
    const uncategorized = alertesSummary?.par_type?.a_categoriser ?? 0
    if (uncategorized === 0) return 0
    const lastTraining = mlModel?.stats?.last_training
    if (!lastTraining) return uncategorized
    const daysSince = (Date.now() - new Date(lastTraining).getTime()) / (1000 * 60 * 60 * 24)
    return daysSince > 7 ? uncategorized : 0
  }, [alertesSummary, mlModel])

  const { data: emailHistory } = useEmailHistory()
  const emailSentCount = useMemo(() => {
    if (!emailHistory) return 0
    return emailHistory.filter(e => e.success).length
  }, [emailHistory])

  const { data: justifStats } = useJustificatifStats()
  const pendingScansCount = justifStats?.en_attente ?? 0

  const { data: gedStats } = useGedStats()
  const gedDocsCount = gedStats?.total_documents ?? 0

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
                'flex items-center gap-3 px-4 py-2.5 mx-3 rounded-lg text-sm font-semibold transition-all',
                isActive
                  ? 'bg-warning/15 text-warning border border-warning/30'
                  : 'bg-warning/10 text-warning hover:bg-warning/20 border border-warning/20'
              )
            }
          >
            <ListChecks size={18} />
            <span className="flex-1">Pipeline</span>
            <span className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-bold',
              globalProgress === 100
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-warning/20 text-warning'
            )}>
              {globalProgress}%
            </span>
          </NavLink>
          <div className="mx-3 mt-1.5">
            <button
              onClick={() => useSendDrawerStore.getState().open()}
              className="flex items-center gap-3 px-4 py-2.5 w-full rounded-lg text-sm font-medium transition-all bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20"
            >
              <Send size={18} />
              <span className="flex-1">Envoi comptable</span>
              {emailSentCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400">
                  {emailSentCount}
                </span>
              )}
            </button>
          </div>
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
                {to === '/agent-ai' && agentBadgeCount > 0 && (
                  <span className="ml-auto bg-purple-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {agentBadgeCount}
                  </span>
                )}
                {to === '/ocr' && pendingScansCount > 0 && (
                  <span className="ml-auto bg-orange-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {pendingScansCount}
                  </span>
                )}
                {to === '/ged' && gedDocsCount > 0 && (
                  <span className="ml-auto bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1.5 shadow-sm shadow-fuchsia-500/30">
                    {gedDocsCount}
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
