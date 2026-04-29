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

/**
 * Filtre `Type d'opération` étendu (Prompt B2 + forfaits). Helper partagé par
 * EditorPage, JustificatifsPage, AlertesPage, RepartitionParTypeCard.
 * Note : `bancaire` exclut explicitement les ops avec `immobilisation_id`
 * (qui sont déjà dans la catégorie `Immobilisations`) et `source` non-vide
 * (donc tous les forfaits + note_de_frais + dotation passent à travers).
 */
export type OperationTypeFilter =
  | 'all'
  | 'bancaire'
  | 'note_de_frais'
  | 'immobilisation'
  | 'dotation'
  | 'forfait'

export function matchesOperationType(
  op: { source?: string; immobilisation_id?: string },
  type: OperationTypeFilter,
): boolean {
  switch (type) {
    case 'all': return true
    case 'bancaire': return !op.source && !op.immobilisation_id
    case 'note_de_frais': return op.source === 'note_de_frais'
    case 'immobilisation': return !!op.immobilisation_id
    case 'dotation': return op.source === 'amortissement'
    case 'forfait':
      return op.source === 'blanchissage' || op.source === 'repas' || op.source === 'vehicule'
    default: return true
  }
}

// Jours de la semaine en français — index 0 = dimanche (cohérent avec Date.getDay()).
export const joursFr = [
  'dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi',
] as const

/**
 * Salutation contextuelle selon l'heure :
 * - 0h-5h → "Bonne nuit"
 * - 5h-12h → "Bonjour"
 * - 12h-18h → "Bon après-midi"
 * - 18h-24h → "Bonsoir"
 */
export function getGreeting(date: Date = new Date()): string {
  const h = date.getHours()
  if (h < 5) return 'Bonne nuit'
  if (h < 12) return 'Bonjour'
  if (h < 18) return 'Bon après-midi'
  return 'Bonsoir'
}

/**
 * Date longue en français : "mardi 28 avril 2026".
 */
export function formatDateLong(date: Date = new Date()): string {
  const d = date.getDay()
  const j = date.getDate()
  const m = date.getMonth()
  const y = date.getFullYear()
  return `${joursFr[d]} ${j} ${MOIS_FR[m].toLowerCase()} ${y}`
}
