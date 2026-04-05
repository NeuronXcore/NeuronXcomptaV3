import { cn } from '@/lib/utils'

const STATUT_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  verifie: { label: 'Vérifié', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  recu: { label: 'Reçu', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  attendu: { label: 'Attendu', bg: 'bg-gray-500/15', text: 'text-gray-400' },
  en_retard: { label: 'En retard', bg: 'bg-red-500/15', text: 'text-red-400' },
  ecart: { label: 'Écart', bg: 'bg-amber-500/15', text: 'text-amber-400' },
  non_applicable: { label: 'N/A', bg: 'bg-gray-500/10', text: 'text-gray-500' },
  non_preleve: { label: 'Non prélevé', bg: 'bg-red-500/15', text: 'text-red-400' },
  manuel: { label: 'Manuel', bg: 'bg-blue-500/15', text: 'text-blue-400' },
  estime: { label: 'Estimé', bg: 'bg-gray-500/10', text: 'text-gray-400' },
  realise: { label: 'Réalisé', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  projete: { label: 'Projeté', bg: 'bg-blue-500/15', text: 'text-blue-400' },
}

export default function StatusBadge({ statut, size = 'sm' }: { statut: string; size?: 'sm' | 'md' }) {
  const config = STATUT_CONFIG[statut] || { label: statut, bg: 'bg-gray-500/10', text: 'text-gray-400' }
  return (
    <span className={cn(
      'inline-flex items-center rounded-full font-medium',
      config.bg, config.text,
      size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]',
    )}>
      {config.label}
    </span>
  )
}
