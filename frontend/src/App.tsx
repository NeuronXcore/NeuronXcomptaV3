import { Routes, Route } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import HomePage from '@/components/dashboard/HomePage'
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
import SettingsPage from '@/components/settings/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/visualization" element={<ComptaAnalytiquePage />} />
        <Route path="/justificatifs" element={<JustificatifsPage />} />
        <Route path="/rapprochement" element={<RapprochementPage />} />
        <Route path="/agent-ai" element={<AgentIAPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/cloture" element={<CloturePage />} />
        <Route path="/ocr" element={<OcrPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
