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
 * Génère un titre lisible pour un fichier d'opérations.
 * Ex: "Relevé Septembre 2024" au lieu de "operations_20250520_094452_d9faa5a9.json"
 */
export function formatFileTitle(file: { filename: string; month?: number; year?: number; count: number }): string {
  if (file.month && file.year) {
    const mois = MOIS_FR[file.month - 1] || `Mois ${file.month}`
    return `Relevé ${mois} ${file.year}`
  }
  // Fallback : nom de fichier nettoyé
  return file.filename.replace(/\.json$/, '').replace(/_/g, ' ')
}
