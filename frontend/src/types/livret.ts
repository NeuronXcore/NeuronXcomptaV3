/**
 * Types Livret comptable vivant — Phase 1.
 * Miroir des modèles Pydantic dans backend/models/livret.py
 */

export type LivretMetricUnit = 'EUR' | 'PCT' | 'COUNT'

// ─── Phase 5 — Graphiques (ChartConfig partagé HTML/PDF/React) ────

export type ChartType = 'bar' | 'donut' | 'waterfall' | 'stacked' | 'cadence'

export interface ChartPoint {
  x: string | number
  y: number
  color?: string | null
  meta?: Record<string, unknown> | null
}

export interface ChartSeries {
  name: string
  color: string
  data: ChartPoint[]
  stack_id?: string | null
}

export interface ChartConfig {
  id: string
  type: ChartType
  title: string
  subtitle?: string | null
  x_label?: string | null
  y_label?: string | null
  series: ChartSeries[]
  total?: number | null
  annotations?: Array<Record<string, unknown>> | null
  drill_target?: string | null
}

// ─── Phase 4 — Comparaison N-1 ────────────────────────────────

export type CompareMode = 'ytd_comparable' | 'annee_pleine'
export type CompareUiMode = 'none' | CompareMode

export type LivretDeltaDirection = 'up' | 'down' | 'stable'

export interface LivretDelta {
  value_n1: number
  value_diff: number
  value_diff_pct: number | null
  direction: LivretDeltaDirection
  is_favorable: boolean
}

export interface LivretMetric {
  label: string
  value: number
  unit: LivretMetricUnit
  is_projection: boolean
  delta_n1?: LivretDelta | null
}

export interface LivretMonthPoint {
  month: number // 1..12
  label: string // "jan", "fév", ...
  recettes: number
  charges: number
  is_past: boolean
  is_current: boolean
  is_projection: boolean
  recettes_n1?: number | null
  charges_n1?: number | null
}

export interface LivretSyntheseChapter {
  metrics: LivretMetric[]
  cadence_mensuelle: LivretMonthPoint[]
}

export interface LivretFlag {
  a_revoir: boolean
  important: boolean
  justificatif_manquant: boolean
  locked: boolean
  lettre: boolean
  is_mixte: boolean
}

export interface LivretOperation {
  operation_file: string
  operation_index: number
  ventilation_index: number | null
  date: string // ISO YYYY-MM-DD
  libelle: string
  libelle_meta: string | null
  montant: number
  montant_brut: number | null
  taux_pro: number | null
  flags: LivretFlag
  sub_lines: LivretOperation[] | null
}

export interface LivretSubcategory {
  name: string
  total_ytd: number
  total_projected_annual: number | null
  nb_operations: number
  nb_a_revoir: number
  nb_justif_manquant: number
  nb_mixte: number
  operations: LivretOperation[]
  delta_n1?: LivretDelta | null
  is_orphan_from_n1?: boolean
}

export type LivretVentilationMode = 'eclate' | 'groupe' | 'none'

export interface LivretChapter {
  number: string // "01", "02", "03"
  title: string
  tag: string | null
  ventilation_mode: LivretVentilationMode
  total_ytd: number
  total_projected_annual: number | null
  subcategories: LivretSubcategory[]
  delta_n1?: LivretDelta | null
  // Phase 5 — graphiques attachés au chapitre
  charts?: ChartConfig[]
}

export interface LivretSynthese extends LivretChapter {
  synthese: LivretSyntheseChapter
}

// ─── Phase 2 — chapitres spécialisés ─────────────────────────────

export interface LivretBncFormulaLine {
  label: string
  amount: number
  operator: 'plus' | 'minus' | 'equals'
  note: string | null
}

export interface LivretBncProjection {
  bnc_projete_annuel: number
  ir_estime: number
  urssaf_estime: number
  carmf_estime: number
  odm_estime: number
  total_charges_sociales_estime: number
  revenu_net_apres_charges: number
}

export interface LivretBncChapter extends LivretChapter {
  formula: LivretBncFormulaLine[]
  formula_comment: string
  projection: LivretBncProjection
  sources: Record<string, string>
}

export interface LivretAmortissementImmo {
  nom: string
  poste: string
  valeur_origine: number
  date_acquisition: string
  duree_amortissement: number
  dotation_annuelle: number
  cumul_amortissement: number
  vnc: number
  is_backfill: boolean
}

