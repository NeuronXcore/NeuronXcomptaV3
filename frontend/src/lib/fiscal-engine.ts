import type { SimulationLeviers, SimulationResult, AllBaremes } from '@/types'

const round2 = (x: number) => Math.round(x * 100) / 100

// ─── URSSAF ───

export function estimateURSSAF(bnc: number, bareme: any) {
  const p = bareme?.pass ?? 46368

  // Maladie
  const seuilPlein = p * bareme.maladie.seuil_taux_plein_pct_pass
  let maladie = bnc < seuilPlein
    ? bnc * bareme.maladie.taux_reduit
    : bnc * bareme.maladie.taux_plein
  const seuilAdd = p * bareme.maladie.seuil_additionnelle_pct_pass
  if (bnc > seuilAdd) {
    maladie += (bnc - seuilAdd) * bareme.maladie.contribution_additionnelle
  }

  // Allocations familiales
  const seuilBas = p * bareme.allocations_familiales.seuil_bas_pct_pass
  const seuilHaut = p * bareme.allocations_familiales.seuil_haut_pct_pass
  const tauxAf = bareme.allocations_familiales.taux_plein
  let alloc = 0
  if (bnc > seuilBas) {
    if (bnc >= seuilHaut) {
      alloc = bnc * tauxAf
    } else {
      const ratio = (bnc - seuilBas) / (seuilHaut - seuilBas)
      alloc = bnc * tauxAf * ratio
    }
  }

  // IJ
  const plafondIj = p * bareme.indemnites_journalieres.plafond_pct_pass
  const ij = Math.min(bnc, plafondIj) * bareme.indemnites_journalieres.taux

  // CURPS
  const plafondCurps = p * bareme.curps.plafond_pct_pass
  const curps = Math.min(bnc, plafondCurps) * bareme.curps.taux

  // CSG/CRDS
  const assietteCsg = bnc + maladie + alloc + ij + curps
  const csgDed = assietteCsg * bareme.csg_crds.taux_csg_deductible
  const csgNonDed = assietteCsg * bareme.csg_crds.taux_csg_non_deductible
  const crds = assietteCsg * bareme.csg_crds.taux_crds

  const total = maladie + alloc + csgDed + csgNonDed + crds + ij + curps
  const totalDeductible = maladie + alloc + csgDed + ij + curps

  return {
    maladie: round2(maladie),
    allocations_familiales: round2(alloc),
    csg_deductible: round2(csgDed),
    csg_non_deductible: round2(csgNonDed),
    crds: round2(crds),
    ij: round2(ij),
    curps: round2(curps),
    total: round2(total),
    total_deductible: round2(totalDeductible),
  }
}

// ─── CARMF ───

export function estimateCARMF(bnc: number, bareme: any, classe: string = 'M') {
  const passVal = 46368
  const rb = bareme?.regime_base ?? {}

  const plafondT1 = passVal * (rb.tranche_1_plafond_pct_pass ?? 1.0)
  const tranche1 = Math.min(bnc, plafondT1) * (rb.tranche_1_taux ?? 0.0881)
  const plafondT2 = passVal * (rb.tranche_2_plafond_pct_pass ?? 5.0)
  const tranche2 = Math.max(0, Math.min(bnc, plafondT2) - plafondT1) * (rb.tranche_2_taux ?? 0.0166)
  const regimeBase = tranche1 + tranche2

  const classes = bareme?.complementaire?.classes ?? {}
  const classeDefaut = bareme?.complementaire?.classe_defaut ?? 'M'
  const complementaire = classes[classe] ?? classes[classeDefaut] ?? 2813

  const asvCfg = bareme?.asv ?? {}
  const forfaitaire = asvCfg.part_forfaitaire ?? 5765
  const plafondAsv = passVal * (asvCfg.part_proportionnelle_plafond_pct_pass ?? 5.0)
  const proportionnel = Math.min(bnc, plafondAsv) * (asvCfg.part_proportionnelle_taux ?? 0.04)
  const totalAsv = forfaitaire + proportionnel
  const priseEnCharge = totalAsv * (asvCfg.prise_en_charge_cpam_pct ?? 66.67) / 100
  const asvApresCpam = totalAsv - priseEnCharge

  const invalidite = bareme?.invalidite_deces?.classe_a ?? 631

  const total = regimeBase + complementaire + asvApresCpam + invalidite

  return {
    regime_base: round2(regimeBase),
    complementaire: round2(complementaire),
    asv_apres_cpam: round2(asvApresCpam),
    invalidite_deces: round2(invalidite),
    total: round2(total),
  }
}

