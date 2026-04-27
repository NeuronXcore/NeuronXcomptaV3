import { Package } from 'lucide-react'

interface Props {
  immobilisationId: string
  /**
   * `true` quand l'`immobilisation_id` n'existe plus dans le registre (immo supprimée).
   * Affiche un style ambre `Immo ?` cliquable pour régulariser.
   */
  orphan?: boolean
  onClick?: () => void
  className?: string
}

/**
 * Badge cliquable affiché au-dessus de la cellule Catégorie dans EditorPage,
 * JustificatifsPage, AlertesPage pour les ops avec `op.immobilisation_id`.
 * Clic → ouvre `ImmobilisationDrawer` global (mode lecture) via store Zustand.
 */
export default function ImmoBadge({ immobilisationId: _immobilisationId, orphan, onClick, className = '' }: Props) {
  const tooltip = orphan
    ? 'Immobilisation introuvable — cliquez pour régulariser'
    : 'Immobilisation — voir la fiche'

  const style = orphan
    ? 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700'
    : 'bg-[#EEEDFE] text-[#3C3489] border border-[#CECBF6] dark:bg-[#3C3489]/30 dark:text-[#CECBF6] dark:border-[#3C3489]'

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      title={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium hover:ring-1 hover:ring-current/30 transition-all ${style} ${className}`}
    >
      <Package size={10} />
      {orphan ? 'Immo ?' : 'Immo'}
    </button>
  )
}