export interface LivretAmortissementsChapter extends LivretChapter {
  immobilisations: LivretAmortissementImmo[]
  total_dotations_annuelles: number
}

export interface LivretAnnexeBareme {
  nom: string
  file: string
  last_updated: string | null
  summary: Record<string, unknown>
}

export interface LivretAnnexeJustifEntry {
  filename: string
  montant: number | null
  date: string | null
  fournisseur: string | null
  operation_file: string | null
  operation_index: number | null
  libelle_op: string | null
  is_facsimile: boolean
}

export interface LivretAnnexeChapter extends LivretChapter {
  justificatifs_index: LivretAnnexeJustifEntry[]
  baremes_appliques: LivretAnnexeBareme[]
  glossaire: Array<{ term: string; definition: string }>
  methodologie: string
}

export interface LivretProvisionGauge {
  name: string
  cumul_ytd: number
  cible_estimee: number
  ratio: number
}

export interface LivretProvisionsChapter extends LivretChapter {
  gauges: LivretProvisionGauge[]
}

export type LivretForfaitType = 'blanchissage' | 'repas' | 'vehicule'

export interface LivretForfaitDecomposition {
  type_forfait: LivretForfaitType
  montant: number
  date_ecriture: string | null
  pdf_filename: string | null
  ged_doc_id: string | null
  jours: number | null
  articles: Array<Record<string, unknown>> | null
  forfait_jour: number | null
  seuil_repas_maison: number | null
  plafond_repas_restaurant: number | null
  ratio_pro_pct: number | null
  distance_km: number | null
  km_supplementaires: number | null
  km_totaux_compteur: number | null
  reference_legale: string | null
}

export interface LivretForfaitairesChapter extends LivretChapter {
  decompositions: LivretForfaitDecomposition[]
}

export interface LivretMetadata {
  year: number
  generated_at: string // ISO datetime
  as_of_date: string // ISO YYYY-MM-DD
  months_elapsed: number
  months_remaining: number
  is_live: boolean
  snapshot_id: string | null
  data_sources: Record<string, boolean>
  // Phase 4 — comparaison N-1
  compare_mode?: CompareMode | null
  as_of_date_n1?: string | null
  has_n1_data?: boolean
  is_year_partial?: boolean
}

export interface TocEntry {
  number: string
  title: string
}

export interface Livret {
  metadata: LivretMetadata
  chapters: Record<string, LivretChapter | LivretSynthese>
  toc: TocEntry[]
}

// ─── Projection ────────────────────────────────────────────────

export type ProjectionSource = 'previsionnel' | 'fallback_ytd_extrapolation' | 'empty'
export type ProjectionConfidence = 'high' | 'medium' | 'low'

export interface ProjectionResult {
  year: number
  as_of_date: string
  monthly_recettes: Record<number, number>
  monthly_charges: Record<number, number>
  annual_recettes_projected: number
  annual_charges_projected: number
  bnc_projected_annual: number
  source: ProjectionSource
  confidence: ProjectionConfidence
}

// ─── Filtres locaux UI ─────────────────────────────────────────

export type LivretFilterKey =
  | 'a_revoir'
  | 'justif_manquant'
  | 'mixte'
  | 'locked'

export type LivretActiveFilters = Set<LivretFilterKey>

// ─── Phase 3 — Snapshots ───────────────────────────────────────

export type SnapshotType = 'auto_monthly' | 'cloture' | 'manual'
export type SnapshotTrigger = 'scheduler' | 'cloture_hook' | 'manual_user'

export interface LivretSnapshotMetadata {
  id: string
  year: number
  snapshot_date: string
  type: SnapshotType
  trigger: SnapshotTrigger
  as_of_date: string
  html_filename: string
  pdf_filename: string
  html_size: number
  pdf_size: number
  comment: string | null
  data_sources: Record<string, boolean>
  ytd_metrics: Record<string, number>
  created_at: string
  ged_document_ids: { html: string | null; pdf: string | null }
  large: boolean
  comparison_mode?: CompareMode | null
}

export interface CreateSnapshotRequest {
  snapshot_type?: SnapshotType
  as_of_date?: string | null
  comment?: string | null
  include_comparison?: CompareMode | null
}

export interface SnapshotsListResponse {
  snapshots: LivretSnapshotMetadata[]
}
