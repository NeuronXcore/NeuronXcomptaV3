import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { createElement } from 'react'
import toast from 'react-hot-toast'
import Sidebar from './Sidebar'
import { useSandbox } from '@/hooks/useSandbox'
import { useTasks } from '@/hooks/useTasks'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import MLRetrainToast from '@/components/shared/MLRetrainToast'

const APP_NAME = 'NeuronXcompta'

// Map route path → human label pour le titre d'onglet
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Accueil',
  '/pipeline': 'Pipeline',
  '/dashboard': 'Tableau de bord',
  '/import': 'Importation',
  '/editor': 'Édition',
  '/categories': 'Catégories',
  '/ocr': 'OCR',
  '/justificatifs': 'Justificatifs',
  '/alertes': "Compte d'attente",
  '/previsionnel': 'Prévisionnel',
  '/visualization': 'Compta Analytique',
  '/reports': 'Rapports',
  '/simulation': 'Simulation BNC',
  '/export': 'Export Comptable',
  '/cloture': 'Clôture',
  '/amortissements': 'Amortissements',
  '/charges-forfaitaires': 'Charges forfaitaires',
  '/check-envoi': "Check d'envoi",
  '/ged': 'HUB',
  '/tasks': 'Tâches',
  '/snapshots': 'Snapshots',
  '/agent-ai': 'Agent IA',
  '/settings': 'Paramètres',
}

export default function AppLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const selectedYear = useFiscalYearStore((s) => s.selectedYear)

  // Monter le SSE sandbox globalement pour que le badge pending scans (sidebar)
  // et le widget PendingScansWidget (Pipeline) s'auto-rafraîchissent quand un
  // scan est traité par le watchdog, peu importe la page courante.
  // Le hook invalide ['justificatifs'] + ['justificatif-stats'] à chaque event.
  useSandbox()

  useEffect(() => {
    const label = ROUTE_TITLES[pathname]
    document.title = label ? `${label} · ${APP_NAME}` : APP_NAME
  }, [pathname])

  // ── Toast "Modèle IA à réentraîner" — 1× par session uniquement ──
  // Lecture de la tâche auto `ml_retrain` dans les tâches courantes (scope year
  // = année globale). Gate via sessionStorage pour éviter la répétition après
  // navigation intra-SPA + un useRef pour éviter la double exécution de l'effect
  // en mode Strict React.
  const mlToastShown = useRef(false)
  const { data: tasks } = useTasks(selectedYear)

  useEffect(() => {
    if (mlToastShown.current) return
    if (typeof window !== 'undefined' && sessionStorage.getItem('ml-retrain-toast-shown')) return
    if (!tasks) return

    const mlTask = tasks.find((t) => t.auto_key === 'ml_retrain')
    if (!mlTask) return

    const corrections = Number(mlTask.metadata?.corrections_count ?? 0)
    if (corrections <= 0) return

    const days = Number(mlTask.metadata?.days_since_training ?? 999)
    const actionUrl = String(mlTask.metadata?.action_url ?? '/agent-ai')

    mlToastShown.current = true
    sessionStorage.setItem('ml-retrain-toast-shown', '1')

    const toastId = 'ml-retrain'
    toast.custom(
      (t) =>
        createElement(MLRetrainToast, {
          toastId: t.id,
          visible: t.visible,
          correctionsCount: corrections,
          daysSince: days,
          onClickRetrain: () => navigate(actionUrl),
        }),
      {
        id: toastId,
        duration: Infinity,
        position: 'top-right',
      },
    )
  }, [tasks, navigate])

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
