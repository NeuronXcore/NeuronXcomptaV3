import { formatCurrency } from '@/lib/utils'
import type { GedDocument, PosteComptable } from '@/types'

interface GedDocumentListProps {
  documents: GedDocument[]
  postes: PosteComptable[]
  onSelect: (docId: string) => void
}

const TYPE_LABELS: Record<string, string> = {
  releve: 'Relevé',
  justificatif: 'Justificatif',
  rapport: 'Rapport',
  document_libre: 'Document',
}

const TYPE_COLORS: Record<string, string> = {
  releve: 'bg-blue-500/15 text-blue-400',
  justificatif: 'bg-amber-500/15 text-amber-400',
  rapport: 'bg-emerald-500/15 text-emerald-400',
  document_libre: 'bg-purple-500/15 text-purple-400',
}

export default function GedDocumentList({ documents, postes, onSelect }: GedDocumentListProps) {
  const postesMap = Object.fromEntries(postes.map(p => [p.id, p]))

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface border-b border-border text-text-muted text-xs">
            <th className="text-left px-3 py-2 font-medium">Nom</th>
            <th className="text-left px-3 py-2 font-medium w-24">Type</th>
            <th className="text-left px-3 py-2 font-medium w-28">Date</th>
            <th className="text-left px-3 py-2 font-medium w-36">Poste</th>
            <th className="text-right px-3 py-2 font-medium w-24">Montant</th>
            <th className="text-right px-3 py-2 font-medium w-28">Déductible</th>
            <th className="text-left px-3 py-2 font-medium w-32">Tags</th>
          </tr>
        </thead>
        <tbody>
          {documents.map(doc => {
            const name = doc.original_name || doc.doc_id.split('/').pop() || ''
            const poste = doc.poste_comptable ? postesMap[doc.poste_comptable] : null
            const effectivePct = doc.deductible_pct_override ?? (poste?.deductible_pct ?? 0)
            const deductible = doc.montant_brut ? doc.montant_brut * effectivePct / 100 : null

            return (
              <tr
                key={doc.doc_id}
                onClick={() => onSelect(doc.doc_id)}
                className="border-b border-border hover:bg-surface-hover cursor-pointer transition-colors"
              >
                <td className="px-3 py-2">
                  <p className="text-text truncate max-w-[250px]" title={name}>{name}</p>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${TYPE_COLORS[doc.type] || ''}`}>
                    {TYPE_LABELS[doc.type] || doc.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-text-muted text-xs">
                  {doc.added_at ? new Date(doc.added_at).toLocaleDateString('fr-FR') : '-'}
                </td>
                <td className="px-3 py-2">
                  {poste ? (
                    <span className="text-xs text-text-muted truncate block max-w-[120px]" title={poste.label}>
                      {poste.label}
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  {doc.montant_brut != null ? formatCurrency(doc.montant_brut) : '-'}
                </td>
                <td className="px-3 py-2 text-right text-xs text-text-muted">
                  {deductible != null ? `${formatCurrency(deductible)} (${effectivePct}%)` : '-'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1 flex-wrap">
                    {doc.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                    {doc.tags.length > 2 && (
                      <span className="text-[9px] text-text-muted">+{doc.tags.length - 2}</span>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
