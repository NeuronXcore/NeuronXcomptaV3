/**
 * Résolution de l'année pour une liasse fiscale SCP.
 *
 * Cascade de priorité :
 *   1. gedDoc.year        — si le champ existe et est plausible (2000 ≤ y ≤ now+1)
 *   2. gedDoc.date        — extraction YYYY depuis date_document ou date_operation
 *   3. gedDoc.filename    — regex \b20\d{2}\b, uniquement si UNE seule occurrence non ambiguë
 *   4. fallbackYear       — fiscal store global
 *
 * Pure, testable séparément (pas de dépendance React / Zustand).
 */

export type LiasseYearSource = 'ged_year' | 'ged_date' | 'ged_filename' | 'fiscal_store'

export interface LiasseYearResolution {
  year: number
  source: LiasseYearSource
}

export interface GedDocLike {
  year?: number | null
  date?: string | null
  filename?: string | null
}

export function resolveLiasseYear(
  gedDoc: GedDocLike | null | undefined,
  fallbackYear: number,
): LiasseYearResolution {
  const currentYear = new Date().getFullYear()
  const isPlausible = (y: number) => y >= 2000 && y <= currentYear + 1

  if (gedDoc) {
    // 1) GED year direct
    if (typeof gedDoc.year === 'number' && isPlausible(gedDoc.year)) {
      return { year: gedDoc.year, source: 'ged_year' }
    }
    // 2) GED date (YYYY-...)
    if (gedDoc.date) {
      const match = gedDoc.date.match(/^(\d{4})/)
      if (match) {
        const y = parseInt(match[1], 10)
        if (isPlausible(y)) return { year: y, source: 'ged_date' }
      }
    }
    // 3) GED filename : exactement 1 occurrence YYYY pour lever l'ambiguïté
    if (gedDoc.filename) {
      const matches = gedDoc.filename.match(/\b(20\d{2})\b/g)
      if (matches && matches.length === 1) {
        const y = parseInt(matches[0], 10)
        if (isPlausible(y)) return { year: y, source: 'ged_filename' }
      }
    }
  }

  return { year: fallbackYear, source: 'fiscal_store' }
}
