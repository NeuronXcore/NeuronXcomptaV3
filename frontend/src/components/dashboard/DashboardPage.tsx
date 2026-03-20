import { useDashboard } from '@/hooks/useApi'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { formatCurrency, MOIS_FR } from '@/lib/utils'
import { TrendingDown, TrendingUp, Wallet, Hash } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts'

const COLORS = [
  '#811971', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#14b8a6',
]

export default function DashboardPage() {
  const { data, isLoading, error } = useDashboard()

  if (isLoading) return <LoadingSpinner text="Chargement du tableau de bord..." />
  if (error) return <p className="text-danger">Erreur: {error.message}</p>
  if (!data) return null

  const { total_debit, total_credit, solde, nb_operations, category_summary, recent_operations, monthly_evolution } = data

  return (
    <div>
      <PageHeader title="Tableau de bord" description="Vue d'ensemble de vos finances" />

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Total Débits"
          value={formatCurrency(total_debit)}
          icon={<TrendingDown size={20} />}
          trend="down"
        />
        <MetricCard
          title="Total Crédits"
          value={formatCurrency(total_credit)}
          icon={<TrendingUp size={20} />}
          trend="up"
        />
        <MetricCard
          title="Solde"
          value={formatCurrency(solde)}
          icon={<Wallet size={20} />}
          trend={solde >= 0 ? 'up' : 'down'}
        />
        <MetricCard
          title="Opérations"
          value={nb_operations.toString()}
          icon={<Hash size={20} />}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Evolution chart */}
        <div className="lg:col-span-2 bg-surface rounded-xl border border-border p-5">
          <h2 className="text-lg font-semibold mb-4">Évolution mensuelle</h2>
          {monthly_evolution.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={monthly_evolution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="Mois" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Area type="monotone" dataKey="Crédit" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} name="Crédits" />
                <Area type="monotone" dataKey="Débit" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} name="Débits" />
                <Area type="monotone" dataKey="Solde_Cumule" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} name="Solde cumulé" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-text-muted text-center py-12">Aucune donnée disponible</p>
          )}
        </div>

        {/* Category pie chart */}
        <div className="bg-surface rounded-xl border border-border p-5">
          <h2 className="text-lg font-semibold mb-4">Répartition par catégorie</h2>
          {category_summary.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={category_summary.filter(c => c['Débit'] > 0)}
                  dataKey="Débit"
                  nameKey="Catégorie"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  label={((props: any) => `${props.name ?? ''} ${(((props.percent as number) ?? 0) * 100).toFixed(0)}%`) as any}
                  labelLine={false}
                >
                  {category_summary.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  formatter={(value) => formatCurrency(Number(value))}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-text-muted text-center py-12">Aucune donnée</p>
          )}
        </div>
      </div>

      {/* Category bar chart */}
      {category_summary.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5 mb-8">
          <h2 className="text-lg font-semibold mb-4">Débits par catégorie</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={category_summary.filter(c => c['Débit'] > 0).sort((a, b) => b['Débit'] - a['Débit'])}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="Catégorie" tick={{ fill: '#94a3b8', fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(value) => formatCurrency(Number(value))}
              />
              <Bar dataKey="Débit" fill="#811971" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent operations */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h2 className="text-lg font-semibold mb-4">Opérations récentes</h2>
        {recent_operations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="text-left py-3 px-2">Date</th>
                  <th className="text-left py-3 px-2">Libellé</th>
                  <th className="text-right py-3 px-2">Débit</th>
                  <th className="text-right py-3 px-2">Crédit</th>
                  <th className="text-left py-3 px-2">Catégorie</th>
                </tr>
              </thead>
              <tbody>
                {recent_operations.slice(0, 15).map((op, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-surface-hover transition-colors">
                    <td className="py-2.5 px-2 text-text-muted">{op.Date?.slice(0, 10) ?? ''}</td>
                    <td className="py-2.5 px-2 max-w-[300px] truncate">{op['Libellé']}</td>
                    <td className="py-2.5 px-2 text-right text-danger">
                      {op['Débit'] > 0 ? formatCurrency(op['Débit']) : ''}
                    </td>
                    <td className="py-2.5 px-2 text-right text-success">
                      {op['Crédit'] > 0 ? formatCurrency(op['Crédit']) : ''}
                    </td>
                    <td className="py-2.5 px-2">
                      <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                        {op['Catégorie'] || 'Non catégorisé'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-text-muted text-center py-8">
            Aucune opération. Importez un relevé PDF pour commencer.
          </p>
        )}
      </div>
    </div>
  )
}
