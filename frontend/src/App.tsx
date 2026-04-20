import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useSettings } from '@/hooks/useApi'
import AppLayout from '@/components/layout/AppLayout'
import PipelinePage from '@/components/pipeline/PipelinePage'
import DashboardPage from '@/components/dashboard/DashboardPage'
import ImportPage from '@/components/import/ImportPage'
import EditorPage from '@/components/editor/EditorPage'
import CategoriesPage from '@/components/categories/CategoriesPage'
import ReportsPage from '@/components/reports/ReportsPage'
import ComptaAnalytiquePage from '@/components/compta-analytique/ComptaAnalytiquePage'
import AgentIAPage from '@/components/agent-ia/AgentIAPage'
import JustificatifsPage from '@/components/justificatifs/JustificatifsPage'
import OcrPage from '@/components/ocr/OcrPage'
import ExportPage from '@/components/export/ExportPage'
import { Navigate } from 'react-router-dom'
import CloturePage from '@/components/cloture/CloturePage'
import AlertesPage from '@/pages/AlertesPage'
import SettingsPage from '@/components/settings/SettingsPage'
import GedPage from '@/components/ged/GedPage'
import AmortissementsPage from '@/components/amortissements/AmortissementsPage'
import SimulationPage from '@/components/simulation/SimulationPage'
import PrevisionnelPage from '@/components/previsionnel/PrevisionnelPage'
import TasksPage from '@/components/tasks/TasksPage'
import SnapshotsPage from '@/components/snapshots/SnapshotsPage'
import ChargesForfaitairesPage from '@/components/charges-forfaitaires/ChargesForfaitairesPage'
import SendToAccountantDrawer from '@/components/email/SendToAccountantDrawer'
import LiasseScpDrawer from '@/components/liasse/LiasseScpDrawer'

export default function App() {
  const { data: settings } = useSettings()

  // Apply dark mode + theme colors
  useEffect(() => {
    const root = document.documentElement
    const isDark = settings?.dark_mode ?? true
    root.classList.toggle('dark', isDark)

    // Apply theme colors
    if (settings?.theme_settings) {
      const { primary_color, background_color, text_color } = settings.theme_settings
      if (primary_color) root.style.setProperty('--color-primary', primary_color)
      if (background_color) root.style.setProperty('--color-surface', background_color)
      if (text_color) root.style.setProperty('--color-text', text_color)
    }
  }, [settings?.dark_mode, settings?.theme_settings])

  return (
    <>
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
        },
      }}
    />
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<PipelinePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/visualization" element={<ComptaAnalytiquePage />} />
        <Route path="/justificatifs" element={<JustificatifsPage />} />
        <Route path="/rapprochement" element={<Navigate to="/justificatifs" replace />} />
        <Route path="/alertes" element={<AlertesPage />} />
        <Route path="/agent-ai" element={<AgentIAPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/cloture" element={<CloturePage />} />
        <Route path="/ocr" element={<OcrPage />} />
        <Route path="/amortissements" element={<AmortissementsPage />} />
        <Route path="/charges-forfaitaires" element={<ChargesForfaitairesPage />} />
        <Route path="/simulation" element={<SimulationPage />} />
        <Route path="/previsionnel" element={<PrevisionnelPage />} />
        <Route path="/ged" element={<GedPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/snapshots" element={<SnapshotsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
    <SendToAccountantDrawer />
    <LiasseScpDrawer />
    </>
  )
}
