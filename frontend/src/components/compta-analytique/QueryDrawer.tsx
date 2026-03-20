import { useState, useMemo, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useCategories } from '@/hooks/useApi'
import { formatCurrency, cn } from '@/lib/utils'
import {
  X, Search, Play, Save, Trash2, Loader2, RotateCcw,
  CheckCircle, XCircle, ChevronDown, ChevronUp, FolderOpen, Star,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import type { QueryFilters, QueryPreset, QueryResult } from '@/types'

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: '12px',
  color: '#e2e8f0',
}

const DEFAULT_FILTERS: QueryFilters = {
  categories: [],
  type: 'both',
  grouping: 'category',
}

interface QueryDrawerProps {
  open: boolean
  onClose: () => void
}

export default function QueryDrawer({ open, onClose }: QueryDrawerProps) {
  const queryClient = useQueryClient()
  const { data: catData } = useCategories()

  // State
  const [filters, setFilters] = useState<QueryFilters>({ ...DEFAULT_FILTERS })
  const [result, setResult] = useState<QueryResult | null>(null)
  const [saveName, setSaveName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(true)
  const [catSearch, setCatSearch] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState('')

  // Queries
  const { data: presetsData, refetch: refetchPresets } = useQuery<{ saved: QueryPreset[]; predefined: QueryPreset[] }>({
    queryKey: ['analytics-queries'],
    queryFn: () => api.get('/analytics/queries'),
  })

  // Mutations
  const executeMutation = useMutation({
    mutationFn: (f: QueryFilters) => api.post<QueryResult>('/analytics/query', f),
    onSuccess: (data) => setResult(data),
  })

  const saveMutation = useMutation({
    mutationFn: (data: { name: string; filters: QueryFilters }) =>
      api.post('/analytics/queries', { name: data.name, filters: data.filters }),
    onSuccess: () => {
      refetchPresets()
      setShowSaveInput(false)
      setSaveName('')
      setSuccessMsg('Requête sauvegardée')
      setTimeout(() => setSuccessMsg(''), 3000)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/analytics/queries/${id}`),
    onSuccess: () => {
      refetchPresets()
      setDeleteConfirm(null)
    },
  })

  // Available categories
  const allCategories = useMemo(() => {
    if (!catData?.categories) return []
    return catData.categories.map(c => c.name).sort()
  }, [catData])

  const filteredCategories = useMemo(() => {
    if (!catSearch.trim()) return allCategories
    const q = catSearch.toLowerCase()
    return allCategories.filter(c => c.toLowerCase().includes(q))
  }, [allCategories, catSearch])

  const toggleCategory = (cat: string) => {
    setFilters(prev => ({
      ...prev,
      categories: prev.categories.includes(cat)
        ? prev.categories.filter(c => c !== cat)
        : [...prev.categories, cat],
    }))
  }

  const loadPreset = (preset: QueryPreset) => {
    setFilters({ ...DEFAULT_FILTERS, ...preset.filters })
    setResult(null)
  }

  const handleExecute = () => {
    executeMutation.mutate(filters)
  }

  const handleSave = () => {
    if (!saveName.trim()) return
    saveMutation.mutate({ name: saveName.trim(), filters })
  }

  const handleReset = () => {
    setFilters({ ...DEFAULT_FILTERS })
    setResult(null)
  }

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const saved = presetsData?.saved || []
  const predefined = presetsData?.predefined || []

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[800px] max-w-[95vw] bg-background border-l border-border z-50',
          'transition-transform duration-300 ease-out overflow-y-auto',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text flex items-center gap-2">
              <Search size={20} className="text-primary" />
              Requêtes Analytiques
            </h2>
            <button onClick={onClose} className="text-text-muted hover:text-text">
              <X size={20} />
            </button>
          </div>

          {successMsg && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2">
              <CheckCircle size={14} />
              {successMsg}
            </div>
          )}

          {/* Predefined quick select */}
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Requêtes prédéfinies</p>
            <div className="flex flex-wrap gap-2">
              {predefined.map(p => (
                <button
                  key={p.id}
                  onClick={() => { loadPreset(p); executeMutation.mutate({ ...DEFAULT_FILTERS, ...p.filters }) }}
                  className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text hover:border-primary hover:text-primary transition-colors flex items-center gap-1.5"
                >
                  <Star size={10} className="text-amber-400" />
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Builder */}
          <div className="bg-surface rounded-xl border border-border p-4 space-y-4">
            <p className="text-sm font-semibold text-text">Builder de requête</p>

            {/* Categories multi-select */}
            <div>
              <label className="text-xs text-text-muted mb-1 block">
                Catégories ({filters.categories.length === 0 ? 'Toutes' : `${filters.categories.length} sélectionnée(s)`})
              </label>
              <input
                type="text"
                value={catSearch}
                onChange={e => setCatSearch(e.target.value)}
                placeholder="Filtrer..."
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary mb-2"
              />
              <div className="max-h-[120px] overflow-y-auto space-y-1 pr-1 scrollbar-thin">
                {filteredCategories.map(cat => (
                  <label key={cat} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-background rounded px-1 py-0.5">
                    <input
                      type="checkbox"
                      checked={filters.categories.includes(cat)}
                      onChange={() => toggleCategory(cat)}
                      className="w-3.5 h-3.5 accent-primary"
                    />
                    <span className="text-text">{cat}</span>
                  </label>
                ))}
              </div>
              {filters.categories.length > 0 && (
                <button
                  onClick={() => setFilters(prev => ({ ...prev, categories: [] }))}
                  className="text-[10px] text-primary mt-1 hover:underline"
                >
                  Tout décocher
                </button>
              )}
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-muted mb-1 block">Date début</label>
                <input
                  type="date"
                  value={filters.date_from || ''}
                  onChange={e => setFilters(prev => ({ ...prev, date_from: e.target.value || undefined }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">Date fin</label>
                <input
                  type="date"
                  value={filters.date_to || ''}
                  onChange={e => setFilters(prev => ({ ...prev, date_to: e.target.value || undefined }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Amount range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-muted mb-1 block">Montant min</label>
                <input
                  type="number"
                  value={filters.min_amount ?? ''}
                  onChange={e => setFilters(prev => ({ ...prev, min_amount: e.target.value ? Number(e.target.value) : undefined }))}
                  placeholder="0"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">Montant max</label>
                <input
                  type="number"
                  value={filters.max_amount ?? ''}
                  onChange={e => setFilters(prev => ({ ...prev, max_amount: e.target.value ? Number(e.target.value) : undefined }))}
                  placeholder="Illimité"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Type + Grouping */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-muted mb-1 block">Type</label>
                <select
                  value={filters.type}
                  onChange={e => setFilters(prev => ({ ...prev, type: e.target.value as QueryFilters['type'] }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                >
                  <option value="both">Débits + Crédits</option>
                  <option value="debit">Débits uniquement</option>
                  <option value="credit">Crédits uniquement</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">Grouper par</label>
                <select
                  value={filters.grouping}
                  onChange={e => setFilters(prev => ({ ...prev, grouping: e.target.value as QueryFilters['grouping'] }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                >
                  <option value="category">Par catégorie</option>
                  <option value="month">Par mois</option>
                  <option value="quarter">Par trimestre</option>
                  <option value="month_category">Mois + Catégorie</option>
                </select>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleExecute}
                disabled={executeMutation.isPending}
                className="flex-1 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/80 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {executeMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Exécuter
              </button>
              <button
                onClick={() => setShowSaveInput(!showSaveInput)}
                className="bg-surface border border-border text-text px-3 py-2 rounded-lg text-sm hover:bg-surface-hover flex items-center gap-1.5"
              >
                <Save size={14} />
              </button>
              <button
                onClick={handleReset}
                className="bg-surface border border-border text-text-muted px-3 py-2 rounded-lg text-sm hover:bg-surface-hover hover:text-text"
              >
                <RotateCcw size={14} />
              </button>
            </div>

            {/* Save input */}
            {showSaveInput && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  placeholder="Nom de la requête..."
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={!saveName.trim() || saveMutation.isPending}
                  className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saveMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Sauvegarder'}
                </button>
              </div>
            )}

            {executeMutation.isError && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <XCircle size={12} /> {executeMutation.error.message}
              </p>
            )}
          </div>

          {/* Results */}
          {result && (
            <div className="bg-surface rounded-xl border border-border p-4 space-y-4">
              <p className="text-sm font-semibold text-text">Résultats</p>

              {/* Mini KPIs */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Débits', value: result.total_debit, color: 'text-danger' },
                  { label: 'Crédits', value: result.total_credit, color: 'text-success' },
                  { label: 'Solde', value: result.total_net, color: result.total_net >= 0 ? 'text-success' : 'text-danger' },
                  { label: 'Opérations', value: result.total_ops, color: 'text-text' },
                ].map(kpi => (
                  <div key={kpi.label} className="bg-background rounded-lg p-2 text-center">
                    <p className="text-[10px] text-text-muted">{kpi.label}</p>
                    <p className={cn('text-sm font-bold', kpi.color)}>
                      {typeof kpi.value === 'number' && kpi.label !== 'Opérations'
                        ? formatCurrency(kpi.value)
                        : kpi.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Chart */}
              {result.rows.length > 0 && (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={result.rows.slice(0, 15)} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#94a3b8', fontSize: 9 }}
                      tickLine={false}
                      angle={-20}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis
                      tick={{ fill: '#94a3b8', fontSize: 9 }}
                      tickLine={false}
                      tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                    <Legend wrapperStyle={{ fontSize: '10px' }} iconSize={8} />
                    <Bar dataKey="debit" name="Débits" fill="#ef4444" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="credit" name="Crédits" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}

              {/* Table */}
              <div className="overflow-x-auto max-h-[250px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border text-text-muted">
                      <th className="text-left py-2 px-2">{filters.grouping.includes('month') || filters.grouping === 'quarter' ? 'Période' : 'Catégorie'}</th>
                      {result.rows[0]?.category !== undefined && <th className="text-left py-2 px-2">Catégorie</th>}
                      <th className="text-right py-2 px-2">Débit</th>
                      <th className="text-right py-2 px-2">Crédit</th>
                      <th className="text-right py-2 px-2">Net</th>
                      <th className="text-right py-2 px-2">Ops</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-b border-border/30 hover:bg-background">
                        <td className="py-1.5 px-2 text-text">{row.label}</td>
                        {row.category !== undefined && <td className="py-1.5 px-2 text-text-muted">{row.category}</td>}
                        <td className="py-1.5 px-2 text-right text-danger font-mono">{row.debit > 0 ? formatCurrency(row.debit) : '—'}</td>
                        <td className="py-1.5 px-2 text-right text-success font-mono">{row.credit > 0 ? formatCurrency(row.credit) : '—'}</td>
                        <td className={cn('py-1.5 px-2 text-right font-mono', row.net >= 0 ? 'text-success' : 'text-danger')}>{formatCurrency(row.net)}</td>
                        <td className="py-1.5 px-2 text-right text-text-muted">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.rows.length === 0 && (
                <p className="text-xs text-text-muted text-center py-4">Aucun résultat pour ces filtres</p>
              )}
            </div>
          )}

          {/* Gallery */}
          <div className="bg-surface rounded-xl border border-border">
            <button
              onClick={() => setGalleryOpen(!galleryOpen)}
              className="w-full flex items-center justify-between p-4 text-sm font-semibold text-text hover:bg-surface-hover rounded-xl transition-colors"
            >
              <span className="flex items-center gap-2">
                <FolderOpen size={16} className="text-primary" />
                Requêtes sauvegardées ({saved.length})
              </span>
              {galleryOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {galleryOpen && (
              <div className="px-4 pb-4 space-y-2">
                {saved.length === 0 ? (
                  <p className="text-xs text-text-muted/60 text-center py-2">Aucune requête sauvegardée</p>
                ) : (
                  saved.map(preset => (
                    <div
                      key={preset.id}
                      className="flex items-center gap-2 py-2 px-3 rounded-lg bg-background border border-border/50 hover:border-border"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text font-medium truncate">{preset.name}</p>
                        <p className="text-[10px] text-text-muted/50">
                          {preset.created_at ? new Date(preset.created_at).toLocaleDateString('fr-FR') : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => { loadPreset(preset); executeMutation.mutate({ ...DEFAULT_FILTERS, ...preset.filters }) }}
                        className="text-primary text-[10px] hover:underline shrink-0"
                      >
                        Charger
                      </button>
                      {deleteConfirm === preset.id ? (
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => deleteMutation.mutate(preset.id)}
                            className="text-red-400 text-[10px] font-medium"
                          >
                            Oui
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-text-muted text-[10px]"
                          >
                            Non
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(preset.id)}
                          className="text-text-muted/40 hover:text-red-400 shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
