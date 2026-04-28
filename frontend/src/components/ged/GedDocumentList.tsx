import { Link as LinkIcon, CheckCircle2, Lock, ArrowUp, ArrowDown, ArrowUpDown, Check } from 'lucide-react'
import { cn, formatCurrency, formatDateShort } from '@/lib/utils'
import type { GedDocument, PosteComptable } from '@/types'

interface GedDocumentListProps {
  documents: GedDocument[]
  postes: PosteComptable[]
  onSelect: (docId: string) => void
  /** Clé de tri courante (ex. "original_name", "date_document", "montant", "categorie", …). */
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  /** Callback quand l'utilisateur clique un header : toggle asc/desc si même clé, sinon change clé et reset en desc. */
  onSortChange?: (sortBy: string, sortOrder: 'asc' | 'desc') => void
  /** Sélection multi-docs pour envoi comptable. */
  sendSelection?: Set<string>
  onToggleSendSelection?: (docId: string) => void
  onToggleAllSendSelection?: () => void
  allVisibleSelected?: boolean
  someVisibleSelected?: boolean
}

interface SortableHeaderProps {
  children: React.ReactNode
  columnKey: string
  currentKey?: string
  currentOrder?: 'asc' | 'desc'
  onSortChange?: (sortBy: string, sortOrder: 'asc' | 'desc') => void
  align?: 'left' | 'right'
  className?: string
}

