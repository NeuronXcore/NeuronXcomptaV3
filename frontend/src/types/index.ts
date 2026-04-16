export type AlerteType =
  | 'justificatif_manquant'
  | 'a_categoriser'
  | 'montant_a_verifier'
  | 'doublon_suspect'
  | 'confiance_faible'

export interface AlerteSummary {
  total_en_attente: number
  par_type: Record<AlerteType, number>
  par_fichier: { filename: string; nb_alertes: number; nb_operations: number; month?: number; year?: number }[]
}

export interface AlerteExportResponse {
  filename: string
  nb_operations: number
  total_debit: number
  total_credit: number
}

export interface VentilationLine {
  index: number
  montant: number
  categorie: string
  sous_categorie: string
  libelle: string
  justificatif: string | null
  lettre: boolean
}

export interface Operation {
  Date: string
  'Libellé': string
  'Débit': number
  'Crédit': number
  'Catégorie'?: string
  'Sous-catégorie'?: string
  Justificatif?: boolean
  'Lien justificatif'?: string
  Important?: boolean
  A_revoir?: boolean
  lettre?: boolean
  locked?: boolean
  locked_at?: string
  Commentaire?: string
  participants?: string
  rapprochement_score?: number
  rapprochement_mode?: 'auto' | 'manuel' | null
  rapprochement_date?: string
  alertes?: AlerteType[]
  alertes_resolues?: AlerteType[]
  compte_attente?: boolean
  alerte_note?: string
  _index?: number
  _sourceFile?: string
  source?: string // "note_de_frais" | "blanchissage" | "amortissement"
  immobilisation_id?: string
  immobilisation_candidate?: boolean
  immobilisation_ignored?: boolean
  ventilation?: VentilationLine[]
  csg_non_deductible?: number
}

export interface OperationFile {
  filename: string
  count: number
  total_debit: number
  total_credit: number
  month?: number
  year?: number
}

export interface CategoryGroup {
  name: string
  color: string
  subcategories: { name: string; color: string }[]
}

export interface CategoryRaw {
  'Catégorie': string
  'Sous-catégorie'?: string
  Couleur: string
}

export interface DashboardData {
  total_debit: number
  total_credit: number
  solde: number
  nb_operations: number
  category_summary: CategorySummary[]
  recent_operations: Operation[]
  monthly_evolution: MonthlyEvolution[]
  by_source?: SourceBreakdown[]
}

export interface SourceBreakdown {
  source: string  // "bancaire" | "note_de_frais"
  debit: number
  credit: number
  count: number
}

export interface CategorySummary {
  'Catégorie': string
  'Crédit': number
  'Débit': number
  Montant_Net: number
  Nombre_Opérations: number
  Pourcentage_Dépenses: number
}

export interface MonthlyEvolution {
  Mois: string
  'Crédit': number
  'Débit': number
  Solde: number
  Solde_Cumule: number
}

export interface LearningCurve {
  dates: string[]
  acc_train: number[]
  acc_test: number[]
  f1: number[]
  precision: number[]
  recall: number[]
  n_samples: number[]
  n_classes: number[]
  nb_regles: number[]
  labels: string[]
}

export interface MLModelInfo {
  exact_matches_count: number
  keywords_count: number
  subcategories_count: number
  stats: {
    operations_processed: number
    success_rate: number
    last_training: string
    learning_curve?: LearningCurve
  }
}

export interface MLModelFull {
  exact_matches: Record<string, string>
  keywords: Record<string, string>
  subcategories: Record<string, string>
  stats: {
    operations_processed: number
    success_rate: number
    last_training: string
    learning_curve?: LearningCurve
  }
}

export interface PredictionResult {
  libelle_clean: string
  rules_prediction: string | null
  rules_subcategory: string | null
  sklearn_prediction: string | null
  confidence: number
  hallucination_risk: boolean
  best_prediction: string | null
}

export interface ImportTrainingResult {
  success: boolean
  files_read: number
  ops_scanned: number
  ops_skipped: number
  vent_sublines: number
  examples_submitted: number
  examples_added: number
  rules_updated: number
  total_training_data: number
  year_filter: number | null
}

export interface TrainResult {
  success: boolean
  metrics: {
    acc_train: number
    acc_test: number
    f1: number
    precision: number
    recall: number
    confusion_matrix: number[][]
    n_samples?: number
    n_classes?: number
    labels?: string[]
  }
}

