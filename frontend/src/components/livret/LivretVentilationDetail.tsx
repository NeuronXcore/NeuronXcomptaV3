/**
 * Détail dépliable d'une op : sous-lignes pro/perso, justificatif, méta lock/lettre.
 * En mode groupé (chapitre 02), affiche les sub_lines de la ventilation en arborescence.
 */
import { Link2, Lock } from 'lucide-react'
import type { LivretOperation } from '@/types/livret'
import { formatCurrency, formatDate } from '@/lib/utils'
import LivretFlagPills from './LivretFlagPills'

interface Props {
  operation: LivretOperation
}

export default function LivretVentilationDetail({ operation }: Props) {
  const subLines = operation.sub_lines ?? []

  return (
    <div className="bg-surface-hover/40 px-4 py-3 border-l-2 border-primary/40">
      {subLines.length > 0 ? (
        <>
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-2">
            Ventilation ({subLines.length} sous-ligne{subLines.length > 1 ? 's' : ''})
          </div>
          <table className="w-full text-sm">
            <tbody>
              {subLines.map((sl, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-1.5 text-text-muted text-xs tabular-nums w-24">
                    {formatDate(sl.date)}
                  </td>
                  <td className="py-1.5 text-text">
                    <div>{sl.libelle}</div>
                    {sl.libelle_meta && (
                      <div className="text-[11px] text-text-muted italic">{sl.libelle_meta}</div>
                    )}
                  </td>
                  <td className="py-1.5 w-24">
                    <LivretFlagPills flags={sl.flags} size={9} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums w-28">
                    {formatCurrency(sl.montant)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div className="text-xs text-text-muted">Pas de ventilation pour cette opération.</div>
      )}

      {operation.flags.locked && (
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-text-muted">
          <Lock size={11} /> Verrouillée — éditable depuis l'Éditeur
        </div>
      )}
      {operation.flags.lettre && (
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-success ml-3">
          <Link2 size={11} /> Lettrée
        </div>
      )}
    </div>
  )
}