function SortableHeader({
  children,
  columnKey,
  currentKey,
  currentOrder,
  onSortChange,
  align = 'left',
  className,
}: SortableHeaderProps) {
  const active = currentKey === columnKey
  const Icon = !active ? ArrowUpDown : currentOrder === 'desc' ? ArrowDown : ArrowUp
  const handleClick = () => {
    if (!onSortChange) return
    if (active) {
      onSortChange(columnKey, currentOrder === 'desc' ? 'asc' : 'desc')
    } else {
      onSortChange(columnKey, 'desc')
    }
  }
  return (
    <th
      className={cn(
        'px-3 py-2 font-medium select-none',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      <button
        onClick={handleClick}
        disabled={!onSortChange}
        className={cn(
          'inline-flex items-center gap-1 transition-colors',
          align === 'right' && 'ml-auto',
          active ? 'text-primary' : 'text-text-muted hover:text-text',
          !onSortChange && 'cursor-default',
        )}
      >
        {children}
        <Icon size={11} className={cn(!active && 'opacity-40')} />
      </button>
    </th>
  )
}

const TYPE_LABELS: Record<string, string> = {
  releve: 'Relevé',
  justificatif: 'Justificatif',
  rapport: 'Rapport',
  document_libre: 'Document',
  liasse_fiscale_scp: 'Liasse SCP',
}

const TYPE_COLORS: Record<string, string> = {
  releve: 'bg-blue-500/15 text-blue-400',
  justificatif: 'bg-amber-500/15 text-amber-400',
  rapport: 'bg-emerald-500/15 text-emerald-400',
  document_libre: 'bg-purple-500/15 text-purple-400',
  liasse_fiscale_scp: 'bg-orange-500/15 text-orange-400',
}

export default function GedDocumentList({
  documents,
  postes,
  onSelect,
  sortBy,
  sortOrder,
  onSortChange,
  sendSelection,
  onToggleSendSelection,
  onToggleAllSendSelection,
  allVisibleSelected,
  someVisibleSelected,
}: GedDocumentListProps) {
  const postesMap = Object.fromEntries(postes.map(p => [p.id, p]))
  const showSendCol = !!onToggleSendSelection

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface border-b border-border text-xs">
            {showSendCol && (
              <th className="px-3 py-2 w-10 text-left">
                <button
                  onClick={onToggleAllSendSelection}
                  className={cn(
                    'w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-all duration-150 shrink-0',
                    allVisibleSelected
                      ? 'bg-primary border-transparent shadow-sm'
                      : someVisibleSelected
                        ? 'bg-primary/40 border-transparent shadow-sm'
                        : 'bg-surface border-text-muted/30 hover:border-primary/50',
                  )}
                  title={allVisibleSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                  aria-label="Sélectionner tout"
                >
                  {allVisibleSelected && <Check size={12} className="text-white drop-shadow-sm" strokeWidth={3} />}
                  {!allVisibleSelected && someVisibleSelected && (
                    <span className="block w-2 h-0.5 bg-white rounded" />
                  )}
                </button>
              </th>
            )}
            <SortableHeader columnKey="original_name" currentKey={sortBy} currentOrder={sortOrder} onSortChange={onSortChange}>
              Nom
            </SortableHeader>
            <SortableHeader columnKey="type" currentKey={sortBy} currentOrder={sortOrder} onSortChange={onSortChange} className="w-24">
              Type
            </SortableHeader>
            <SortableHeader columnKey="date_document" currentKey={sortBy} currentOrder={sortOrder} onSortChange={onSortChange} className="w-28">
              Date
            </SortableHeader>
            <SortableHeader columnKey="categorie" currentKey={sortBy} currentOrder={sortOrder} onSortChange={onSortChange} className="w-32">
              Catégorie
            </SortableHeader>
            <SortableHeader columnKey="fournisseur" currentKey={sortBy} currentOrder={sortOrder} onSortChange={onSortChange} className="w-32">
              Fournisseur
            </SortableHeader>
            <SortableHeader columnKey="montant" currentKey={sortBy} currentOrder={sortOrder} onSortChange={onSortChange} align="right" className="w-24">
              Montant
            </SortableHeader>
            <SortableHeader columnKey="statut_justificatif" currentKey={sortBy} currentOrder={sortOrder} onSortChange={onSortChange} className="w-28">
              Statut
            </SortableHeader>
          </tr>
        </thead>
        <tbody>
          {documents.map(doc => {
            const name = doc.original_name || doc.doc_id.split('/').pop() || ''
            const poste = doc.poste_comptable ? postesMap[doc.poste_comptable] : null
            const montant = doc.montant ?? doc.montant_brut
            const isJustificatif = doc.type === 'justificatif'
            const isPending = doc.statut_justificatif === 'en_attente'
            const isAssociated = !isPending && !!doc.operation_ref
            const isLocked = !!doc.op_locked
            const displayDate = doc.date_document || doc.date_operation || doc.added_at

            const isSendSelected = !!sendSelection?.has(doc.doc_id)
            return (
              <tr
                key={doc.doc_id}
                onClick={() => onSelect(doc.doc_id)}
                className={cn(
                  'border-b border-border hover:bg-surface-hover cursor-pointer transition-colors group',
                  isSendSelected && 'bg-primary/5',
                )}
              >
                {showSendCol && (
                  <td
                    className="px-3 py-2 align-middle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => onToggleSendSelection?.(doc.doc_id)}
                      className={cn(
                        'w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-all duration-150 shrink-0',
                        isSendSelected
                          ? 'bg-primary border-transparent shadow-sm opacity-100'
                          : 'bg-surface border-text-muted/30 opacity-40 group-hover:opacity-100 hover:border-primary',
                      )}
                      aria-label={isSendSelected ? 'Retirer de la sélection envoi' : 'Ajouter à la sélection envoi'}
                      title={isSendSelected ? 'Retirer de la sélection envoi' : 'Sélectionner pour l\'envoi comptable'}
                    >
                      {isSendSelected && <Check size={12} className="text-white drop-shadow-sm" strokeWidth={3} />}
                    </button>
                  </td>
                )}
                <td className="px-3 py-2">
                  <p className="text-text truncate max-w-[250px]" title={name}>{name}</p>
                  {poste && (
                    <p
                      className="text-[10px] text-text-muted truncate max-w-[250px]"
                      title={poste.label}
                    >
                      Poste : {poste.label}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${TYPE_COLORS[doc.type] || ''}`}>
                    {TYPE_LABELS[doc.type] || doc.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-text-muted text-xs tabular-nums">
                  {displayDate ? formatDateShort(displayDate) : '-'}
                </td>
                <td className="px-3 py-2">
                  {doc.categorie ? (
                    <span
                      className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary truncate max-w-[120px]"
                      title={`${doc.categorie}${doc.sous_categorie ? ` · ${doc.sous_categorie}` : ''}`}
                    >
                      {doc.categorie}
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted/60">-</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {doc.fournisseur ? (
                    <span
                      className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 truncate max-w-[120px]"
                      title={doc.fournisseur}
                    >
                      {doc.fournisseur}
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted/60">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums">
                  {montant != null ? formatCurrency(Math.abs(montant)) : '-'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    {isJustificatif && isPending && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border bg-[#FAEEDA] text-[#854F0B] border-[#FAC775]"
                        title="Justificatif en attente d'association"
                      >
                        <LinkIcon size={9} />
                        En attente
                      </span>
                    )}
                    {isJustificatif && isAssociated && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border bg-[#FFE6D0] text-[#C2410C] border-[#F59E0B]"
                        title="Justificatif associé à une opération"
                      >
                        <CheckCircle2 size={9} />
                        Associé
                      </span>
                    )}
                    {isLocked && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                          'bg-warning/15 text-warning border border-warning/30',
                        )}
                        title={`Opération verrouillée${doc.op_locked_at ? ` — ${doc.op_locked_at}` : ''}`}
                      >
                        <Lock size={9} />
                        Verrou
                      </span>
                    )}
                    {!isJustificatif && !isLocked && (
                      <span className="text-xs text-text-muted/60">-</span>
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