export interface TrainAndApplyResult {
  success: boolean
  train_metrics: {
    acc_train: number
    acc_test: number
    f1: number
    precision: number
    recall: number
    n_samples: number
    n_classes: number
  }
  apply_results: {
    files_processed: number
    total_operations: number
    total_modified: number
    year: number | null
  }
}

export interface MLMonitoringStats {
  coverage_rate: number
  avg_confidence: number
  confidence_distribution: { high: number; medium: number; low: number }
  correction_rate: number
  hallucination_rate: number
  top_errors: Array<{ libelle: string; predicted: string; corrected: string; count: number }>
  training_history: Array<{
    timestamp: string
    examples_count: number
    accuracy: number | null
    rules_count: number
    keywords_count: number
  }>
  correction_rate_history: Array<{ month: string; rate: number }>
  knowledge_base: { rules: number; keywords: number; examples: number }
  confusion_pairs: Array<{ from: string; to: string; count: number }>
  orphan_categories: Array<{ category: string; examples_count: number }>
  unknown_libelles_count: number
}

export interface MLHealthKPI {
  coverage_rate: number
  correction_rate: number
  correction_trend: 'improving' | 'stable' | 'degrading'
  hallucination_rate: number
  last_training: string | null
  alert: string | null
}

export interface TrainingExample {
  libelle: string
  categorie: string
  sous_categorie?: string
  date?: string
}

export interface TrendRecord {
  Mois: string
  'Catégorie': string
  'Crédit': number
  'Débit': number
}

export interface AnomalyRecord {
  Date: string
  'Libellé': string
  'Débit': number
  'Catégorie': string
  Moyenne: number
  'Écart_Type': number
  Pourcentage_Sup_Moyenne: number
}

export interface QueryFilters {
  categories: string[]
  date_from?: string
  date_to?: string
  min_amount?: number
  max_amount?: number
  type: 'debit' | 'credit' | 'both'
  grouping: 'month' | 'quarter' | 'category' | 'month_category'
}

export interface QueryPreset {
  id: string
  name: string
  filters: QueryFilters
  predefined?: boolean
  created_at?: string
}

export interface QueryResultRow {
  label: string
  category?: string
  debit: number
  credit: number
  net: number
  count: number
}

export interface QueryResult {
  total_debit: number
  total_credit: number
  total_net: number
  total_ops: number
  rows: QueryResultRow[]
}

export interface JustificatifExemptions {
  categories: string[]
  sous_categories: Record<string, string[]>
}

export interface AppSettings {
  theme_settings: {
    primary_color: string
    background_color: string
    text_color: string
  }
  dark_mode: boolean
  notifications: boolean
  num_operations: number
  export_format: string
  include_graphs: boolean
  compress_exports: boolean
  auto_pointage: boolean
  justificatif_exemptions?: JustificatifExemptions
  // Email comptable
  email_smtp_user?: string | null
  email_smtp_app_password?: string | null
  email_comptable_destinataires?: string[]
  email_default_nom?: string | null
  // ML retrain — seuils déclenchement tâche auto "Réentraîner le modèle IA"
  ml_retrain_corrections_threshold?: number
  ml_retrain_days_threshold?: number
}

// === Email / Envoi Comptable ===

export type DocumentType = 'export' | 'rapport' | 'releve' | 'justificatif' | 'ged'

export interface DocumentRef {
  type: DocumentType
  filename: string
}

export interface DocumentInfo {
  type: DocumentType
  filename: string
  display_name: string
  size_bytes: number
  date?: string
  category?: string
}

export interface EmailSendRequest {
  documents: DocumentRef[]
  destinataires: string[]
  objet?: string
  corps?: string
}

export interface EmailSendResponse {
  success: boolean
  message: string
  destinataires: string[]
  fichiers_envoyes: string[]
  taille_totale_mo: number
}

export interface EmailTestResponse {
  success: boolean
  message: string
}

export interface EmailPreview {
  destinataires: string[]
  objet: string
  corps: string
  corps_html?: string
}

export interface EmailHistoryEntry {
  id: string
  sent_at: string
  destinataires: string[]
  objet: string
  documents: DocumentRef[]
  nb_documents: number
  taille_totale_mo: number
  success: boolean
  error_message?: string
}

export interface OCRSummary {
  best_date?: string
  best_amount?: number
  supplier?: string
  processed: boolean
}

export interface OCRExtractedData {
  dates: string[]
  amounts: number[]
  supplier?: string
  best_date?: string
  best_amount?: number
}

