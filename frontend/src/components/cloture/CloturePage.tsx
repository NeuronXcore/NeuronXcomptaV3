import { useState, useMemo } from 'react'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, CheckCircle2, AlertCircle,
  Clock, Download, FileText,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { useAnnualStatus, useClotureYears } from '@/hooks/useCloture'
import { cn } from '@/lib/utils'
import type { MonthStatus } from '@/types'

const STATUT_CONFIG = {
  complet: { label: 'Complet', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  partiel: { label: 'En cours', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  manquant: { label: 'Manquant', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="w-full bg-background rounded-full h-1.5 overflow-hidden">
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  )
}

function MonthCard({ month, onClick, year, onReconstituer }: { month: MonthStatus; onClick: () => void; year: number; onReconstituer?: () => void }) {
  const config = STATUT_CONFIG[month.statut]

  return (
    <div
      onClick={month.has_releve ? onClick : undefined}
      className={cn(
        'bg-surface rounded-xl border border-border p-4 transition-all',
        month.has_releve ? 'cursor-pointer hover:ring-1 hover:ring-primary/50 hover:shadow-lg' : 'opacity-50',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">{month.label}</h3>
        <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border', config.bg, config.text, config.border)}>
          {config.label}
        </span>
      </div>

      {month.statut === 'manquant' ? (
        <div className="flex flex-col items-center py-4 text-text-muted">
          <AlertCircle size={24} className="mb-2 opacity-40" />
          <span className="text-xs">Aucun relev&eacute;</span>
        </div>
      ) : (
        <>
          {/* Completeness icon */}
          {month.statut === 'complet' && (
            <div className="flex justify-center mb-3">
              <CheckCircle2 size={28} className="text-emerald-400" />
            </div>
          )}

          {/* Lettrage */}
          <div className="mb-2">
            <div className="flex justify-between text-[11px] text-text-muted mb-1">
              <span>Lettrage</span>
              <span className="font-mono">{month.nb_lettrees}/{month.nb_operations}</span>
            </div>
            <ProgressBar value={month.nb_lettrees} max={month.nb_operations} color="bg-primary" />
          </div>

          {/* Justificatifs */}
          <div className="mb-2">
            <div className="flex justify-between text-[11px] text-text-muted mb-1">
              <span>Justificatifs</span>
              <span className="font-mono">{month.nb_justificatifs_ok}/{month.nb_justificatifs_total}</span>
            </div>
            <ProgressBar value={month.nb_justificatifs_ok} max={month.nb_justificatifs_total} color="bg-emerald-500" />
          </div>

          {/* Detail */}
          <div className="text-[10px] text-text-muted mt-2 font-mono">
            {month.nb_operations} ops &middot; {Math.round(month.taux_lettrage * 100)}% L &middot; {Math.round(month.taux_justificatifs * 100)}% J
          </div>

          {/* Reconstituer les manquants */}
          {month.statut === 'partiel' && month.nb_justificatifs_ok < month.nb_justificatifs_total && onReconstituer && (
            <button
              onClick={(e) => { e.stopPropagation(); onReconstituer() }}
              className="mt-2 w-full text-[10px] text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/15 rounded px-2 py-1 transition-colors"
            >
              Reconstituer les manquants
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default function CloturePage() {
  const navigate = useNavigate()
  const { data: years, isLoading: yearsLoading } = useClotureYears()
  const { selectedYear, setYear } = useFiscalYearStore()
  const { data: months, isLoading: monthsLoading } = useAnnualStatus(selectedYear)
  const effectiveYear = selectedYear

  // Summary stats
  const summary = useMemo(() => {
    if (!months) return { complets: 0, partiels: 0, manquants: 0 }
    return {
      complets: months.filter(m => m.statut === 'complet').length,
      partiels: months.filter(m => m.statut === 'partiel').length,
      manquants: months.filter(m => m.statut === 'manquant').length,
    }
  }, [months])

  // Export CSV bilan
  const handleExportCSV = () => {
    if (!months) return
    const headers = ['Mois', 'Statut', 'Operations', 'Lettrees', 'Taux Lettrage', 'Justificatifs OK', 'Justificatifs Total', 'Taux Justificatifs']
    const rows = months.map(m =>
      [m.label, m.statut, m.nb_operations, m.nb_lettrees, `${Math.round(m.taux_lettrage * 100)}%`, m.nb_justificatifs_ok, m.nb_justificatifs_total, `${Math.round(m.taux_justificatifs * 100)}%`].join(',')
    )
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cloture_${effectiveYear}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (yearsLoading) return <LoadingSpinner text="Chargement..." />

  const minYear = years && years.length > 0 ? Math.min(...years) : effectiveYear
  const maxYear = years && years.length > 0 ? Math.max(...years) : effectiveYear

  return (
    <div>
      <PageHeader
        title="Cl&ocirc;ture Comptable"
        description="Vue annuelle de la compl&eacute;tude comptable par mois"
        actions={
          <button
            onClick={handleExportCSV}
            disabled={!months || months.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover disabled:opacity-30 transition-colors"
          >
            <Download size={15} />
            Exporter bilan
          </button>
        }
      />

      {/* Year selector */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <button
          onClick={() => setYear(selectedYear - 1)}
          disabled={effectiveYear <= minYear - 1}
          className="p-2 rounded-lg bg-surface border border-border hover:bg-surface-hover disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-2xl font-bold text-text min-w-[100px] text-center">{effectiveYear}</span>
        <button
          onClick={() => setYear(selectedYear + 1)}
          disabled={effectiveYear >= maxYear + 1}
          className="p-2 rounded-lg bg-surface border border-border hover:bg-surface-hover disabled:opacity-30 transition-colors"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Month grid */}
      {monthsLoading ? (
        <LoadingSpinner text="Chargement du statut annuel..." />
      ) : months ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          {months.map(month => (
            <MonthCard
              key={month.mois}
              month={month}
              year={effectiveYear}
              onClick={() => {
                if (month.filename) {
                  navigate(`/editor?file=${encodeURIComponent(month.filename)}`)
                }
              }}
              onReconstituer={() => navigate(`/alertes?year=${effectiveYear}&month=${month.mois}&type=justificatif_manquant`)}
            />
          ))}
        </div>
      ) : (
        <p className="text-text-muted text-center py-12">Aucune donn&eacute;e pour {effectiveYear}</p>
      )}

      {/* Summary */}
      {months && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            title="Mois complets"
            value={String(summary.complets)}
            icon={<CheckCircle2 size={20} />}
            trend={summary.complets > 0 ? 'up' : undefined}
          />
          <MetricCard
            title="Mois en cours"
            value={String(summary.partiels)}
            icon={<Clock size={20} />}
            trend={summary.partiels > 0 ? 'down' : undefined}
          />
          <MetricCard
            title="Mois manquants"
            value={String(summary.manquants)}
            icon={<AlertCircle size={20} />}
            trend={summary.manquants > 0 ? 'down' : undefined}
          />
        </div>
      )}
    </div>
  )
}
