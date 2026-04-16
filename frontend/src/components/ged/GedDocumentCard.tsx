import {
  FileText, Receipt, BarChart3, FolderOpen, Star, File,
  Link as LinkIcon, CheckCircle2, Lock, Building2, Tag, CalendarDays, Euro,
} from 'lucide-react'
import { cn, formatCurrency, formatDateShort } from '@/lib/utils'
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

  // Badges overlay pour justificatifs uniquement
  const isJustificatif = doc.type === 'justificatif'
  const isPending = doc.statut_justificatif === 'en_attente'
  const isAssociated = !isPending && !!doc.operation_ref
  const isLocked = !!doc.op_locked
  const displayDate = doc.date_document || doc.date_operation

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

        {/* Favori : top-left pour justificatifs (libère top-right pour badge statut), top-right sinon */}
        {isFavorite && (
          <Star
            size={14}
            className={cn(
              'absolute fill-warning text-warning',
              isJustificatif ? 'top-2 left-2' : 'top-2 right-2',
            )}
          />
        )}

        {/* Badges overlay — uniquement pour les justificatifs */}
        {isJustificatif && (
          <>
            {/* Statut + Lock — top-right empilés */}
            <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
              {(isPending || isAssociated) && (
                <div
                  className={cn(
                    'inline-flex items-center gap-1 h-5 px-[7px] rounded-full text-[10px] font-medium border',
                    // En attente : beige | Associé : orange (cohérent avec la demande utilisateur)
                    isPending
                      ? 'bg-[#FAEEDA] text-[#854F0B] border-[#FAC775]'
                      : 'bg-[#FFE6D0] text-[#C2410C] border-[#F59E0B]',
                  )}
                  title={isPending ? 'Justificatif en attente d\'association' : 'Justificatif associé à une opération'}
                >
                  {isPending ? <LinkIcon size={10} /> : <CheckCircle2 size={10} />}
                  <span>{isPending ? 'En attente' : 'Associé'}</span>
                </div>
              )}
              {isLocked && (
                <div
                  className="inline-flex items-center gap-1 h-5 px-[7px] rounded-full text-[10px] font-medium bg-warning/90 text-white border border-warning shadow"
                  title={`Opération verrouillée${doc.op_locked_at ? ` — ${doc.op_locked_at}` : ''}`}
                >
                  <Lock size={10} />
                  <span>Verrouillé</span>
                </div>
              )}
            </div>

            {/* Montant — bottom-left */}
            {doc.montant != null && (
              <div className="absolute bottom-1.5 left-1.5 h-5 px-[7px] rounded-full text-[10px] font-medium bg-black/55 text-white inline-flex items-center whitespace-nowrap">
                {doc.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
              </div>
            )}

            {/* Date — bottom-right */}
            {displayDate && (
              <div className="absolute bottom-1.5 right-1.5 h-5 px-[7px] rounded-full text-[10px] font-medium bg-black/55 text-white inline-flex items-center whitespace-nowrap">
                {formatDateShort(displayDate)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-1.5">
        <p className="text-xs font-medium text-text truncate" title={title}>{title}</p>

        <div className="flex items-center gap-1 text-[10px] text-text-muted">
          <Icon size={10} />
          <span>{TYPE_LABEL[doc.type] || doc.type}</span>
          {format && <span className="uppercase">· {format}</span>}
        </div>

        {/* Badges colorés ligne 1 : montant + date */}
        {(montant != null && montant !== 0) || displayDate ? (
          <div className="flex items-center gap-1 flex-wrap tabular-nums">
            {montant != null && montant !== 0 && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium"
                title="Montant"
              >
                <Euro size={9} />
                {formatCurrency(Math.abs(montant)).replace(/\u00a0€/, '')} €
              </span>
            )}
            {displayDate && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 font-medium"
                title="Date du document"
              >
                <CalendarDays size={9} />
                {formatDateShort(displayDate)}
              </span>
            )}
            {!displayDate && periodLabel && (
              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 font-medium">
                <CalendarDays size={9} />
                {periodLabel}
              </span>
            )}
          </div>
        ) : periodLabel ? (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 font-medium">
              <CalendarDays size={9} />
              {periodLabel}
            </span>
          </div>
        ) : null}

        {/* Badges colorés ligne 2 : catégorie + fournisseur + lock (si associé) */}
        {(doc.categorie || doc.fournisseur || isLocked) && (
          <div className="flex items-center gap-1 flex-wrap">
            {doc.categorie && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium max-w-[120px] truncate"
                title={`Catégorie : ${doc.categorie}${doc.sous_categorie ? ` · ${doc.sous_categorie}` : ''}`}
              >
                <Tag size={9} className="shrink-0" />
                <span className="truncate">{doc.categorie}</span>
              </span>
            )}
            {doc.fournisseur && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-medium max-w-[120px] truncate"
                title={`Fournisseur : ${doc.fournisseur}`}
              >
                <Building2 size={9} className="shrink-0" />
                <span className="truncate">{doc.fournisseur}</span>
              </span>
            )}
            {isLocked && !isJustificatif && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-medium"
                title="Opération verrouillée"
              >
                <Lock size={9} />
                Verrouillé
              </span>
            )}
          </div>
        )}

        {doc.is_reconstitue && (
          <span className="text-sm" title="Fac-similé reconstitué">😈</span>
        )}
      </div>
    </div>
  )
}