export interface OCRFilenameParsed {
  supplier?: string | null
  date?: string | null
  amount?: number | null
}

export interface OCRResult {
  filename: string
  processed_at: string
  status: string
  processing_time_ms: number
  raw_text: string
  extracted_data: OCRExtractedData
  page_count: number
  confidence: number
  manual_edit?: boolean
  manual_edit_at?: string
  filename_parsed?: OCRFilenameParsed | null
  original_filename?: string
}

export interface OcrManualEdit {
  best_amount?: number | null
  best_date?: string | null
  supplier?: string | null
}

export interface OCRStatus {
  reader_loaded: boolean
  easyocr_available: boolean
  poppler_available: boolean
  total_extractions: number
}

export interface OCRHistoryItem {
  filename: string
  processed_at: string
  status: string
  processing_time_ms: number
  dates_found: string[]
  amounts_found: number[]
  supplier?: string
  confidence: number
  best_date?: string | null
  best_amount?: number | null
  auto_renamed?: boolean
  original_filename?: string | null
  // Hints comptables stockés au top-level du .ocr.json — éditables via OcrEditDrawer
  category_hint?: string | null
  sous_categorie_hint?: string | null
}

export interface JustificatifInfo {
  filename: string
  original_name: string
  date: string
  size: number
  size_human: string
  status: 'en_attente' | 'traites'
  linked_operation?: string
  ocr_data?: OCRSummary
  ocr_amount?: number | null
  ocr_date?: string | null
  ocr_supplier?: string | null
  auto_renamed?: boolean
  original_filename?: string
  category_hint?: string | null
  sous_categorie_hint?: string | null
}

export interface JustificatifStats {
  en_attente: number
  traites: number
  total: number
}

export interface JustificatifUploadResult {
  filename: string
  original_name: string
  size: number
  success: boolean
  error?: string
}

export interface OperationSuggestion {
  operation_file: string
  operation_index: number
  date: string
  libelle: string
  debit: number
  credit: number
  categorie?: string
  // Note : le backend retourne `score` comme MatchScore object (`{ total, detail, confidence_level }`)
  // dans `get_suggestions_for_justificatif`, pas un float. Utiliser un helper pour extraire le total.
  score: number | { total: number; confidence_level?: string; detail?: unknown }
  score_detail?: string
  ventilation_index?: number | null
}

export interface ReverseLookupResult {
  operation_file: string
  operation_index: number
  date: string
  libelle: string
  debit: number
  credit: number
  categorie: string
  sous_categorie: string
  ventilation_index: number | null
}

// ─── Templates justificatifs ───

export interface FieldCoordinates {
  x: number
  y: number
  w: number
  h: number
  page: number
}

export interface TemplateField {
  key: string
  label: string
  type: 'text' | 'date' | 'currency' | 'number' | 'percent' | 'select'
  source: 'operation' | 'ocr' | 'manual' | 'computed' | 'fixed'
  required: boolean
  default?: number
  formula?: string
  options?: string[]
  ocr_confidence?: number
  coordinates?: FieldCoordinates | null
}

export interface JustificatifTemplate {
  id: string
  vendor: string
  vendor_aliases: string[]
  category?: string
  sous_categorie?: string
  source_justificatif?: string
  fields: TemplateField[]
  created_at: string
  created_from: 'scan' | 'manual'
  usage_count: number
  is_blank_template?: boolean
  page_width_pt?: number | null
  page_height_pt?: number | null
  taux_tva?: number
}

export interface ExtractedFields {
  vendor: string
  suggested_aliases: string[]
  detected_fields: Array<{
    key: string
    label: string
    value: string
    type: string
    confidence: number
    suggested_source: string
  }>
}

export interface TemplateSuggestion {
  template_id: string
  vendor: string
  match_score: number
  matched_alias: string
  fields_count: number
}

export interface GenerateRequest {
  template_id: string
  operation_file: string
  operation_index: number
  field_values: Record<string, string | number>
  auto_associate: boolean
}

// ─── Batch Templates ───

export interface BatchCandidate {
  operation_file: string
  operation_index: number
  date: string
  libelle: string
  montant: number
  mois: number
  categorie: string
  sous_categorie: string
}

export interface BatchCandidatesResponse {
  template_id: string
  vendor: string
  year: number
  candidates: BatchCandidate[]
  total: number
}

export interface BatchGenerateResult {
  operation_file: string
  operation_index: number
  filename: string | null
  associated: boolean
  error: string | null
}

