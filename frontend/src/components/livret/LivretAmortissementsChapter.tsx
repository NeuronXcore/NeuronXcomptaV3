/**
 * Chapitre 06 — Amortissements.
 * Tableau immobilisations 8 colonnes (nom + badge reprise, poste, val.origine,
 * date, durée, dotation YTD, cumul, VNC). Footer : total dotations YTD.
 */
import { Landmark, Package } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { LivretAmortissementsChapter as LivretAmortissementsChapterType } from '@/types/livret'
import { formatCurrency, formatDate } from '@/lib/utils'

import LivretChapterShell from './LivretChapterShell'

interface Props {
  chapter: LivretAmortissementsChapterType
}

export default function LivretAmortissementsChapter({ chapter }: Props) {
  const { immobilisations: immos, total_dotations_annuelles: totalDotations } = chapter

  return (
    <LivretChapterShell
      number={chapter.number}
      title={chapter.title}
      tag={chapter.tag}
      totalYtd={chapter.total_ytd}
      deltaN1={chapter.delta_n1}
    >
      {immos.length === 0 ? (
        <div className="text-sm text-text-muted italic px-2 py-8 text-center space-y-3">
          <p>Aucune immobilisation enregistrée.</p>
          <Link
            to="/amortissements"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
          >
            <Landmark size={14} /> Aller au registre →
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-surface-hover">
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
                <th className="px-3 py-2 font-semibold">Immobilisation</th>
                <th className="px-3 py-2 font-semibold">Poste</th>
                <th className="px-3 py-2 font-semibold">Acquis le</th>
                <th className="px-3 py-2 font-semibold text-right">Durée</th>
                <th className="px-3 py-2 font-semibold text-right">Val. origine</th>
                <th className="px-3 py-2 font-semibold text-right">Dotation YTD</th>
                <th className="px-3 py-2 font-semibold text-right">Cumul</th>
                <th className="px-3 py-2 font-semibold text-right">VNC</th>
              </tr>
            </thead>
            <tbody>
              {immos.map((immo, i) => (
                <tr key={`${immo.nom}-${i}`} className="border-t border-border hover:bg-surface-hover/50">
                  <td className="px-3 py-2 text-text">
                    <div className="flex items-start gap-2">
                      <Package size={12} className="mt-1 text-primary/70 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-medium" title={immo.nom}>
                          {immo.nom}
                        </div>
                        {immo.is_backfill && (
                          <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] bg-warning/15 text-warning">
                            Reprise
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-text-muted text-xs">{immo.poste}</td>
                  <td className="px-3 py-2 text-text-muted tabular-nums whitespace-nowrap">
                    {immo.date_acquisition ? formatDate(immo.date_acquisition) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-text-muted tabular-nums">
                    {immo.duree_amortissement} ans
                  </td>
                  <td className="px-3 py-2 text-right text-text tabular-nums">
                    {formatCurrency(immo.valeur_origine)}
                  </td>
                  <td className="px-3 py-2 text-right text-primary tabular-nums">
                    {immo.dotation_annuelle > 0 ? formatCurrency(immo.dotation_annuelle) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-text-muted tabular-nums">
                    {formatCurrency(immo.cumul_amortissement)}
                  </td>
                  <td className="px-3 py-2 text-right text-text tabular-nums font-medium">
                    {formatCurrency(immo.vnc)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-primary/10 border-t-2 border-primary/30">
                <td colSpan={5} className="px-3 py-2 text-text font-semibold text-right">
                  Total dotations YTD
                </td>
                <td colSpan={3} className="px-3 py-2 text-right text-primary font-bold tabular-nums">
                  {formatCurrency(totalDotations)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </LivretChapterShell>
  )
}
