import type { LigneAmortissement } from '@/types'

const COEFFICIENTS_DEGRESSIF: Record<number, number> = {
  3: 1.25, 4: 1.25, 5: 1.75, 6: 1.75,
  7: 2.25, 8: 2.25, 9: 2.25, 10: 2.25,
}

const r2 = (x: number) => Math.round(x * 100) / 100

export interface CalcAmortissementParams {
  valeur_origine: number
  duree: number
  methode: 'lineaire' | 'degressif'
  date_mise_en_service: string  // YYYY-MM-DD
  quote_part_pro: number        // 0-100
  plafond_fiscal?: number | null
}

export function calcTableauAmortissement(params: CalcAmortissementParams): LigneAmortissement[] {
  const { valeur_origine, duree, methode, date_mise_en_service, quote_part_pro, plafond_fiscal } = params
  if (!date_mise_en_service || valeur_origine <= 0 || duree <= 0) return []

  const base = plafond_fiscal ? Math.min(valeur_origine, plafond_fiscal) : valeur_origine
  const parts = date_mise_en_service.split('-')
  if (parts.length !== 3) return []
  const yearStart = parseInt(parts[0])
  const monthStart = parseInt(parts[1])
  const dayStart = parseInt(parts[2])

  if (methode === 'degressif') {
    return calcDegressif(base, duree, yearStart, monthStart, quote_part_pro)
  }
  return calcLineaire(base, duree, yearStart, monthStart, dayStart, quote_part_pro)
}

function calcLineaire(base: number, duree: number, yearStart: number, month: number, day: number, qp: number): LigneAmortissement[] {
  const annuite = base / duree
  const tableau: LigneAmortissement[] = []
  let cumul = 0

  for (let i = 0; i <= duree; i++) {
    const exercice = yearStart + i
    let jours: number
    let dotation: number

    if (i === 0) {
      // Pro rata year 1
      const daysInYear = 360
      const dayOfYear = (month - 1) * 30 + Math.min(day, 30)
      jours = Math.min(daysInYear - dayOfYear + 1, 360)
      dotation = r2(annuite * jours / 360)
    } else {
      jours = 360
      dotation = r2(annuite)
    }

    const remaining = r2(base - cumul)
    if (dotation > remaining) dotation = remaining
    if (dotation <= 0) break

    cumul = r2(cumul + dotation)
    const vnc = r2(base - cumul)

    tableau.push({
      exercice,
      jours,
      base_amortissable: base,
      dotation_brute: dotation,
      quote_part_pro: qp,
      dotation_deductible: r2(dotation * qp / 100),
      amortissements_cumules: cumul,
      vnc: Math.max(vnc, 0),
    })

    if (vnc <= 0) break
  }

  return tableau
}

function calcDegressif(base: number, duree: number, yearStart: number, monthStart: number, qp: number): LigneAmortissement[] {
  const coeff = COEFFICIENTS_DEGRESSIF[duree] ?? 2.25
  const taux = (1 / duree) * coeff
  const tableau: LigneAmortissement[] = []
  let vnc = base
  let cumul = 0

  for (let i = 0; i <= duree; i++) {
    const exercice = yearStart + i
    if (vnc <= 0) break

    const nbAnneesRestantes = duree - i
    if (nbAnneesRestantes <= 0) break

    const dotDegressive = r2(vnc * taux)
    const dotLineaire = r2(vnc / nbAnneesRestantes)
    let dotation = Math.max(dotDegressive, dotLineaire)

    let jours: number
    if (i === 0) {
      const moisRestants = 12 - monthStart + 1
      dotation = r2(dotation * moisRestants / 12)
      jours = moisRestants * 30
    } else {
      jours = 360
    }

    if (dotation > vnc) dotation = r2(vnc)

    cumul = r2(cumul + dotation)
    vnc = r2(base - cumul)

    tableau.push({
      exercice,
      jours,
      base_amortissable: base,
      dotation_brute: dotation,
      quote_part_pro: qp,
      dotation_deductible: r2(dotation * qp / 100),
      amortissements_cumules: cumul,
      vnc: Math.max(vnc, 0),
    })

    if (vnc <= 0) break
  }

  return tableau
}

export function isImmobilisable(montant: number, seuil: number): boolean {
  return montant > seuil
}
