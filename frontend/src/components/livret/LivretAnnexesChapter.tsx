/**
 * Chapitre 09 — Annexes (méta).
 * 4 sous-sections accordion :
 *  - Index justificatifs (paginé 50/page)
 *  - Barèmes appliqués
 *  - Glossaire
 *  - Méthodologie (markdown bref)
 */
import { useMemo, useState } from 'react'
import { Book, ChevronDown, ChevronRight, FileText, Files, Scale } from 'lucide-react'
import { Link } from 'react-router-dom'

import type {
  LivretAnnexeBareme,
  LivretAnnexeChapter as LivretAnnexeChapterType,
  LivretAnnexeJustifEntry,
} from '@/types/livret'
import { cn, formatCurrency, formatDate } from '@/lib/utils'

import LivretChapterShell from './LivretChapterShell'

const PAGE_SIZE = 50

interface Props {
  chapter: LivretAnnexeChapterType
}

export default function LivretAnnexesChapter({ chapter }: Props) {
  return (
    <LivretChapterShell
      number={chapter.number}
      title={chapter.title}
      tag={chapter.tag}
    >
      <div className="space-y-3">
        <Section
          icon={<Files size={14} />}
          title={`Index des justificatifs (${chapter.justificatifs_index.length})`}
          defaultOpen={chapter.justificatifs_index.length > 0 && chapter.justificatifs_index.length < 100}
        >
          <JustifsIndexTable entries={chapter.justificatifs_index} />
        </Section>

        <Section
          icon={<Scale size={14} />}
          title={`Barèmes appliqués (${chapter.baremes_appliques.length})`}
          defaultOpen={chapter.baremes_appliques.length > 0 && chapter.baremes_appliques.length <= 8}
        >
          <BaremesGrid baremes={chapter.baremes_appliques} />
        </Section>

        <Section
          icon={<Book size={14} />}
          title={`Glossaire (${chapter.glossaire.length})`}
          defaultOpen={false}
        >
          <Glossaire entries={chapter.glossaire} />
        </Section>

        <Section
          icon={<FileText size={14} />}
          title="Méthodologie"
          defaultOpen={false}
        >
          <MethodologieMarkdown content={chapter.methodologie} />
        </Section>
      </div>
    </LivretChapterShell>
  )
}

function Section({
  icon,
  title,
  defaultOpen,
  children,
}: {
  icon: React.ReactNode
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="rounded-xl border border-border bg-surface-hover/30 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-hover transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{icon}</span>
          <span className="text-sm font-semibold text-text">{title}</span>
        </div>
        {open ? (
          <ChevronDown size={14} className="text-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-text-muted" />
        )}
      </button>
      {open && <div className="px-4 py-4 border-t border-border">{children}</div>}
    </div>
  )
}

function JustifsIndexTable({ entries }: { entries: LivretAnnexeJustifEntry[] }) {
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const slice = useMemo(
    () => entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [entries, page],
  )

  if (entries.length === 0) {
    return <p className="text-sm text-text-muted italic">Aucun justificatif référencé pour cet exercice.</p>
  }

  return (
    <div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-hover">
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Fichier</th>
              <th className="px-3 py-2 font-semibold">Libellé op</th>
              <th className="px-3 py-2 font-semibold text-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((j, i) => (
              <tr key={`${j.filename}-${j.operation_index}-${i}`} className="border-t border-border hover:bg-surface-hover/50">
                <td className="px-3 py-2 text-text-muted tabular-nums whitespace-nowrap">
                  {j.date ? formatDate(j.date) : '—'}
                </td>
                <td className="px-3 py-2 text-text">
                  <span className="font-mono text-[11px] truncate inline-block max-w-[280px]" title={j.filename}>
                    {j.filename}
                  </span>
                  {j.is_facsimile && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-primary/15 text-primary">
                      fac-similé
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-text-muted">
                  <span className="truncate inline-block max-w-[280px]" title={j.libelle_op || ''}>
                    {j.libelle_op || '—'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {j.montant ? formatCurrency(j.montant) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-text-muted tabular-nums">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, entries.length)} sur{' '}
            {entries.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className={cn(
                'px-2 py-1 rounded-md text-xs',
                page === 0
                  ? 'bg-surface-hover text-text-muted/40 cursor-not-allowed'
                  : 'bg-surface text-text hover:bg-surface-hover',
              )}
            >
              ← Précédent
            </button>
            <span className="text-xs text-text-muted tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className={cn(
                'px-2 py-1 rounded-md text-xs',
                page >= totalPages - 1
                  ? 'bg-surface-hover text-text-muted/40 cursor-not-allowed'
                  : 'bg-surface text-text hover:bg-surface-hover',
              )}
            >
              Suivant →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function BaremesGrid({ baremes }: { baremes: LivretAnnexeBareme[] }) {
  if (baremes.length === 0) {
    return <p className="text-sm text-text-muted italic">Aucun barème enregistré pour cet exercice.</p>
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {baremes.map((b) => (
        <div key={b.file} className="rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-text">{b.nom}</h4>
            <span className="text-[10px] text-text-muted font-mono">{b.file}</span>
          </div>
          <dl className="mt-2 text-xs space-y-1">
            {Object.entries(b.summary).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2">
                <dt className="text-text-muted shrink-0">{k}:</dt>
                <dd className="text-text tabular-nums truncate">
                  {v === null || v === undefined ? '—' : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

function Glossaire({ entries }: { entries: Array<{ term: string; definition: string }> }) {
  return (
    <dl className="space-y-3">
      {entries.map((e) => (
        <div key={e.term} className="border-l-2 border-primary/40 pl-3">
          <dt className="text-sm font-semibold text-text">{e.term}</dt>
          <dd className="text-xs text-text-muted mt-0.5">{e.definition}</dd>
        </div>
      ))}
    </dl>
  )
}

function MethodologieMarkdown({ content }: { content: string }) {
  // Rendu très simple — pas de full markdown parser pour Phase 2.
  // On affiche les ## en titres et les bullet lists basiques.
  const lines = content.split('\n')
  return (
    <div className="prose prose-invert prose-sm max-w-none text-sm space-y-2">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return (
            <h3 key={i} className="text-base font-semibold text-text mt-3">
              {line.slice(3)}
            </h3>
          )
        }
        if (line.startsWith('- ')) {
          return (
            <li key={i} className="ml-4 text-text-muted">
              {renderInline(line.slice(2))}
            </li>
          )
        }
        if (line.trim() === '') return null
        return (
          <p key={i} className="text-text-muted">
            {renderInline(line)}
          </p>
        )
      })}
    </div>
  )
}

function renderInline(text: string): React.ReactNode {
  // Gère **bold** et `code` simples
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      parts.push(
        <strong key={key++} className="text-text font-semibold">
          {tok.slice(2, -2)}
        </strong>,
      )
    } else if (tok.startsWith('`')) {
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-surface text-primary text-xs">
          {tok.slice(1, -1)}
        </code>,
      )
    }
    lastIdx = m.index + tok.length
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  remaining = '' // unused, just suppress lint
  void remaining
  return parts
}
