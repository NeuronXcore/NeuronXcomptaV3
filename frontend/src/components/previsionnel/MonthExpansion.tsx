import { X, Building2, Calculator, Receipt, AlertTriangle } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import StatusBadge from './StatusBadge'
import type { TimelineMois } from '@/types'

interface Props {
  month: TimelineMois
  onClose: () => void
}

export default function MonthExpansion({ month, onClose }: Props) {
  const sourceIcon = (source: string) => {
    switch (source) {
      case 'provider': return <Building2 size={12} className="text-violet-400" />
      case 'realise': return <Receipt size={12} className="text-emerald-400" />
      default: return <Calculator size={12} className="text-gray-400" />
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5 animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text">{month.label}</h3>
        <button onClick={onClose} className="p-1 text-text-muted hover:text-text">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Charges */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-red-400">Charges</p>
            <p className="text-xs font-mono text-red-400">{formatCurrency(month.charges_total)}</p>
          </div>
          <div className="space-y-1.5">
            {month.charges.sort((a, b) => b.montant - a.montant).map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                {sourceIcon(p.source)}
                <span className="flex-1 text-text-muted truncate">{p.label}</span>
                {p.type_cotisation === 'urssaf_acompte' && (
                  <span className="text-[9px] px-1.5 py-0.5 bg-sky-500/15 text-sky-400 rounded uppercase tracking-wide">
                    Acompte
                  </span>
                )}
                {p.type_cotisation === 'urssaf_regul' && (
                  <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded uppercase tracking-wide">
                    Régul N−1
                  </span>
                )}
                <span className="font-mono text-text">{formatCurrency(p.montant)}</span>
                <StatusBadge statut={p.statut} />
              </div>
            ))}
            {month.charges.length === 0 && (
              <p className="text-[10px] text-text-muted italic">Aucune charge</p>
            )}
          </div>
        </div>

        {/* Recettes */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-emerald-400">Recettes</p>
            <p className="text-xs font-mono text-emerald-400">{formatCurrency(month.recettes_total)}</p>
          </div>
          <div className="space-y-1.5">
            {month.recettes.sort((a, b) => b.montant - a.montant).map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                {sourceIcon(p.source)}
                <span className="flex-1 text-text-muted truncate">{p.label}</span>
                <span className="font-mono text-text">{formatCurrency(p.montant)}</span>
                <StatusBadge statut={p.statut} />
                {p.confidence != null && p.confidence < 0.5 && (
                  <AlertTriangle size={10} className="text-amber-400" />
                )}
              </div>
            ))}
            {month.recettes.length === 0 && (
              <p className="text-[10px] text-text-muted italic">Aucune recette</p>
            )}
          </div>
        </div>
      </div>

      {/* Résumé */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border text-xs">
        <span className="text-text-muted">Total charges</span>
        <span className="font-mono text-red-400">{formatCurrency(month.charges_total)}</span>
        <span className="text-text-muted">Total recettes</span>
        <span className="font-mono text-emerald-400">{formatCurrency(month.recettes_total)}</span>
        <span className="text-text-muted font-medium">Solde</span>
        <span className={cn('font-mono font-bold', month.solde >= 0 ? 'text-emerald-400' : 'text-red-400')}>
          {formatCurrency(month.solde)}
        </span>
      </div>
    </div>
  )
}
