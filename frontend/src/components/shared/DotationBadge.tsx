import { TrendingDown } from 'lucide-react'

interface Props {
  year: number
  onClick?: () => void
  className?: string
}

/**
 * Badge cliquable pour les opérations OD `source: "amortissement"`. Affiché
 * au-dessus de la cellule Catégorie dans EditorPage / JustificatifsPage /
 * AlertesPage. Clic → navigue vers `/compta-analytique?year=X&category=Dotations+aux+amortissements`
 * qui auto-ouvre le `DotationsVirtualDrawer`.
 */
export default function DotationBadge({ year, onClick, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      title={`Écriture OD · exercice ${year}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#CECBF6] text-[#26215C] border border-[#7F77DD] dark:bg-[#26215C]/40 dark:text-[#CECBF6] dark:border-[#3C3489] hover:ring-1 hover:ring-current/30 transition-all ${className}`}
    >
      <TrendingDown size={10} />
      Dotation
    </button>
  )
}
