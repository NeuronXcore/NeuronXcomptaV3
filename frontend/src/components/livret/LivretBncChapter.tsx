/**
 * Chapitre 08 — BNC fiscal (synthèse).
 * Bloc formula style monospace + bloc projection 4 cards (BNC projeté, IR,
 * Charges sociales, Net après charges).
 */
import { Calculator, Coins, Receipt, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { LivretBncChapter as LivretBncChapterType, LivretBncFormulaLine } from '@/types/livret'
import { cn, formatCurrency } from '@/lib/utils'

import LivretChapterShell from './LivretChapterShell'
import LivretChart from './charts/LivretChart'

interface Props {
  chapter: LivretBncChapterType
}

export default function LivretBncChapter({ chapter }: Props) {
  const sourceRecettes = chapter.sources.recettes
  const isLiasse = sourceRecettes === 'liasse'

  return (
    <LivretChapterShell
      number={chapter.number}
      title={chapter.title}
      tag={chapter.tag}
      totalYtd={chapter.total_ytd}
      totalProjectedAnnual={chapter.total_projected_annual}
      deltaN1={chapter.delta_n1}
    >
      {!isLiasse && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 mb-6">
          <p className="text-sm text-warning font-medium">
            ⚠ Recettes calculées en base bancaire — saisir la liasse fiscale SCP pour finaliser le BNC.
          </p>
          <Link
            to="/visualization"
            className="inline-block mt-2 text-xs text-primary hover:underline"
          >
            Saisir la liasse SCP →
          </Link>
        </div>
      )}

      {/* Phase 5 — waterfall en tête (avant la formule détaillée) */}
      {(chapter.charts ?? []).map((c) => (
        <LivretChart key={c.id} config={c} chapterNumber={chapter.number} />
      ))}

      {/* Formule */}
      <div className="rounded-xl border border-border bg-surface-hover/30 p-5 mb-6">
        <h3 className="text-xs uppercase tracking-wider text-text-muted mb-3 font-semibold">
          Formule BNC (YTD)
        </h3>
        <div className="font-mono text-sm space-y-1.5">
          {chapter.formula.map((line, i) => (
            <FormulaRow key={i} line={line} />
          ))}
        </div>
        <p className="text-[11px] text-text-muted mt-3 italic">{chapter.formula_comment}</p>
      </div>

      {/* Projection annuelle */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-text-muted mb-3 font-semibold">
          Projection fiscale annuelle
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ProjCard
            label="BNC projeté"
            value={chapter.projection.bnc_projete_annuel}
            icon={<Wallet size={14} />}
            tone="primary"
          />
          <ProjCard
            label="Impôt sur le revenu"
            value={chapter.projection.ir_estime}
            icon={<Receipt size={14} />}
            tone="warning"
          />
          <ProjCard
            label="Charges sociales"
            value={chapter.projection.total_charges_sociales_estime}
            icon={<Coins size={14} />}
            tone="warning"
            sub={`URSSAF ${formatCurrency(chapter.projection.urssaf_estime)} · CARMF ${formatCurrency(chapter.projection.carmf_estime)} · OdM ${formatCurrency(chapter.projection.odm_estime)}`}
          />
          <ProjCard
            label="Revenu net après charges"
            value={chapter.projection.revenu_net_apres_charges}
            icon={<Calculator size={14} />}
            tone="success"
          />
        </div>
      </div>

      {/* Sources */}
      <div className="mt-6 pt-4 border-t border-border">
        <p className="text-[11px] text-text-muted">
          <span className="uppercase tracking-wider font-semibold">Sources</span>
          {' · '}
          {Object.entries(chapter.sources).map(([k, v], i, arr) => (
            <span key={k}>
              {k}: <span className="text-text">{v}</span>
              {i < arr.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
      </div>
    </LivretChapterShell>
  )
}

function FormulaRow({ line }: { line: LivretBncFormulaLine }) {
  const opSymbol = line.operator === 'plus' ? '+' : line.operator === 'minus' ? '−' : '='
  const isResult = line.operator === 'equals'
  const opColor = line.operator === 'plus' ? 'text-success' : line.operator === 'minus' ? 'text-danger' : 'text-primary'

  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1.5',
        isResult && 'border-t border-primary/40 mt-2 pt-2 font-bold',
      )}
    >
      <div className="flex items-baseline gap-3 flex-1 min-w-0">
        <span className={cn('w-4 inline-block text-center font-bold', opColor)}>{opSymbol}</span>
        <div className="flex-1 min-w-0">
          <span className={isResult ? 'text-text' : 'text-text'}>{line.label}</span>
          {line.note && (
            <div className="text-[10px] text-text-muted italic mt-0.5 ml-0">
              {line.note}
            </div>
          )}
        </div>
      </div>
      <span
        className={cn(
          'tabular-nums shrink-0',
          isResult ? 'text-primary text-base' : 'text-text',
        )}
      >
        {formatCurrency(line.amount)}
      </span>
    </div>
  )
}

function ProjCard({
  label,
  value,
  icon,
  tone,
  sub,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone: 'primary' | 'warning' | 'success'
  sub?: string
}) {
  const toneCls =
    tone === 'primary' ? 'text-primary' : tone === 'success' ? 'text-success' : 'text-warning'

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-text-muted text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn('text-xl font-bold mt-2 tabular-nums', toneCls)}>
        {formatCurrency(value)}
      </div>
      {sub && <p className="text-[10px] text-text-muted mt-1 italic">{sub}</p>}
    </div>
  )
}
