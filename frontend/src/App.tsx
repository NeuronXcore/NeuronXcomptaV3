import { Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
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
import RapprochementPage from '@/components/rapprochement/RapprochementPage'
import CloturePage from '@/components/cloture/CloturePage'
import EcheancierPage from '@/pages/EcheancierPage'
import AlertesPage from '@/pages/AlertesPage'
import SettingsPage from '@/components/settings/SettingsPage'
import GedPage from '@/components/ged/GedPage'
import AmortissementsPage from '@/components/amortissements/AmortissementsPage'
import SimulationPage from '@/components/simulation/SimulationPage'

export default function App() {
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
        <Route path="/rapprochement" element={<RapprochementPage />} />
        <Route path="/alertes" element={<AlertesPage />} />
        <Route path="/agent-ai" element={<AgentIAPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/cloture" element={<CloturePage />} />
        <Route path="/echeancier" element={<EcheancierPage />} />
        <Route path="/ocr" element={<OcrPage />} />
        <Route path="/amortissements" element={<AmortissementsPage />} />
        <Route path="/simulation" element={<SimulationPage />} />
        <Route path="/ged" element={<GedPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
    </>
  )
}
