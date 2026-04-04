import { useEffect } from 'react'
import { X, TrendingUp, TrendingDown, FileText, Loader2 } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { useCompareReports } from '@/hooks/useReports'
import type { ReportComparison } from '@/types'

interface ReportCompareDrawerProps {
  filenameA: string | null
  filenameB: string | null
  isOpen: boolean
  onClose: () => void
}

function DeltaBadge({ value, label, invert = false }: { value: number; label: string; invert?: boolean }) {
  const isPositive = value > 0
  const isGood = invert ? !isPositive : isPositive
  return (
    <div className="text-center">
      <p className="text-[10px] text-text-muted mb-1">{label}</p>
      <span className={cn(
        'text-sm font-bold px-2 py-1 rounded-lg',
        isGood ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
      )}>
        {isPositive ? '+' : ''}{value.toFixed(1)}%
      </span>
    </div>
  )
}

export default function ReportCompareDrawer({ filenameA, filenameB, isOpen, onClose }: ReportCompareDrawerProps) {
  const compareMutation = useCompareReports()

  useEffect(() => {
    if (isOpen && filenameA && filenameB) {
      compareMutation.mutate({ filename_a: filenameA, filename_b: filenameB })
    }
  }, [isOpen, filenameA, filenameB])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const data = compareMutation.data

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}

      <div className={cn(
        'fixed top-0 right-0 h-full w-[700px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">Comparaison de rapports</p>
              <p className="text-xs text-text-muted">Deltas entre deux périodes</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {compareMutation.isPending && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-primary" />
            </div>
          )}

          {data && (
            <>
              {/* Side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface rounded-lg border border-border p-4">
                  <p className="text-[10px] text-text-muted uppercase mb-1">Rapport A</p>
                  <p className="text-sm font-medium text-text">{data.report_a.title}</p>
                  <div className="mt-2 space-y-1 text-xs text-text-muted">
                    <p>{data.report_a.nb_operations} opérations</p>
                    <p>Débit: <span className="text-red-400">{formatCurrency(data.report_a.total_debit)}</span></p>
                    <p>Crédit: <span className="text-emerald-400">{formatCurrency(data.report_a.total_credit)}</span></p>
                  </div>
                </div>
                <div className="bg-surface rounded-lg border border-border p-4">
                  <p className="text-[10px] text-text-muted uppercase mb-1">Rapport B</p>
                  <p className="text-sm font-medium text-text">{data.report_b.title}</p>
                  <div className="mt-2 space-y-1 text-xs text-text-muted">
                    <p>{data.report_b.nb_operations} opérations</p>
                    <p>Débit: <span className="text-red-400">{formatCurrency(data.report_b.total_debit)}</span></p>
                    <p>Crédit: <span className="text-emerald-400">{formatCurrency(data.report_b.total_credit)}</span></p>
                  </div>
                </div>
              </div>

              {/* Deltas */}
              <div className="bg-surface rounded-lg border border-border p-5">
                <h3 className="text-xs font-semibold text-text uppercase mb-4">Variations A → B</h3>
                <div className="grid grid-cols-3 gap-4">
                  <DeltaBadge value={data.delta_debit_pct} label="Dépenses" invert />
                  <DeltaBadge value={data.delta_credit_pct} label="Recettes" />
                  <div className="text-center">
                    <p className="text-[10px] text-text-muted mb-1">Opérations</p>
                    <span className={cn(
                      'text-sm font-bold px-2 py-1 rounded-lg',
                      data.delta_ops >= 0 ? 'bg-blue-500/15 text-blue-400' : 'bg-amber-500/15 text-amber-400'
                    )}>
                      {data.delta_ops >= 0 ? '+' : ''}{data.delta_ops}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-border">
                  <div>
                    <p className="text-[10px] text-text-muted">Delta Débit</p>
                    <p className={cn('text-sm font-medium', data.delta_debit >= 0 ? 'text-red-400' : 'text-emerald-400')}>
                      {data.delta_debit >= 0 ? '+' : ''}{formatCurrency(data.delta_debit)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-muted">Delta Crédit</p>
                    <p className={cn('text-sm font-medium', data.delta_credit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {data.delta_credit >= 0 ? '+' : ''}{formatCurrency(data.delta_credit)}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
