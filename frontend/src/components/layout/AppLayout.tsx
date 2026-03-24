import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import PipelineWrapper from '@/components/pipeline/PipelineWrapper'

export default function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 p-8 overflow-auto">
        <Outlet />
      </main>
      <PipelineWrapper />
    </div>
  )
}
