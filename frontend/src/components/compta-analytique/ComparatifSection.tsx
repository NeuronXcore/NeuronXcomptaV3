import { useState, useMemo } from 'react'
import { useComparePeriods, useOperationFiles } from '@/hooks/useApi'
import { formatCurrency, cn, MOIS_FR } from '@/lib/utils'
import {
  TrendingUp, TrendingDown, Minus, ArrowRight, Loader2, ChevronRight,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import NatureFilter, { type NatureFilter as NatureFilterValue } from './NatureFilter'

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 8,
  fontSize: '12px',
  color: '#e2e8f0',
}

function PeriodSelector({
  label,
  year, setYear,
  quarter, setQuarter,
  month, setMonth,
  years,
  color,
}: {
  label: string
  year: number | null; setYear: (v: number | null) => void
  quarter: number | null; setQuarter: (v: number | null) => void
  month: number | null; setMonth: (v: number | null) => void
  years: number[]
  color: string
}) {
  return (
    <div className={cn('flex-1 bg-surface rounded-xl border-2 p-4', color)}>
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">{label}</p>
      <div className="flex flex-wrap gap-2">
        <select
          value={year ?? ''}
          onChange={e => {
            const v = e.target.value ? Number(e.target.value) : null
            setYear(v)
            if (!v) { setQuarter(null); setMonth(null) }
          }}
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-text"
        >
          <option value="">Toutes</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          value={quarter ?? ''}
          onChange={e => { const v = e.target.value ? Number(e.target.value) : null; setQuarter(v); if (v) setMonth(null) }}
          disabled={!year}
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-text disabled:opacity-40"
        >
          <option value="">Trimestre</option>
          <option value="1">T1</option><option value="2">T2</option>
          <option value="3">T3</option><option value="4">T4</option>
        </select>
        <select
          value={month ?? ''}
          onChange={e => { const v = e.target.value ? Number(e.target.value) : null; setMonth(v); if (v) setQuarter(null) }}
          disabled={!year || quarter !== null}
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-text disabled:opacity-40"
        >
          <option value="">Mois</option>
          {MOIS_FR.map((m, i) => <option key={i} value={i + 1}>{m.slice(0, 3)}</option>)}
        </select>
      </div>
    </div>
  )
}

function DeltaBadge({ value, invertColors }: { value: number | null; invertColors?: boolean }) {
  if (value == null) return <span className="text-text-muted text-[10px]">—</span>
  const isPos = value > 0
  const isNeg = value < 0
  const posColor = invertColors ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
  const negColor = invertColors ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full',
      isPos ? posColor : isNeg ? negColor : 'bg-zinc-500/15 text-text-muted',
    )}>
      {isPos ? <TrendingUp size={9} /> : isNeg ? <TrendingDown size={9} /> : <Minus size={9} />}
      {isPos ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}

function deltaPct(a: number, b: number): number | null {
  if (a === 0) return null
  return (b - a) / Math.abs(a) * 100
}

interface Props {
  onCategoryClick: (cat: string) => void
}