export interface BatchGenerateResponse {
  generated: number
  errors: number
  total: number
  results: BatchGenerateResult[]
}

export interface OpsGroup {
  category: string
  sous_categorie: string
  count: number
  total_montant: number
  suggested_template_id: string | null
  suggested_template_vendor: string | null
  operations: BatchCandidate[]
}

export interface OpsWithoutJustificatifResponse {
  year: number
  total: number
  groups: OpsGroup[]
}

// ─── Batch suggest ───

export interface BatchSuggestGroup {
  template_id: string
  template_vendor: string
  operations: { operation_file: string; operation_index: number; libelle: string }[]
}

export interface BatchSuggestResponse {
  groups: BatchSuggestGroup[]
  unmatched: { operation_file: string; operation_index: number; libelle: string }[]
}

export interface TemplateUpdatePayload {
  vendor: string
  vendor_aliases: string[]
  category: string
  sous_categorie: string
  source_justificatif?: string | null
  fields: TemplateField[]
  taux_tva?: number
}

export interface GedTemplateItem {
  id: string
  vendor: string
  vendor_aliases: string[]
  category?: string | null
  sous_categorie?: string | null
  is_blank_template: boolean
  fields_count: number
  thumbnail_url?: string | null
  created_at?: string | null
  usage_count: number
  facsimiles_generated: number
}

export interface GedTemplateFacsimile {
  filename: string
  generated_at?: string | null
  best_amount?: number | null
  best_date?: string | null
  operation_ref?: { file: string; index: number } | null
}

export interface GedTemplateDetail extends GedTemplateItem {
  facsimiles: GedTemplateFacsimile[]
}

// ─── Lettrage ───

export interface LettrageStats {
  total: number
  lettrees: number
  non_lettrees: number
  taux: number
}

// ─── Clôture ───

export interface MonthStatus {
  mois: number
  label: string
  has_releve: boolean
  filename?: string
  nb_operations: number
  nb_lettrees: number
  taux_lettrage: number
  nb_justificatifs_total: number
  nb_justificatifs_ok: number
  taux_justificatifs: number
  statut: 'complet' | 'partiel' | 'manquant'
}

// ─── Rapprochement ───

export interface ScoreDetail {
  montant: number
  date: number
  fournisseur: number
}

export interface MatchScore {
  total: number
  detail: ScoreDetail
  confidence_level: 'fort' | 'probable' | 'possible' | 'faible'
}

export interface RapprochementSuggestion {
  justificatif_filename: string
  operation_file: string
  operation_index: number
  operation_libelle: string
  operation_date: string
  operation_montant: number
  score: MatchScore
}

export interface JustificatifScoreDetail {
  montant: number
  date: number
  fournisseur: number
  // null = critère non inférable (ex: ML n'a pas de prédiction confiante pour le fournisseur)
  // Son poids est redistribué sur les 3 autres critères côté backend.
  categorie: number | null
}

export interface JustificatifSuggestion {
  filename: string
  ocr_date: string
  ocr_montant: number | null
  ocr_fournisseur: string
  score: number
  score_detail?: JustificatifScoreDetail
  size_human: string
}

export interface AutoRapprochementReport {
  total_justificatifs_traites: number
  associations_auto: number
  suggestions_fortes: number
  sans_correspondance: number
  ran_at: string
}

export interface UnmatchedSummary {
  operations_sans_justificatif: number
  justificatifs_en_attente: number
}

export interface AutoLogEntry {
  timestamp: string
  action: string
  justificatif: string
  operation_file: string
  operation_index: number
  operation_libelle: string
  score: number
}

// ─── Prévisionnel ───

export interface PrevProvider {
  id: string
  fournisseur: string
  label: string
  mode: 'facture' | 'echeancier'
  periodicite: 'mensuel' | 'bimestriel' | 'trimestriel' | 'semestriel' | 'annuel'
  mois_attendus: number[]
  jour_attendu: number
  delai_retard_jours: number
  montant_estime: number | null
  categorie: string | null
  keywords_ocr: string[]
  keywords_operations: string[]
  tolerance_montant: number
  poste_comptable: string | null
  actif: boolean
}

export interface PrevProviderCreate {
  fournisseur: string
  label: string
  mode?: string
  periodicite: string
  mois_attendus: number[]
  jour_attendu?: number
  delai_retard_jours?: number
  montant_estime?: number | null
  categorie?: string | null
  keywords_ocr?: string[]
  keywords_operations?: string[]
  tolerance_montant?: number
  poste_comptable?: string | null
  actif?: boolean
}