// ─── IR ───

export function estimateIR(revenuImposable: number, bareme: any, parts: number = 1) {
  if (revenuImposable <= 0) {
    return {
      ir_net: 0, taux_moyen: 0, taux_marginal: 0,
      tranche_actuelle: { taux: 0, seuil: 0 },
      prochaine_tranche: null as { taux: number; seuil: number; distance: number } | null,
    }
  }

  const tranches: Array<{ seuil: number; taux: number }> = bareme?.tranches ?? []
  const revenuParPart = revenuImposable / parts

  let impotParPart = 0
  let tauxMarginal = 0
  let trancheIdx = 0

  for (let i = 0; i < tranches.length; i++) {
    const seuil = tranches[i].seuil
    const taux = tranches[i].taux
    const seuilSuivant = i + 1 < tranches.length ? tranches[i + 1].seuil : Infinity
    if (revenuParPart > seuil) {
      const montant = Math.min(revenuParPart, seuilSuivant) - seuil
      impotParPart += montant * taux
      tauxMarginal = taux
      trancheIdx = i
    }
  }

  let irBrut = impotParPart * parts

  // Plafonnement quotient familial
  let irApresQf = irBrut
  if (parts > 1) {
    let impot1Part = 0
    for (let i = 0; i < tranches.length; i++) {
      const seuil = tranches[i].seuil
      const taux = tranches[i].taux
      const seuilSuivant = i + 1 < tranches.length ? tranches[i + 1].seuil : Infinity
      if (revenuImposable > seuil) {
        impot1Part += (Math.min(revenuImposable, seuilSuivant) - seuil) * taux
      }
    }
    const plafondQf = bareme?.plafond_quotient_familial ?? 1759
    const avantageMax = (parts - 1) * plafondQf * 2
    const avantageReel = impot1Part - irBrut
    if (avantageReel > avantageMax) {
      irApresQf = impot1Part - avantageMax
    }
  }

  // Décote
  const decoteCfg = bareme?.decote ?? {}
  const seuilDecote = parts <= 1
    ? (decoteCfg.seuil_celibataire ?? 1929)
    : (decoteCfg.seuil_couple ?? 3191)
  const coeffDecote = decoteCfg.coeff ?? 0.4525
  let decote = 0
  if (irApresQf > 0 && irApresQf < seuilDecote) {
    decote = Math.max(0, seuilDecote * coeffDecote - irApresQf * coeffDecote)
  }

  const irNet = Math.max(0, irApresQf - decote)
  const tauxMoyen = revenuImposable > 0 ? irNet / revenuImposable : 0

  const trancheActuelle = tranches[trancheIdx] ?? { taux: 0, seuil: 0 }
  let prochaineTrancheResult: { taux: number; seuil: number; distance: number } | null = null
  if (trancheIdx + 1 < tranches.length) {
    const next = tranches[trancheIdx + 1]
    prochaineTrancheResult = {
      taux: next.taux,
      seuil: next.seuil,
      distance: round2(next.seuil * parts - revenuImposable),
    }
  }

  return {
    ir_net: round2(irNet),
    taux_moyen: Math.round(tauxMoyen * 10000) / 10000,
    taux_marginal: tauxMarginal,
    tranche_actuelle: { taux: trancheActuelle.taux, seuil: trancheActuelle.seuil },
    prochaine_tranche: prochaineTrancheResult,
  }
}

// ─── Taux marginal réel ───

export function calculateTauxMarginalReel(
  bnc: number, baremes: AllBaremes, parts: number
) {
  const u0 = estimateURSSAF(bnc, baremes.urssaf)
  const u1 = estimateURSSAF(bnc + 1, baremes.urssaf)
  const c0 = estimateCARMF(bnc, baremes.carmf)
  const c1 = estimateCARMF(bnc + 1, baremes.carmf)
  const i0 = estimateIR(bnc, baremes.ir, parts)
  const i1 = estimateIR(bnc + 1, baremes.ir, parts)

  return {
    ir: round2(i1.ir_net - i0.ir_net),
    urssaf: round2(u1.total - u0.total),
    carmf: round2(c1.total - c0.total),
    total: round2((u1.total - u0.total) + (c1.total - c0.total) + (i1.ir_net - i0.ir_net)),
  }
}

// ─── Plafonds Madelin / PER ───

