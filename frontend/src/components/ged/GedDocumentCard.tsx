import { FileText, Receipt, BarChart3, FolderOpen, Star, FileSpreadsheet, File } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import type { GedDocument } from '@/types'

const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

const TYPE_ICON: Record<string, typeof FileText> = {
  releve: FileText,
  justificatif: Receipt,
  rapport: BarChart3,
  document_libre: FolderOpen,
}

const TYPE_LABEL: Record<string, string> = {
  releve: 'Relevé',
  justificatif: 'Justificatif',
  rapport: 'Rapport',
  document_libre: 'Document',
}

interface GedDocumentCardProps {
  document: GedDocument
  isSelected: boolean
  onSelect: () => void
  onClick: () => void
  compareMode?: boolean
}

export default function GedDocumentCard({
  document: doc,
  isSelected,
  onSelect,
  onClick,
  compareMode,
}: GedDocumentCardProps) {
  const Icon = TYPE_ICON[doc.type] || File
  const rm = doc.rapport_meta
  const title = rm?.title || doc.original_name || doc.doc_id.split('/').pop() || ''
  const isFavorite = rm?.favorite
  const format = rm?.format || doc.doc_id.split('.').pop()?.toUpperCase() || ''

  // Period label
  const period = doc.period
  let periodLabel = ''
  if (period?.month && period?.year) {
    periodLabel = `${MOIS_FR[(period.month - 1)] || ''} ${period.year}`
  } else if (period?.quarter && period?.year) {
    periodLabel = `T${period.quarter} ${period.year}`
  } else if (period?.year) {
    periodLabel = String(period.year)
  } else if (doc.year) {
    periodLabel = doc.month ? `${MOIS_FR[(doc.month - 1)] || ''} ${doc.year}` : String(doc.year)
  }

  const montant = doc.montant || doc.montant_brut

  return (
    <div
      className={cn(
        'group relative bg-surface border border-border rounded-lg overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:border-primary/30',
        isSelected && 'ring-2 ring-primary border-primary'
      )}
      onClick={onClick}
    >
      {/* Compare checkbox */}
      {compareMode && doc.type === 'rapport' && (
        <div className="absolute top-2 left-2 z-10">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={e => { e.stopPropagation(); onSelect() }}
            className="w-4 h-4 accent-primary"
          />
        </div>
      )}

      {/* Thumbnail area */}
      <div className="h-[120px] bg-background flex items-center justify-center relative">
        <img
          src={`/api/ged/documents/${encodeURIComponent(doc.doc_id)}/thumbnail?v=${encodeURIComponent(doc.added_at ?? '')}`}
          alt=""
          className="max-h-full max-w-full object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none'
            ;(e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden')
          }}
        />
        <div className="hidden flex-col items-center gap-1 text-text-muted">
          <Icon size={32} />
          <span className="text-[10px]">{format}</span>
        </div>
        {isFavorite && (
          <Star size={14} className="absolute top-2 right-2 fill-warning text-warning" />
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-1">
        <p className="text-xs font-medium text-text truncate" title={title}>{title}</p>

        <div className="flex items-center gap-1 text-[10px] text-text-muted">
          <Icon size={10} />
          <span>{TYPE_LABEL[doc.type] || doc.type}</span>
          {format && <span className="uppercase">· {format}</span>}
        </div>

        {doc.categorie && (
          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary truncate max-w-full">
            {doc.categorie}
          </span>
        )}

        {doc.fournisseur && (
          <p className="text-[10px] text-text-muted truncate">{doc.fournisseur}</p>
        )}

        {periodLabel && (
          <p className="text-[10px] text-text-muted">{periodLabel}</p>
        )}

        {montant != null && montant !== 0 && (
          <p className="text-[10px] font-medium text-text">{formatCurrency(Math.abs(montant))}</p>
        )}

        {doc.is_reconstitue && (
          <span className="text-sm" title="Fac-similé reconstitué">😈</span>
        )}
        {doc.statut_justificatif === 'en_attente' && (
          <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">
            EN ATTENTE
          </span>
        )}
      </div>
    </div>
  )
}