export interface PrelevementLine {
  mois: number
  montant: number
  jour?: number
  ocr_confidence?: number
}

export interface OcrExtractionResult {
  success: boolean
  nb_lignes_extraites: number
  lignes: PrelevementLine[]
  raw_text_snippet: string
  warnings: string[]
}

export interface PrevPrelevement {
  mois: number
  mois_label: string
  montant_attendu: number
  date_prevue: string
  statut: 'attendu' | 'verifie' | 'ecart' | 'non_preleve' | 'manuel'
  source: 'ocr' | 'manuel'
  ocr_confidence: number | null
  operation_file: string | null
  operation_index: number | null
  operation_libelle: string | null
  operation_date: string | null
  montant_reel: number | null
  ecart: number | null
  match_auto: boolean
}

export interface PrevEcheance {
  id: string
  provider_id: string
  periode_label: string
  date_attendue: string
  statut: 'attendu' | 'recu' | 'en_retard' | 'non_applicable'
  date_reception: string | null
  document_ref: string | null
  document_source: string | null
  montant_reel: number | null
  match_score: number | null
  match_auto: boolean
  note: string
  prelevements: PrevPrelevement[]
  nb_prelevements_verifies: number
  nb_prelevements_total: number
  ocr_extraction: OcrExtractionResult | null
}

export interface TimelinePoste {
  id: string
  label: string
  montant: number
  source: 'provider' | 'moyenne_n1' | 'realise' | 'projete' | 'override'
  statut: 'verifie' | 'attendu' | 'ecart' | 'estime' | 'realise' | 'projete'
  provider_id: string | null
  document_ref: string | null
  confidence: number | null
}

export interface TimelineMois {
  mois: number
  label: string
  statut_mois: 'futur' | 'en_cours' | 'clos'
  charges: TimelinePoste[]
  charges_total: number
  recettes: TimelinePoste[]
  recettes_total: number
  solde: number
  solde_cumule: number
}

export interface TimelineResponse {
  year: number
  mois: TimelineMois[]
  charges_annuelles: number
  recettes_annuelles: number
  solde_annuel: number
  taux_verification: number
}

export interface PrevSettings {
  seuil_montant: number
  categories_exclues: string[]
  categories_recettes: string[]
  annees_reference: number[]
  overrides_mensuels: Record<string, number>
}

export interface PrevDashboard {
  total_echeances: number
  recues: number
  en_attente: number
  en_retard: number
  non_applicable: number
  taux_completion: number
  montant_total_estime: number
  montant_total_reel: number
  prelevements_verifies: number
  prelevements_total: number
  prelevements_en_ecart: number
  taux_prelevements: number
}

// ─── Reports V2 ───

export interface ReportFiltersV2 {
  categories?: string[]
  subcategories?: string[]
  date_from?: string
  date_to?: string
  year?: number
  quarter?: number
  month?: number
  type?: 'debit' | 'credit' | 'all'
  source?: 'note_de_frais' | 'bancaire' | 'all'
  important_only?: boolean
  min_amount?: number
  max_amount?: number
}

export interface ReportGenerateRequest {
  format: 'pdf' | 'csv' | 'excel'
  title?: string
  description?: string
  filters: ReportFiltersV2
  template_id?: string
}

export interface ReportMetadata {
  filename: string
  title: string
  description?: string
  format: string
  generated_at: string
  filters: ReportFiltersV2
  template_id?: string
  nb_operations: number
  total_debit: number
  total_credit: number
  file_size: number
  file_size_human: string
  year?: number
  quarter?: number
  month?: number
  favorite?: boolean
  categories_label?: string
  replaced?: string
}

export interface ReportTemplate {
  id: string
  label: string
  description: string
  icon: string
  format: string
  filters: ReportFiltersV2
}

export interface ReportTreeResponse {
  by_year: GedTreeNode[]
  by_category: GedTreeNode[]
  by_format: GedTreeNode[]
}

export interface ReportComparison {
  report_a: ReportMetadata
  report_b: ReportMetadata
  delta_debit: number
  delta_credit: number
  delta_ops: number
  delta_debit_pct: number
  delta_credit_pct: number
}

export interface PendingReport {
  type: string
  period: string
  message: string
  year: number
  month?: number
  quarter?: number
}

export interface ReportGalleryResponse {
  reports: ReportMetadata[]
  available_years: number[]
  total_count: number
}

