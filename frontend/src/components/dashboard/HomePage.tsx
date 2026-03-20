import { Link } from 'react-router-dom'
import { Upload, BarChart3, Bot, FileText } from 'lucide-react'

export default function HomePage() {
  return (
    <div className="max-w-4xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-12 pt-8">
        <h1 className="text-4xl font-bold mb-3">
          <span className="text-primary">NeuronX</span>compta
        </h1>
        <p className="text-xl text-text-muted">
          Assistant Comptable propulsé par l'Intelligence Artificielle
        </p>
        <p className="text-text-muted mt-2">Version 3.0.0 &mdash; React + FastAPI</p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
        <QuickAction
          to="/import"
          icon={<Upload size={24} />}
          title="Importer un relevé"
          description="Glissez-déposez un PDF bancaire pour extraire vos opérations"
        />
        <QuickAction
          to="/dashboard"
          icon={<BarChart3 size={24} />}
          title="Tableau de bord"
          description="Visualisez l'évolution de vos finances en un coup d'oeil"
        />
        <QuickAction
          to="/agent-ai"
          icon={<Bot size={24} />}
          title="Agent IA"
          description="Entraînez le modèle pour catégoriser automatiquement vos dépenses"
        />
        <QuickAction
          to="/reports"
          icon={<FileText size={24} />}
          title="Générer des rapports"
          description="Exportez vos données en PDF, CSV ou Excel"
        />
      </div>

      {/* Features */}
      <div className="bg-surface rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Nouveautés v3.0</h2>
        <ul className="space-y-2 text-sm text-text-muted">
          <li>&#x2022; Interface React moderne et responsive</li>
          <li>&#x2022; API REST FastAPI haute performance</li>
          <li>&#x2022; Graphiques interactifs avec Recharts</li>
          <li>&#x2022; Catégorisation IA (rules + scikit-learn)</li>
          <li>&#x2022; Gestion des justificatifs avec preview PDF</li>
          <li>&#x2022; Export comptable multi-format</li>
        </ul>
      </div>
    </div>
  )
}

function QuickAction({ to, icon, title, description }: {
  to: string; icon: React.ReactNode; title: string; description: string
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-4 bg-surface rounded-xl border border-border p-5 hover:border-primary/50 hover:bg-surface-hover transition-all group"
    >
      <div className="text-primary group-hover:scale-110 transition-transform mt-0.5">{icon}</div>
      <div>
        <h3 className="font-semibold text-text group-hover:text-primary transition-colors">{title}</h3>
        <p className="text-sm text-text-muted mt-1">{description}</p>
      </div>
    </Link>
  )
}