export function getMadelinPlafonds(bnc: number, baremeIr: any, passVal: number) {
  const m = baremeIr?.madelin ?? {}
  const prevoyance = Math.min(bnc * (m.prevoyance_pct_bnc ?? 0.07), passVal * (m.prevoyance_plafond_pct_pass ?? 0.03))
  const retraite = Math.min(bnc * (m.retraite_pct_bnc ?? 0.10), passVal * (m.retraite_plafond_pct_pass ?? 0.08))
  const mutuelle = Math.min(bnc * (m.mutuelle_pct_bnc ?? 0.0375), passVal * (m.mutuelle_plafond_pct_pass ?? 0.02))
  return {
    prevoyance: round2(prevoyance),
    retraite: round2(retraite),
    mutuelle: round2(mutuelle),
    total: round2(prevoyance + retraite + mutuelle),
  }
}

export function getPERPlafond(bnc: number, baremeIr: any) {
  const p = baremeIr?.per ?? {}
  const pctBnc = bnc * (p.plafond_pct_bnc ?? 0.10)
  const absolu = p.plafond_absolu ?? 35194
  const plancher = p.plancher ?? 4399
  return round2(Math.max(plancher, Math.min(pctBnc, absolu)))
}

// ─── Simulation complète ───

export function simulateAll(
  bncActuel: number,
  leviers: SimulationLeviers,
  baremes: AllBaremes,
  parts: number,
  dotationsExistantes: number,
  seuil: number = 500,
): SimulationResult {
  // 1. Dotation nouvel investissement
  let dotationInvest: number
  let traitement: 'charge_immediate' | 'immobilisation'
  if (leviers.investissement <= seuil) {
    dotationInvest = leviers.investissement
    traitement = 'charge_immediate'
  } else {
    dotationInvest = round2(
      leviers.investissement / leviers.investissement_duree
      * leviers.investissement_prorata_mois / 12
    )
    traitement = 'immobilisation'
  }

  // 2. BNC social — PER EXCLU
  const totalDepensesDetail = Object.values(leviers.depenses_detail ?? {}).reduce((s, v) => s + v, 0)
  const bncSocial = Math.max(0, bncActuel
    - leviers.madelin
    - dotationsExistantes
    - dotationInvest
    - leviers.formation_dpc
    - leviers.remplacement
    - leviers.depense_pro
    - totalDepensesDetail
  )

  // 3. BNC imposable — PER INCLUS
  const bncImposable = Math.max(0, bncSocial - leviers.per)

  // 4. Charges simulées
  const urssafSim = estimateURSSAF(bncSocial, baremes.urssaf)
  const carmfSim = estimateCARMF(bncSocial, baremes.carmf, leviers.carmf_classe)
  const odm = baremes.odm?.cotisation_annuelle ?? 780
  const irSim = estimateIR(bncImposable, baremes.ir, parts)

  // 5. Charges actuelles
  const urssafAct = estimateURSSAF(bncActuel, baremes.urssaf)
  const carmfAct = estimateCARMF(bncActuel, baremes.carmf, 'M')
  const irAct = estimateIR(bncActuel, baremes.ir, parts)

  // 6. Totaux
  const totalAct = urssafAct.total + carmfAct.total + odm + irAct.ir_net
  const totalSim = urssafSim.total + carmfSim.total + odm + irSim.ir_net

  const revenuNetAct = bncActuel - totalAct
  const revenuNetSim = bncSocial - totalSim

  const ecoCharges = totalAct - totalSim
  const coutReelInvest = leviers.investissement > 0
    ? leviers.investissement - ecoCharges
    : 0

  return {
    bnc_actuel: bncActuel,
    bnc_social: round2(bncSocial),
    bnc_imposable: round2(bncImposable),
    dotations_existantes: dotationsExistantes,
    dotation_nouvel_invest: dotationInvest,
    investissement_traitement: traitement,
    urssaf_actuel: urssafAct.total,
    urssaf_simule: urssafSim.total,
    urssaf_delta: round2(urssafSim.total - urssafAct.total),
    carmf_actuel: carmfAct.total,
    carmf_simule: carmfSim.total,
    carmf_delta: round2(carmfSim.total - carmfAct.total),
    odm,
    ir_actuel: irAct.ir_net,
    ir_simule: irSim.ir_net,
    ir_delta: round2(irSim.ir_net - irAct.ir_net),
    total_actuel: round2(totalAct),
    total_simule: round2(totalSim),
    total_delta: round2(totalSim - totalAct),
    revenu_net_actuel: round2(revenuNetAct),
    revenu_net_simule: round2(revenuNetSim),
    revenu_net_delta: round2(revenuNetSim - revenuNetAct),
    invest_montant: leviers.investissement,
    invest_deduction_an1: dotationInvest,
    invest_cout_reel_an1: round2(Math.max(0, coutReelInvest)),
  }
}
