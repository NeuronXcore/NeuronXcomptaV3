import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(value)
}

export function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date)
  } catch {
    return dateStr
  }
}

export const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

/**
 * Détecte un justificatif fac-similé reconstitué.
 *
 * Supporte :
 * - Nouveau format : suffix `_fs` avant `.pdf` (ex: `auchan_20250315_87.81_fs.pdf`),
 *   éventuellement suivi d'une marque de dédup (`_fs_2.pdf`)
 * - Legacy : préfixe `reconstitue_` (pendant la période de migration)
 */
export function isReconstitue(lienJustificatif: string): boolean {
  if (!lienJustificatif) return false
  const basename = lienJustificatif.split('/').pop() || ''
  if (basename.startsWith('reconstitue_')) return true
  return /_fs(_\d+)?\.pdf$/i.test(basename)
}

export function formatFileTitle(file: { filename: string; month?: number; year?: number; count: number }): string {
  if (file.month && file.year) {
    const mois = MOIS_FR[file.month - 1] || `Mois ${file.month}`
    return `Relevé ${mois} ${file.year}`
  }
  // Fallback : nom de fichier nettoyé
  return file.filename.replace(/\.json$/, '').replace(/_/g, ' ')
}
