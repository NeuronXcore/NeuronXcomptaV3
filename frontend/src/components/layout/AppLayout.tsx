import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useSandbox } from '@/hooks/useSandbox'

const APP_NAME = 'NeuronXcompta'

// Map route path → human label pour le titre d'onglet
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Pipeline',
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
  '/ged': 'HUB',
  '/tasks': 'Tâches',
  '/agent-ai': 'Agent IA',
  '/settings': 'Paramètres',
}

export default function AppLayout() {
  const { pathname } = useLocation()

  // Monter le SSE sandbox globalement pour que le badge pending scans (sidebar)
  // et le widget PendingScansWidget (Pipeline) s'auto-rafraîchissent quand un
  // scan est traité par le watchdog, peu importe la page courante.
  // Le hook invalide ['justificatifs'] + ['justificatif-stats'] à chaque event.
  useSandbox()

  useEffect(() => {
    const label = ROUTE_TITLES[pathname]
    document.title = label ? `${label} · ${APP_NAME}` : APP_NAME
  }, [pathname])

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
