import { Sparkles } from 'lucide-react'

type ForfaitSource = 'blanchissage' | 'repas' | 'vehicule'

interface Props {
  source: ForfaitSource
  onClick?: () => void
  className?: string
}

const LABEL: Record<ForfaitSource, string> = {
  blanchissage: 'Forfait blanchissage',
  repas: 'Forfait repas',
  vehicule: 'Forfait véhicule',
}

/**
 * Badge cliquable pour les opérations OD `source: "blanchissage"` ou
 * `source: "repas"`. Affiché au-dessus de la cellule Catégorie dans
 * EditorPage / JustificatifsPage / AlertesPage.
 * Clic → navigue vers `/charges-forfaitaires?tab={source}` qui ouvre l'onglet
 * adapté du module Charges forfaitaires.
 *
 * Palette cyan pour différencier des autres badges (violet dotation,
 * ambre note_de_frais, indigo immo).
 */
export default function ForfaitBadge({ source, onClick, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      title={`Écriture OD · forfait ${source} (charge déductible 31/12)`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#CFF1F1] text-[#0E5566] border border-[#5BB7B7] dark:bg-[#0E5566]/40 dark:text-[#CFF1F1] dark:border-[#5BB7B7]/60 hover:ring-1 hover:ring-current/30 transition-all ${className}`}
    >
      <Sparkles size={10} />
      {LABEL[source]}
    </button>
  )
}
