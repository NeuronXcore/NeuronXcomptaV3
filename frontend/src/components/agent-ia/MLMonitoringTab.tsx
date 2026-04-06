import { useMemo } from 'react'
import { useMLMonitoringStats } from '@/hooks/useApi'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { cn } from '@/lib/utils'
import {
  Target, Shield, TrendingUp, TrendingDown, AlertTriangle, Brain,
  Loader2, Activity, BookOpen, Minus,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'


function PctBadge({ value, thresholds }: { value: number; thresholds: [number, number] }) {
  const pct = Math.round(value * 100)
  const color = pct >= thresholds[0] ? 'text-emerald-400' : pct >= thresholds[1] ? 'text-amber-400' : 'text-red-400'
  return <span className={cn('text-xl font-bold', color)}>{pct}%</span>
}


function PctBadgeInverse({ value, thresholds }: { value: number; thresholds: [number, number] }) {
  const pct = Math.round(value * 100)
  const color = pct <= thresholds[0] ? 'text-emerald-400' : pct <= thresholds[1] ? 'text-amber-400' : 'text-red-400'
  return <span className={cn('text-xl font-bold', color)}>{pct}%</span>
}


export default function MLMonitoringTab() {
  const { selectedYear } = useFiscalYearStore()
  const { data: stats, isLoading } = useMLMonitoringStats(selectedYear)

  const accuracyData = useMemo(() => {
    if (!stats?.training_history) return []
    return stats.training_history.map(t => ({
      date: t.timestamp.slice(0, 10),
      accuracy: t.accuracy != null ? Math.round(t.accuracy * 100) : null,
      examples: t.examples_count,
    }))
  }, [stats])

  const correctionData = useMemo(() => {
    if (!stats?.correction_rate_history) return []
    return stats.correction_rate_history.map(h => ({
      month: h.month,
      rate: Math.round(h.rate * 100),
    }))
  }, [stats])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted gap-2">
        <Loader2 size={18} className="animate-spin" />
        Chargement monitoring...
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="text-center py-20 text-text-muted">
        Aucune donnée de monitoring disponible.
      </div>
    )
  }

  const { confidence_distribution: dist } = stats

  return (
    <div className="space-y-6">
      {/* Section 1 — Performance */}
      <div>
        <h3 className="text-sm font-semibold text-text flex items-center gap-2 mb-3">
          <Target size={16} className="text-primary" />
          Performance
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-surface rounded-lg p-4 border border-border">
            <p className="text-xs text-text-muted mb-1">Taux de couverture</p>
            <PctBadge value={stats.coverage_rate} thresholds={[90, 70]} />
            <p className="text-[10px] text-text-muted mt-1">Opérations catégorisées</p>
          </div>
          <div className="bg-surface rounded-lg p-4 border border-border">
            <p className="text-xs text-text-muted mb-1">Confiance moyenne</p>
            <PctBadge value={stats.avg_confidence} thresholds={[80, 50]} />
            <p className="text-[10px] text-text-muted mt-1">Sur les prédictions</p>
          </div>
          <div className="bg-surface rounded-lg p-4 border border-border">
            <p className="text-xs text-text-muted mb-1">Distribution confiance</p>
            <div className="flex gap-3 mt-2">
              <span className="text-xs"><span className="text-emerald-400 font-bold">{dist.high}</span> haute</span>
              <span className="text-xs"><span className="text-amber-400 font-bold">{dist.medium}</span> moy.</span>
              <span className="text-xs"><span className="text-red-400 font-bold">{dist.low}</span> basse</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2 — Fiabilité */}
      <div>
        <h3 className="text-sm font-semibold text-text flex items-center gap-2 mb-3">
          <Shield size={16} className="text-primary" />
          Fiabilité
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-surface rounded-lg p-4 border border-border">
            <p className="text-xs text-text-muted mb-1">Taux de correction</p>
            <PctBadgeInverse value={stats.correction_rate} thresholds={[10, 25]} />
            <p className="text-[10px] text-text-muted mt-1">Prédictions corrigées</p>
          </div>
          <div className="bg-surface rounded-lg p-4 border border-border">
            <p className="text-xs text-text-muted mb-1">Taux d'hallucination</p>
            <PctBadgeInverse value={stats.hallucination_rate} thresholds={[5, 10]} />
          </div>
          <div className="bg-surface rounded-lg p-4 border border-border">
            <p className="text-xs text-text-muted mb-1">Libellés inconnus</p>
            <span className="text-xl font-bold text-text">{stats.unknown_libelles_count}</span>
            <p className="text-[10px] text-text-muted mt-1">sklearn &lt; 30% confiance</p>
          </div>
        </div>

        {/* Table top erreurs */}
        <div className="bg-surface rounded-lg border border-border p-4">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Top erreurs</p>
          {stats.top_errors.length === 0 ? (
            <p className="text-xs text-text-muted/60 italic">
              Aucune correction enregistrée — le tracking démarre au prochain save dans l'éditeur.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border/50">
                    <th className="text-left py-1.5 pr-3">Libellé</th>
                    <th className="text-left py-1.5 pr-3">Prédit</th>
                    <th className="text-left py-1.5 pr-3">Corrigé</th>
                    <th className="text-right py-1.5">Nb</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top_errors.map((e, i) => (
                    <tr key={i} className="border-b border-border/20">
                      <td className="py-1.5 pr-3 text-text truncate max-w-[200px]">{e.libelle}</td>
                      <td className="py-1.5 pr-3 text-red-400">{e.predicted}</td>
                      <td className="py-1.5 pr-3 text-emerald-400">{e.corrected}</td>
                      <td className="py-1.5 text-right text-text font-medium">{e.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Section 3 — Progression */}
      <div>
        <h3 className="text-sm font-semibold text-text flex items-center gap-2 mb-3">
          <TrendingUp size={16} className="text-primary" />
          Progression
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Accuracy chart */}
          <div className="bg-surface rounded-lg border border-border p-4">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Courbe accuracy</p>
            {accuracyData.length === 0 ? (
              <p className="text-xs text-text-muted/60 italic py-8 text-center">Aucun entraînement loggé</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={accuracyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#888' }} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="accuracy" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Accuracy %" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Correction rate chart */}
          <div className="bg-surface rounded-lg border border-border p-4">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Taux de correction / mois</p>
            {correctionData.length === 0 ? (
              <p className="text-xs text-text-muted/60 italic py-8 text-center">Aucune correction enregistrée</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={correctionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#888' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#888' }} domain={[0, 'auto']} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="rate" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Corrections %" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Knowledge base */}
        <div className="bg-surface rounded-lg border border-border p-4">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Base de connaissances</p>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <BookOpen size={14} className="text-primary" />
              <span className="text-sm font-bold text-text">{stats.knowledge_base.rules}</span>
              <span className="text-xs text-text-muted">règles</span>
            </div>
            <div className="flex items-center gap-2">
              <Brain size={14} className="text-amber-400" />
              <span className="text-sm font-bold text-text">{stats.knowledge_base.keywords}</span>
              <span className="text-xs text-text-muted">keywords</span>
            </div>
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-emerald-400" />
              <span className="text-sm font-bold text-text">{stats.knowledge_base.examples}</span>
              <span className="text-xs text-text-muted">exemples</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4 — Diagnostic */}
      <div>
        <h3 className="text-sm font-semibold text-text flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-primary" />
          Diagnostic
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Confusion pairs */}
          <div className="bg-surface rounded-lg border border-border p-4">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Paires confuses</p>
            {stats.confusion_pairs.length === 0 ? (
              <p className="text-xs text-text-muted/60 italic">Aucune confusion détectée</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border/50">
                    <th className="text-left py-1.5 pr-3">Catégorie prédite</th>
                    <th className="text-left py-1.5 pr-3">Catégorie réelle</th>
                    <th className="text-right py-1.5">Nb</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.confusion_pairs.map((p, i) => (
                    <tr key={i} className="border-b border-border/20">
                      <td className="py-1.5 pr-3 text-red-400">{p.from}</td>
                      <td className="py-1.5 pr-3 text-emerald-400">{p.to}</td>
                      <td className="py-1.5 text-right text-text font-medium">{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Orphan categories */}
          <div className="bg-surface rounded-lg border border-border p-4">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Catégories orphelines</p>
            {stats.orphan_categories.length === 0 ? (
              <p className="text-xs text-text-muted/60 italic">Toutes les catégories ont assez d'exemples</p>
            ) : (
              <div className="space-y-2">
                {stats.orphan_categories.map((c, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-xs text-text">{c.category}</span>
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                      {c.examples_count} exemples
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
