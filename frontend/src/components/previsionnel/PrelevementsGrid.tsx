import { cn } from '@/lib/utils'
import { formatCurrency, MOIS_FR } from '@/lib/utils'
import { AlertTriangle } from 'lucide-react'
import type { PrevPrelevement } from '@/types'

interface Props {
  prelevements: PrevPrelevement[]
  onClickMois?: (mois: number) => void
}

const STATUT_BG: Record<string, string> = {
  verifie: 'bg-emerald-500/10 border-emerald-500/30',
  ecart: 'bg-amber-500/10 border-amber-500/30',
  attendu: 'bg-surface border-border',
  non_preleve: 'bg-red-500/10 border-red-500/30',
  manuel: 'bg-blue-500/10 border-blue-500/30',
}

export default function PrelevementsGrid({ prelevements, onClickMois }: Props) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {prelevements.map((p) => (
        <button
          key={p.mois}
          onClick={() => onClickMois?.(p.mois)}
          className={cn(
            'rounded-lg border p-2 text-left transition-colors hover:brightness-110',
            STATUT_BG[p.statut] || STATUT_BG.attendu,
          )}
        >
          <p className="text-[9px] text-text-muted uppercase">{p.mois_label?.slice(0, 3) || MOIS_FR[p.mois - 1]?.slice(0, 3)}</p>
          <p className="text-xs font-mono text-text flex items-center gap-0.5">
            {formatCurrency(p.montant_reel ?? p.montant_attendu)}
            {p.ocr_confidence != null && p.ocr_confidence < 0.7 && (
              <AlertTriangle size={8} className="text-amber-400" />
            )}
          </p>
          {p.ecart != null && p.ecart !== 0 && (
            <p className={cn('text-[8px] font-mono', p.ecart > 0 ? 'text-red-400' : 'text-emerald-400')}>
              {p.ecart > 0 ? '+' : ''}{formatCurrency(p.ecart)}
            </p>
          )}
        </button>
      ))}
    </div>
  )
}