// ─── GED ───

export interface PosteComptable {
  id: string
  label: string
  deductible_pct: number // 0-100
  categories_associees: string[]
  notes: string
  is_system: boolean
}

export interface PostesConfig {
  version: number
  exercice: number
  postes: PosteComptable[]
}

export interface PeriodInfo {
  year: number
  month?: number
  quarter?: number
}

export interface RapportMeta {
  template_id?: string
  title?: string
  description?: string
  filters?: Record<string, any>
  format?: string
  favorite: boolean
  generated_at?: string
  can_regenerate: boolean
  can_compare: boolean
}

export interface GedDocument {
  doc_id: string
  type: 'releve' | 'justificatif' | 'rapport' | 'document_libre'
  year: number | null
  month: number | null
  poste_comptable: string | null
  categorie: string | null
  sous_categorie: string | null
  montant_brut: number | null
  deductible_pct_override: number | null
  tags: string[]
  notes: string
  added_at: string
  original_name: string | null
  ocr_file: string | null
  // GED V2 enriched fields
  fournisseur?: string | null
  date_document?: string | null
  date_operation?: string | null
  period?: PeriodInfo | null
  montant?: number | null
  ventilation_index?: number | null
  is_reconstitue?: boolean
  statut_justificatif?: 'traite' | 'en_attente' | null
  operation_ref?: { file: string; index: number; ventilation_index?: number } | null
  rapport_meta?: RapportMeta | null
  source_module?: string | null
}

export interface GedTreeNode {
  id: string
  label: string
  count: number
  children: GedTreeNode[]
  icon?: string
}

export interface GedTreeResponse {
  by_period: GedTreeNode[]
  by_category: GedTreeNode[]
  by_vendor: GedTreeNode[]
  by_type: GedTreeNode[]
  by_year: GedTreeNode[]
}

export interface GedSearchResult {
  doc_id: string
  document: GedDocument
  match_context: string
  score: number
}

export interface GedStats {
  total_documents: number
  total_brut: number
  total_deductible: number
  disk_size_human: string
  par_poste: Array<{
    poste_id: string
    poste_label: string
    deductible_pct: number
    nb_docs: number
    total_brut: number
    total_deductible: number
  }>
  par_categorie: Array<{ categorie: string; count: number; total_montant: number }>
  par_fournisseur: Array<{ fournisseur: string; count: number; total_montant: number }>
  par_type: Record<string, number>
  non_classes: number
  rapports_favoris: number
}

// ─── Dashboard V2 (Year Overview) ───

export interface MoisOverview {
  mois: number
  label: string
  has_releve: boolean
  nb_operations: number
  taux_lettrage: number
  taux_justificatifs: number
  taux_categorisation: number
  taux_rapprochement: number
  has_export: boolean
  total_credit: number
  total_debit: number
  filename: string | null
}

export interface DashboardKPIs {
  total_recettes: number
  total_charges: number
  bnc_estime: number
  nb_operations: number
  nb_mois_actifs: number
  bnc_mensuel: number[]
}

export interface DeltaN1 {
  prev_total_recettes: number
  prev_total_charges: number
  prev_bnc: number
  delta_recettes_pct: number
  delta_charges_pct: number
  delta_bnc_pct: number
}

export interface AlerteDashboard {
  type: string
  mois: number
  year: number
  impact: number
  message: string
  detail: string
  count: number
}

export interface ProgressionExercice {
  globale: number
  criteres: Record<string, number>
}

export interface ActiviteRecente {
  type: string
  message: string
  timestamp: string
  detail: string
}

export interface YearOverviewResponse {
  year: number
  mois: MoisOverview[]
  kpis: DashboardKPIs
  delta_n1: DeltaN1 | null
  alertes: AlerteDashboard[]
  progression: ProgressionExercice
  activite_recente: ActiviteRecente[]
  pending_reports?: PendingReport[]
}