export default function ComparatifSection({ onCategoryClick }: Props) {
  const { data: opFiles } = useOperationFiles()
  const years = useMemo(() => {
    if (!opFiles) return []
    return [...new Set(opFiles.map(f => f.year).filter(Boolean))].sort((a, b) => (b ?? 0) - (a ?? 0)) as number[]
  }, [opFiles])

  // Period A
  const [yearA, setYearA] = useState<number | null>(null)
  const [quarterA, setQuarterA] = useState<number | null>(null)
  const [monthA, setMonthA] = useState<number | null>(null)

  // Period B
  const [yearB, setYearB] = useState<number | null>(null)
  const [quarterB, setQuarterB] = useState<number | null>(null)
  const [monthB, setMonthB] = useState<number | null>(null)

  const canCompare = yearA !== null || yearB !== null
  const { data, isLoading } = useComparePeriods(
    yearA, quarterA, monthA,
    yearB, quarterB, monthB,
    canCompare,
  )

  // Nature filter (Pro / Perso / Tout) — applique le filtre sur les catégories affichées
  const [natureFilter, setNatureFilter] = useState<NatureFilterValue>('pro')

  // Split categories into recettes / dépenses (filtré par nature)
  const { recettes, depenses } = useMemo(() => {
    if (!data) return { recettes: [], depenses: [] }
    const rec: typeof data.categories = []
    const dep: typeof data.categories = []
    const filtered = natureFilter === 'all'
      ? data.categories
      : data.categories.filter(c => (c as { nature?: string }).nature === natureFilter)
    for (const c of filtered) {
      if ((c.a_credit + c.b_credit) > (c.a_debit + c.b_debit)) {
        rec.push(c)
      } else {
        dep.push(c)
      }
    }
    // Sort recettes by total credit desc
    rec.sort((a, b) => (b.a_credit + b.b_credit) - (a.a_credit + a.b_credit))
    // Sort depenses by total debit desc
    dep.sort((a, b) => (b.a_debit + b.b_debit) - (a.a_debit + a.b_debit))
    return { recettes: rec, depenses: dep }
  }, [data, natureFilter])

  const periodLabelA = [yearA, quarterA ? `T${quarterA}` : null, monthA ? MOIS_FR[monthA - 1]?.slice(0, 3) : null].filter(Boolean).join(' ') || 'Toutes'
  const periodLabelB = [yearB, quarterB ? `T${quarterB}` : null, monthB ? MOIS_FR[monthB - 1]?.slice(0, 3) : null].filter(Boolean).join(' ') || 'Toutes'
  // Chart data - recettes (stable keys for Recharts, display via `name` prop on Bar)
  const chartRecettes = useMemo(() => {
    return recettes
      .filter(c => c.a_credit > 0 || c.b_credit > 0)
      .slice(0, 8)
      .map(c => ({
        name: c.category.length > 14 ? c.category.slice(0, 14) + '…' : c.category,
        periodA: c.a_credit,
        periodB: c.b_credit,
      }))
  }, [recettes])

  // Chart data - dépenses
  const chartDepenses = useMemo(() => {
    return depenses
      .filter(c => c.a_debit > 0 || c.b_debit > 0)
      .slice(0, 10)
      .map(c => ({
        name: c.category.length > 14 ? c.category.slice(0, 14) + '…' : c.category,
        periodA: c.a_debit,
        periodB: c.b_debit,
      }))
  }, [depenses])

  return (
    <div className="space-y-6">
      {/* Period selectors */}
      <div className="flex gap-4 items-stretch">
        <PeriodSelector
          label="Période A"
          year={yearA} setYear={setYearA}
          quarter={quarterA} setQuarter={setQuarterA}
          month={monthA} setMonth={setMonthA}
          years={years}
          color="border-blue-500/30"
        />
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center">
            <ArrowRight size={14} className="text-text-muted" />
          </div>
        </div>
        <PeriodSelector
          label="Période B"
          year={yearB} setYear={setYearB}
          quarter={quarterB} setQuarter={setQuarterB}
          month={monthB} setMonth={setMonthB}
          years={years}
          color="border-primary/30"
        />
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-primary" />
        </div>
      ) : !data ? (
        <div className="text-center text-text-muted py-12 text-sm">
          Sélectionnez au moins une période pour comparer
        </div>
      ) : (
        <>
          {/* Nature filter — filtre les catégories affichées (tableau + graphes) */}
          <NatureFilter
            value={natureFilter}
            onChange={setNatureFilter}
            hint="les tableaux et les graphes filtrent en conséquence"
          />

          {/* KPI comparison */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {([
              { label: 'Dépenses', aVal: data.period_a.total_debit, bVal: data.period_b.total_debit, delta: data.delta.total_debit, color: 'text-red-400' },
              { label: 'Revenus', aVal: data.period_a.total_credit, bVal: data.period_b.total_credit, delta: data.delta.total_credit, color: 'text-emerald-400' },
              { label: 'Solde', aVal: data.period_a.solde, bVal: data.period_b.solde, delta: data.delta.solde, color: 'text-text' },
              { label: 'Opérations', aVal: data.period_a.nb_operations, bVal: data.period_b.nb_operations, delta: data.delta.nb_operations, color: 'text-text' },
            ]).map(kpi => (
              <div key={kpi.label} className="bg-surface rounded-xl border border-border p-4">
                <p className="text-[10px] text-text-muted uppercase tracking-wider mb-2">{kpi.label}</p>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[10px] text-blue-400 mb-0.5">A: {kpi.label === 'Opérations' ? kpi.aVal : formatCurrency(kpi.aVal)}</p>
                    <p className={cn('text-sm font-semibold', kpi.color)}>B: {kpi.label === 'Opérations' ? kpi.bVal : formatCurrency(kpi.bVal)}</p>
                  </div>
                  <DeltaBadge value={kpi.delta} invertColors={kpi.label === 'Revenus' || kpi.label === 'Solde'} />
                </div>
              </div>
            ))}
          </div>

          {/* Charts side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recettes chart */}
            {chartRecettes.length > 0 && (
              <div className="bg-surface rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Recettes par catégorie
                </h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartRecettes} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={70} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="periodA" name={periodLabelA} fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="periodB" name={periodLabelB} fill="#22c55e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Dépenses chart */}
            {chartDepenses.length > 0 && (
              <div className="bg-surface rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  Dépenses par catégorie
                </h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartDepenses} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={70} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="periodA" name={periodLabelA} fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="periodB" name={periodLabelB} fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Recettes table */}
          {recettes.length > 0 && (
            <div className="bg-surface rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Recettes
                <span className="text-[10px] text-text-muted font-normal ml-auto">Cliquez pour le détail</span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-text-muted text-xs">
                      <th className="text-left py-2 px-2">Catégorie</th>
                      <th className="text-right py-2 px-2 text-blue-400">Crédit {periodLabelA}</th>
                      <th className="text-right py-2 px-2 text-emerald-400">Crédit {periodLabelB}</th>
                      <th className="text-right py-2 px-2">Δ%</th>
                      <th className="text-right py-2 px-2 text-blue-400">Ops A</th>
                      <th className="text-right py-2 px-2 text-emerald-400">Ops B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recettes.map((c, i) => (
                      <tr
                        key={i}
                        onClick={() => onCategoryClick(c.category)}
                        className="border-b border-border/30 hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <td className="py-2 px-2 text-xs text-text">
                          <span className="inline-flex items-center gap-2">
                            {c.category}
                            <ChevronRight size={10} className="text-text-muted" />
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-xs text-blue-400">
                          {c.a_credit > 0 ? formatCurrency(c.a_credit) : '—'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-xs text-emerald-400">
                          {c.b_credit > 0 ? formatCurrency(c.b_credit) : '—'}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <DeltaBadge value={deltaPct(c.a_credit, c.b_credit)} invertColors />
                        </td>
                        <td className="py-2 px-2 text-right text-xs text-text-muted">{c.a_ops}</td>
                        <td className="py-2 px-2 text-right text-xs text-text-muted">{c.b_ops}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold text-xs">
                      <td className="py-2 px-2">Total</td>
                      <td className="py-2 px-2 text-right font-mono text-blue-400">
                        {formatCurrency(recettes.reduce((s, r) => s + r.a_credit, 0))}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-emerald-400">
                        {formatCurrency(recettes.reduce((s, r) => s + r.b_credit, 0))}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <DeltaBadge
                          value={deltaPct(
                            recettes.reduce((s, r) => s + r.a_credit, 0),
                            recettes.reduce((s, r) => s + r.b_credit, 0),
                          )}
                          invertColors
                        />
                      </td>
                      <td className="py-2 px-2 text-right text-text-muted">
                        {recettes.reduce((s, r) => s + r.a_ops, 0)}
                      </td>
                      <td className="py-2 px-2 text-right text-text-muted">
                        {recettes.reduce((s, r) => s + r.b_ops, 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Dépenses table */}
          {depenses.length > 0 && (
            <div className="bg-surface rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                Dépenses
                <span className="text-[10px] text-text-muted font-normal ml-auto">Cliquez pour le détail</span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-text-muted text-xs">
                      <th className="text-left py-2 px-2">Catégorie</th>
                      <th className="text-right py-2 px-2 text-blue-400">Débit {periodLabelA}</th>
                      <th className="text-right py-2 px-2 text-red-400">Débit {periodLabelB}</th>
                      <th className="text-right py-2 px-2">Δ%</th>
                      <th className="text-right py-2 px-2 text-blue-400">Ops A</th>
                      <th className="text-right py-2 px-2 text-red-400">Ops B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depenses.map((c, i) => (
                      <tr
                        key={i}
                        onClick={() => onCategoryClick(c.category)}
                        className="border-b border-border/30 hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <td className="py-2 px-2 text-xs text-text">
                          <span className="inline-flex items-center gap-2">
                            {c.category}
                            <ChevronRight size={10} className="text-text-muted" />
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-xs text-blue-400">
                          {c.a_debit > 0 ? formatCurrency(c.a_debit) : '—'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-xs text-red-400">
                          {c.b_debit > 0 ? formatCurrency(c.b_debit) : '—'}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <DeltaBadge value={c.delta_pct} />
                        </td>
                        <td className="py-2 px-2 text-right text-xs text-text-muted">{c.a_ops}</td>
                        <td className="py-2 px-2 text-right text-xs text-text-muted">{c.b_ops}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold text-xs">
                      <td className="py-2 px-2">Total</td>
                      <td className="py-2 px-2 text-right font-mono text-blue-400">
                        {formatCurrency(depenses.reduce((s, r) => s + r.a_debit, 0))}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-red-400">
                        {formatCurrency(depenses.reduce((s, r) => s + r.b_debit, 0))}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <DeltaBadge
                          value={deltaPct(
                            depenses.reduce((s, r) => s + r.a_debit, 0),
                            depenses.reduce((s, r) => s + r.b_debit, 0),
                          )}
                        />
                      </td>
                      <td className="py-2 px-2 text-right text-text-muted">
                        {depenses.reduce((s, r) => s + r.a_ops, 0)}
                      </td>
                      <td className="py-2 px-2 text-right text-text-muted">
                        {depenses.reduce((s, r) => s + r.b_ops, 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
