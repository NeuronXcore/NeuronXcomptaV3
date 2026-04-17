import { Paperclip, CheckCircle2 } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import type { VentilationLine } from '@/types'

interface VentilationLinesProps {
  lines: VentilationLine[]
  colSpan: number
  categoryColors: Map<string, string>
  onClick: () => void
  onJustifClick?: (justificatif: string) => void
  onAttributeClick?: (vlIdx: number) => void
}

export default function VentilationLines({ lines, colSpan, categoryColors, onClick, onJustifClick, onAttributeClick }: VentilationLinesProps) {
  return (
    <>
      {lines.map((vl: VentilationLine, idx: number) => (
        <tr
          key={`vl-${idx}`}
          className="border-b border-border/10 bg-black/30 cursor-pointer hover:bg-black/40 transition-colors"
          onClick={onClick}
        >
          <td colSpan={2} className="py-0.5 px-2">
            {/* indent marker */}
            <div className="flex items-center gap-1 pl-4">
              <div className="w-0.5 h-4 bg-border rounded-full" />
              <span className="text-[10px] text-text-muted">L{idx + 1}</span>
            </div>
          </td>
          <td className="py-0.5 px-2 text-xs text-text-muted truncate max-w-[200px]">
            {vl.libelle || '—'}
          </td>
          <td className="py-0.5 px-2 text-right font-mono text-xs">
            {formatCurrency(vl.montant)}
          </td>
          <td className="py-0.5 px-2" />
          <td className="py-0.5 px-2">
            {vl.categorie && (
              <span
                className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{
                  backgroundColor: `${categoryColors.get(vl.categorie) || '#6b7280'}20`,
                  color: categoryColors.get(vl.categorie) || '#6b7280',
                }}
              >
                {vl.categorie}
              </span>
            )}
          </td>
          <td className="py-0.5 px-2 text-xs text-text-muted">
            {vl.sous_categorie || ''}
          </td>
          <td className="py-0.5 px-2 text-center">
            {vl.justificatif ? (
              onJustifClick ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onJustifClick(vl.justificatif!)
                  }}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-full text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                  title={`Justificatif: ${vl.justificatif}`}
                >
                  <Paperclip size={12} />
                </button>
              ) : (
                <Paperclip size={12} className="text-success mx-auto" />
              )
            ) : onAttributeClick ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onAttributeClick(idx)
                }}
                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-amber-400 hover:bg-amber-500/15 transition-colors"
                title="Attribuer un justificatif à cette sous-ligne"
              >
                <Paperclip size={12} />
              </button>
            ) : (
              <span className="text-text-muted/30">—</span>
            )}
          </td>
          <td className="py-0.5 px-2" />
          <td className="py-0.5 px-2" />
          <td className="py-0.5 px-2 text-center">
            {vl.lettre ? (
              <CheckCircle2 size={12} className="text-success mx-auto" />
            ) : (
              <span className="text-text-muted/30">—</span>
            )}
          </td>
          <td colSpan={colSpan > 11 ? colSpan - 11 : 1} className="py-0.5 px-2" />
        </tr>
      ))}
    </>
  )
}
