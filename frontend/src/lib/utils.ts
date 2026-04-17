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

/**
 * Convertit "2025-03-07" → "07/03/25" (6 chars, compact pour overlay badge).
 * Retourne la chaîne d'origine si le format n'est pas reconnu.
 */
export function formatDateShort(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return dateStr
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`
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

/**
 * Normalise le nom fournisseur pour le filename canonique.
 *
 * DOIT être strictement équivalent à `backend/services/naming_service.py:normalize_supplier`.
 * - lowercase
 * - supprime accents (NFD + strip combining)
 * - remplace espaces/points/tirets multiples par un seul tiret
 * - supprime caractères non-alphanumériques (sauf tiret)
 * - strip tirets début/fin
 * - max 30 caractères
 * - fallback "inconnu" si vide
 */
export function normalizeSupplier(raw: string): string {
  let s = raw.toLowerCase().trim()
  // NFD + strip combining marks (accents)
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // spaces/dots/dashes/underscores → single dash
  s = s.replace(/[\s._\-]+/g, '-')
  // keep alphanum + dash only
  s = s.replace(/[^a-z0-9-]/g, '')
  // strip dashes at edges
  s = s.replace(/^-+|-+$/g, '')
  return s.slice(0, 30) || 'inconnu'
}

/**
 * Construit le nom canonique `fournisseur_YYYYMMDD_montant.XX.pdf` selon la convention.
 *
 * Miroir de `backend/services/naming_service.py:build_convention_filename`.
 * Retourne null si date ou montant manquants.
 */
export function buildConventionFilename(
  supplier: string | null | undefined,
  dateStr: string | null | undefined, // format "YYYY-MM-DD"
  amount: number | null | undefined,
): string | null {
  if (!dateStr || amount == null) return null
  const cleanSupplier = normalizeSupplier(supplier || 'inconnu')
  const dateCompact = dateStr.replace(/-/g, '') // "20250409"
  const amountStr = Math.abs(amount).toFixed(2)
  return `${cleanSupplier}_${dateCompact}_${amountStr}.pdf`
}

// Miroir de `backend/services/rename_service.CANONICAL_RE`
// Suffixes autorisés : _fs, _a..aaa, _2..99
const CANONICAL_RE = /^[a-z0-9][a-z0-9\-]*_\d{8}_\d+\.\d{2}(?:_(?:[a-z]{1,3}|\d{1,2}))*\.pdf$/
// Miroir de `backend/services/rename_service.LEGACY_CANONICAL_RE` — ancienne
// regex permissive (accepte n'importe quel `_[a-z0-9]+`, y compris les
// timestamps du sandbox)
const LEGACY_CANONICAL_RE = /^[a-z0-9][a-z0-9\-]*_\d{8}_\d+\.\d{2}(_[a-z0-9]+)*\.pdf$/

export function isCanonicalFilename(name: string): boolean {
  return CANONICAL_RE.test(name)
}

/** True si le nom matche l'ancienne regex permissive mais plus la nouvelle.
 * Indique un fichier dont le filename contient un suffix timestamp sandbox
 * (`_20260417_104502`) et doit être proposé au rename. */
export function isLegacyPseudoCanonical(name: string): boolean {
  if (CANONICAL_RE.test(name)) return false
  return LEGACY_CANONICAL_RE.test(name)
}
