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
  Commentaire?: string
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
