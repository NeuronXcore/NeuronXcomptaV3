import { useState } from 'react'
import { useComparePeriods, useOperationFiles } from '@/hooks/useApi'
import { formatCurrency, cn, MOIS_FR } from '@/lib/utils'
import {
  TrendingUp, TrendingDown, Minus, ArrowRight, Loader2,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import { useMemo } from 'react'

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

function DeltaBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-text-muted text-[10px]">—</span>
  const isPos = value > 0
  const isNeg = value < 0
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full',
      isPos ? 'bg-red-500/15 text-red-400' :
      isNeg ? 'bg-emerald-500/15 text-emerald-400' :
      'bg-zinc-500/15 text-text-muted',
    )}>
      {isPos ? <TrendingUp size={9} /> : isNeg ? <TrendingDown size={9} /> : <Minus size={9} />}
      {isPos ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}

export default function ComparatifSection() {
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

  // Chart data
  const chartData = useMemo(() => {
    if (!data) return []
    return data.categories
      .filter(c => c.a_debit > 0 || c.b_debit > 0)
      .slice(0, 12)
      .map(c => ({
        name: c.category.length > 12 ? c.category.slice(0, 12) + '…' : c.category,
        'Période A': c.a_debit,
        'Période B': c.b_debit,
      }))
  }, [data])

  const periodLabelA = [yearA, quarterA ? `T${quarterA}` : null, monthA ? MOIS_FR[monthA - 1]?.slice(0, 3) : null].filter(Boolean).join(' ') || 'Toutes'
  const periodLabelB = [yearB, quarterB ? `T${quarterB}` : null, monthB ? MOIS_FR[monthB - 1]?.slice(0, 3) : null].filter(Boolean).join(' ') || 'Toutes'

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
                  <DeltaBadge value={kpi.delta} />
                </div>
              </div>
            ))}
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-surface rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold mb-4">Dépenses par catégorie</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={70} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="Période A" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Période B" fill="#811971" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Category table */}
          <div className="bg-surface rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold mb-4">Détail par catégorie</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-text-muted text-xs">
                    <th className="text-left py-2 px-2">Catégorie</th>
                    <th className="text-right py-2 px-2 text-blue-400">{periodLabelA}</th>
                    <th className="text-right py-2 px-2 text-primary">{periodLabelB}</th>
                    <th className="text-right py-2 px-2">Δ%</th>
                    <th className="text-right py-2 px-2 text-blue-400">Ops A</th>
                    <th className="text-right py-2 px-2 text-primary">Ops B</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((c, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-surface-hover transition-colors">
                      <td className="py-2 px-2 text-xs text-text">{c.category}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs text-blue-400">
                        {c.a_debit > 0 ? formatCurrency(c.a_debit) : '—'}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-xs text-primary">
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
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
