/**
 * Compteur "X / Y affichées" affiché au-dessus d'une table d'ops quand des filtres locaux sont actifs.
 * Rappelle que les totaux YTD au niveau chapitre/sous-cat ne sont jamais filtrés.
 */
interface Props {
  filtered: number
  total: number
}

export default function LivretFiltersCounter({ filtered, total }: Props) {
  if (filtered === total) return null
  return (
    <div className="text-xs text-text-muted italic mb-2">
      {filtered} / {total} affichées · les totaux ne sont pas filtrés
    </div>
  )
}
