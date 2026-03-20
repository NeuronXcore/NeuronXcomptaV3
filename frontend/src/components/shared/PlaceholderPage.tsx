import PageHeader from './PageHeader'
import { Construction } from 'lucide-react'

export default function PlaceholderPage({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <div className="bg-surface rounded-xl border border-border p-12 text-center">
        <Construction size={48} className="text-text-muted mx-auto mb-4" />
        <p className="text-text-muted">Cette page sera implémentée dans une prochaine phase.</p>
      </div>
    </div>
  )
}