export interface GedFilters {
  type?: string
  year?: number
  month?: number
  quarter?: number
  categorie?: string
  sous_categorie?: string
  fournisseur?: string
  format_type?: string
  favorite?: boolean
  poste_comptable?: string
  tags?: string[]
  search?: string
  montant_min?: number
  montant_max?: number
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

// ─── Amortissements ───

export interface OperationSourceRef {
  file: string
  index: number
}

export interface Immobilisation {
  id: string
  libelle: string
  date_acquisition: string
  valeur_origine: number
  duree_amortissement: number
  methode: 'lineaire' | 'degressif'
  poste_comptable: string
  date_mise_en_service: string | null
  date_sortie: string | null
  motif_sortie: string | null
  prix_cession: number | null
  quote_part_pro: number
  plafond_fiscal: number | null
  co2_classe: string | null
  operation_source: OperationSourceRef | null
  justificatif_id: string | null
  ged_doc_id: string | null
  created_at: string
  statut: 'en_cours' | 'amorti' | 'sorti'
  notes: string | null
  avancement_pct?: number
  vnc_actuelle?: number
  tableau?: LigneAmortissement[]
}

export interface ImmobilisationCreate {
  libelle: string
  date_acquisition: string
  valeur_origine: number
  duree_amortissement: number
  methode?: string
  poste_comptable: string
  date_mise_en_service?: string | null
  quote_part_pro?: number
  plafond_fiscal?: number | null
  co2_classe?: string | null
  operation_source?: OperationSourceRef | null
  justificatif_id?: string | null
  ged_doc_id?: string | null
  notes?: string | null
}

export interface LigneAmortissement {
  exercice: number
  jours: number
  base_amortissable: number
  dotation_brute: number
  quote_part_pro: number
  dotation_deductible: number
  amortissements_cumules: number
  vnc: number
}

export interface AmortissementCandidate {
  filename: string
  index: number
  date: string
  libelle: string
  categorie: string
  sous_categorie: string
  debit: number
}

export interface AmortissementKpis {
  nb_actives: number
  nb_amorties: number
  nb_sorties: number
  nb_candidates: number
  dotation_exercice: number
  total_vnc: number
  total_valeur_origine: number
  postes: Array<{ poste: string; nb: number; vnc: number; dotation: number }>
}

export interface DotationsExercice {
  year: number
  total_dotations_brutes: number
  total_dotations_deductibles: number
  detail: Array<{
    immo_id: string
    libelle: string
    poste_comptable: string
    dotation_brute: number
    dotation_deductible: number
    vnc: number
  }>
}

export interface AmortissementConfig {
  seuil_immobilisation: number
  durees_par_defaut: Record<string, number>
  methode_par_defaut: string
  categories_immobilisables: string[]
  sous_categories_exclues: string[]
  exercice_cloture: string
}

export interface CessionResult {
  vnc_sortie: number
  plus_value: number | null
  moins_value: number | null
  duree_detention_mois: number
  regime: 'court_terme' | 'long_terme'
}

// ============================================================
// Simulation BNC
// ============================================================

export interface SimulationLeviers {
  madelin: number
  per: number
  carmf_classe: string
  investissement: number
  investissement_duree: number
  investissement_prorata_mois: number
  formation_dpc: number
  remplacement: number
  depense_pro: number
  depenses_detail: Record<string, number>
}

export interface SimulationResult {
  bnc_actuel: number
  bnc_social: number
  bnc_imposable: number
  dotations_existantes: number
  dotation_nouvel_invest: number
  investissement_traitement: 'charge_immediate' | 'immobilisation'
  urssaf_actuel: number; urssaf_simule: number; urssaf_delta: number
  carmf_actuel: number; carmf_simule: number; carmf_delta: number
  odm: number
  ir_actuel: number; ir_simule: number; ir_delta: number
  total_actuel: number; total_simule: number; total_delta: number
  revenu_net_actuel: number; revenu_net_simule: number; revenu_net_delta: number
  invest_montant: number
  invest_deduction_an1: number
  invest_cout_reel_an1: number
}

export interface UrssafDeductibleResult {
  year: number
  montant_brut: number
  assiette_csg_crds: number
  assiette_mode: 'bnc_plus_cotisations' | 'bnc_abattu'
  taux_non_deductible: number
  part_non_deductible: number
  part_deductible: number
  ratio_non_deductible: number
  bnc_estime_utilise: number
  cotisations_sociales_utilisees: number | null
}

export interface TauxMarginal {
  ir: number; urssaf: number; carmf: number; csg: number; total: number
  prochaine_tranche: {
    taux: number; seuil: number; label: string; distance: number
  } | null
}

export interface SeuilCritique {
  seuil: number; label: string; type: 'ir' | 'urssaf' | 'carmf'
  taux_avant: number; taux_apres: number; delta: number
}

export interface HistoriqueBNC {
  years: number[]
  monthly: Array<{ year: number; month: number; recettes: number; depenses: number; bnc: number }>
  annual: Array<{ year: number; recettes: number; depenses: number; bnc: number; nb_mois: number }>
  profil_saisonnier: Array<{ month: number; coeff: number }>
}

export interface PrevisionBNC {
  methode: string
  previsions: Array<{
    year: number; month: number; recettes_prevues: number
    depenses_prevues: number; bnc_prevu: number
    confiance: 'haute' | 'moyenne' | 'basse'
  }>
  bnc_annuel_prevu: number
  tendance_annuelle_pct: number
  nb_mois_historique: number
  avertissement: string | null
}

export interface AllBaremes {
  urssaf: any
  carmf: any
  ir: any
  odm: { year: number; cotisation_annuelle: number; type: string }
  year: number
}

// Pipeline Comptable
export type PipelineStepStatus = 'not_started' | 'in_progress' | 'complete'

export interface PipelineStep {
  id: string
  number: number
  title: string
  description: string
  status: PipelineStepStatus
  progress: number // 0-100
  metrics: PipelineMetric[]
  actionLabel: string
  actionRoute: string
  secondaryActions?: { label: string; route: string }[]
}

export interface PipelineMetric {
  label: string
  value: string | number
  total?: number
  variant?: 'default' | 'success' | 'warning' | 'danger'
}

export interface PipelineState {
  year: number
  month: number
  steps: PipelineStep[]
  globalProgress: number // 0-100, moyenne pondérée
}

// ──── Tasks (Kanban) ────

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'haute' | 'normale' | 'basse'
export type TaskSource = 'manual' | 'auto'

export interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  source: TaskSource
  year?: number
  auto_key?: string
  due_date?: string
  dismissed: boolean
  created_at: string
  completed_at?: string
  order: number
  metadata?: {
    corrections_count?: number
    days_since_training?: number
    action_url?: string
    [key: string]: unknown
  }
}

