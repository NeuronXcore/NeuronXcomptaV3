import { useState } from 'react'
import { FileText, Table, Sheet } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { GedDocument, PosteComptable } from '@/types'

interface GedDocumentGridProps {
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

export default function GedDocumentGrid({ documents, postes, onSelect }: GedDocumentGridProps) {
  const postesMap = Object.fromEntries(postes.map(p => [p.id, p]))

  return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
      {documents.map(doc => (
        <DocumentCard
          key={doc.doc_id}
          doc={doc}
          postesMap={postesMap}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function DocumentCard({
  doc,
  postesMap,
  onSelect,
}: {
  doc: GedDocument
  postesMap: Record<string, PosteComptable>
  onSelect: (docId: string) => void
}) {
  const [thumbError, setThumbError] = useState(false)
  const name = doc.original_name || doc.doc_id.split('/').pop() || ''
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const poste = doc.poste_comptable ? postesMap[doc.poste_comptable] : null

  // Effective deductibility
  const effectivePct = doc.deductible_pct_override ?? (poste?.deductible_pct ?? 0)
  const deductible = doc.montant_brut ? doc.montant_brut * effectivePct / 100 : null

  const FallbackIcon = ext === 'csv' ? Table : ext === 'xlsx' ? Sheet : FileText

  return (
    <button
      onClick={() => onSelect(doc.doc_id)}
      className="bg-surface border border-border rounded-lg overflow-hidden hover:border-primary/50 transition-colors text-left group"
    >
      {/* Thumbnail */}
      <div className="aspect-[3/4] bg-background flex items-center justify-center overflow-hidden">
        {!thumbError ? (
          <img
            src={`/api/ged/documents/${encodeURIComponent(doc.doc_id)}/thumbnail?v=${encodeURIComponent(doc.added_at ?? '')}`}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-text-muted">
            <FallbackIcon size={32} />
            <span className="text-[10px] uppercase">{ext}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2 space-y-1">
        <p className="text-[11px] text-text font-medium truncate" title={name}>{name}</p>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${TYPE_COLORS[doc.type] || 'bg-surface text-text-muted'}`}>
            {TYPE_LABELS[doc.type] || doc.type}
          </span>
          {poste && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface text-text-muted truncate max-w-[100px]" title={poste.label}>
              {poste.label}
            </span>
          )}
        </div>

        {doc.montant_brut != null && (
          <div className="text-xs">
            <span className="text-text">{formatCurrency(doc.montant_brut)}</span>
            {deductible != null && effectivePct < 100 && (
              <span className="text-text-muted ml-1">
                ({formatCurrency(deductible)} · {effectivePct}%)
              </span>
            )}
          </div>
        )}

        {doc.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {doc.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded">
                {tag}
              </span>
            ))}
            {doc.tags.length > 3 && (
              <span className="text-[9px] text-text-muted">+{doc.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
