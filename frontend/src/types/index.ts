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
  Commentaire?: string
  rapprochement_score?: number
  rapprochement_mode?: 'auto' | 'manuel' | null
  rapprochement_date?: string
  alertes?: AlerteType[]
  alertes_resolues?: AlerteType[]
  compte_attente?: boolean
  alerte_note?: string
  _index?: number
  _sourceFile?: string
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

export interface TrainResult {
  success: boolean
  metrics: {
    accuracy_train: number
    accuracy_test: number
    f1: number
    precision: number
    recall: number
    confusion_matrix: number[][]
  }
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

export interface OCRResult {
  filename: string
  processed_at: string
  status: string
  processing_time_ms: number
  raw_text: string
  extracted_data: OCRExtractedData
  page_count: number
  confidence: number
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
  score: number
  score_detail: string
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

// ─── Échéancier ───

export interface Recurrence {
  id: string
  libelle_display: string
  libelle_normalized: string
  periodicite: 'hebdomadaire' | 'bi_mensuel' | 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel'
  montant_moyen: number
  montant_std: number
  derniere_occurrence: string
  nb_occurrences: number
  fiabilite: number
  categorie?: string
}

export interface Echeance {
  id: string
  recurrence_id: string
  date_prevue: string
  date_min: string
  date_max: string
  libelle: string
  montant_prevu: number
  incertitude: number
  periodicite: string
  fiabilite: number
  statut: 'prevu' | 'realise' | 'annule'
  operation_liee?: string
}

export interface EcheancierStats {
  total: number
  par_periodicite: Record<string, number>
  montant_mensuel_moyen: number
  nb_alertes_decouvert: number
}

export interface SoldePrevisionnel {
  date: string
  solde: number
  evenement: string
  montant: number
  alerte: boolean
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

export interface GedDocument {
  doc_id: string
  type: 'releve' | 'justificatif' | 'rapport' | 'document_libre'
  year: number | null
  month: number | null
  poste_comptable: string | null
  montant_brut: number | null
  deductible_pct_override: number | null
  tags: string[]
  notes: string
  added_at: string
  original_name: string | null
  ocr_file: string | null
}

export interface GedTreeNode {
  id: string
  label: string
  count: number
  children: GedTreeNode[]
  icon?: string
}

export interface GedTreeResponse {
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
}

export interface GedFilters {
  type?: string
  year?: number
  month?: number
  poste_comptable?: string
  tags?: string[]
  search?: string
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}