export interface TaskCreate {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  year?: number
  due_date?: string
}

export interface TaskUpdate {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  due_date?: string
  dismissed?: boolean
}

// --- Charges Forfaitaires ---

export type TypeForfait = 'blanchissage' | 'vehicule'
export type ModeBlanchissage = 'domicile' | 'pressing'

export interface ArticleBlanchissage {
  type: string
  tarif_pressing: number
  quantite_jour: number
}

export interface BaremeBlanchissage {
  annee: number
  reference_legale: string
  mode_defaut: string
  decote_domicile: number
  articles: ArticleBlanchissage[]
}

export interface ArticleDetail {
  type: string
  tarif_pressing: number
  montant_unitaire: number
  quantite_jour: number
  jours: number
  sous_total: number
}

export interface ForfaitResult {
  type_forfait: TypeForfait
  year: number
  montant_total: number
  montant_deductible: number
  detail: ArticleDetail[]
  reference_legale: string
  mode: string
  decote: number
  jours_travailles: number
  cout_jour: number
  honoraires_liasse?: number | null
}

export interface GenerateODRequest {
  type_forfait: TypeForfait
  year: number
  jours_travailles: number
  mode: ModeBlanchissage
  date_ecriture?: string
  honoraires_liasse?: number | null
}

export interface GenerateODResponse {
  od_filename: string
  od_index: number
  pdf_filename: string
  ged_doc_id: string
  montant: number
}

export interface ForfaitGenere {
  type_forfait: TypeForfait
  montant: number
  date_ecriture: string
  od_filename: string
  od_index: number
  pdf_filename: string
  ged_doc_id: string
}

// --- Véhicule (quote-part pro) ---

export interface VehiculeRequest {
  year: number
  distance_domicile_clinique_km: number
  jours_travailles: number
  km_supplementaires: number
  km_totaux_compteur: number
}

export interface VehiculeResult {
  type_forfait: 'vehicule'
  year: number
  distance_domicile_clinique_km: number
  jours_travailles: number
  km_trajet_habituel: number
  km_supplementaires: number
  km_pro_total: number
  km_totaux_compteur: number
  ratio_pro: number
  ratio_perso: number
  ancien_ratio: number | null
  delta_ratio: number | null
}

export interface ApplyVehiculeResponse {
  ratio_pro: number
  ancien_ratio: number
  pdf_filename: string
  ged_doc_id: string
  poste_updated: boolean
}

export interface VehiculeGenere {
  type_forfait: 'vehicule'
  ratio_pro: number
  date_application: string
  pdf_filename: string
  ged_doc_id: string
  distance: number | null
  jours: number | null
  km_sup: number | null
  km_totaux: number | null
}
