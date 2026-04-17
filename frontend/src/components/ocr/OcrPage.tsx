import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { showDeleteConfirmToast, showDeleteSuccessToast } from '@/lib/deleteJustificatifToast'
import { useNavigate, useLocation } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { useQueries } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import PdfThumbnail from '@/components/shared/PdfThumbnail'
import {
  useOcrStatus, useOcrHistory, useExtractOcr, useExtractUpload,
  useBatchUploadOcr,
} from '@/hooks/useOcr'
import type { BatchUploadResult } from '@/hooks/useOcr'
import { useJustificatifs, useJustificatifStats, useDeleteJustificatif } from '@/hooks/useJustificatifs'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { api } from '@/api/client'
import { formatCurrency, cn, MOIS_FR, isLegacyPseudoCanonical } from '@/lib/utils'
import {
  ScanLine, FileSearch, Clock, CheckCircle, CheckCircle2, AlertCircle,
  Loader2, Zap, Database, Upload, RotateCcw, FileText,
  ArrowRight, DollarSign, Calendar, User, Filter, Tag, Eye, Wand2,
  Search, X, Pencil, Trash2, AlertTriangle, Inbox,
} from 'lucide-react'
import TemplatesTab from './TemplatesTab'
import ScanRenameDrawer from './ScanRenameDrawer'
import OcrEditDrawer from './OcrEditDrawer'
import SandboxTab from './SandboxTab'
import JustificatifOperationLink from '@/components/shared/JustificatifOperationLink'
import FilenameEditor from '@/components/justificatifs/FilenameEditor'
import { useReverseLookup } from '@/hooks/useJustificatifs'
import type { OCRResult, OCRHistoryItem, ReverseLookupResult } from '@/types'

type Tab = 'upload' | 'test' | 'sandbox' | 'en-attente' | 'traites' | 'templates'

// Alias legacy : `?tab=historique` (avant Session 30) → `en-attente` (split en 2).
// Nécessaire pour rattraper les events SSE déjà dans le ring buffer backend
// (fenêtre 180s) au moment du déploiement.
const LEGACY_TAB_ALIASES: Record<string, Tab> = {
  historique: 'en-attente',
}
const VALID_TABS: readonly Tab[] = ['upload', 'test', 'sandbox', 'en-attente', 'traites', 'templates'] as const

export default function OcrPage() {
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const preFile = searchParams.get('file')
  const preIndex = searchParams.get('index')
  const preTemplate = searchParams.get('template')
  const preTab = searchParams.get('tab')
  // Navigation depuis le toast d'arrivée : ?tab=historique&sort=scan_date&highlight=X
  const preSort = searchParams.get('sort')
  const preHighlight = searchParams.get('highlight')

  const { data: justifStats } = useJustificatifStats()
  const pendingCount = justifStats?.en_attente ?? 0
  const traitesCount = justifStats?.traites ?? 0
  const sandboxCount = justifStats?.sandbox ?? 0

  // Résolution `initialTab` avec alias legacy (`historique` → `en-attente`)
  // + validation stricte contre VALID_TABS (tout param non reconnu fallback
  // sur la règle métier : sandbox si > 0, sinon upload).
  const resolvePreTab = (): Tab | null => {
    if (!preTab) return null
    if (LEGACY_TAB_ALIASES[preTab]) return LEGACY_TAB_ALIASES[preTab]
    if ((VALID_TABS as readonly string[]).includes(preTab)) return preTab as Tab
    return null
  }
  const initialTab: Tab =
    resolvePreTab() ??
    (preFile ? 'templates' : null) ??
    (sandboxCount > 0 ? 'sandbox' : 'upload')
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [templatePreFile, setTemplatePreFile] = useState('')
  const { data: status } = useOcrStatus()
  // Limite élevée car l'OCR Historique doit couvrir tous les scans en attente
  // (pipeline) — le plafond à 100 faisait disparaître des items traités il y a
  // plus de 100 OCR. Le backend lit déjà tous les `.ocr.json` avant de slicer.
  const { data: history, isLoading: historyLoading } = useOcrHistory(2000)

  const handleCreateTemplate = (filename: string) => {
    setTemplatePreFile(filename)
    setActiveTab('templates')
  }

  return (
    <div className="p-6">
      <PageHeader
        title="OCR - Reconnaissance Optique"
        description="Point d'entrée des justificatifs : upload, extraction automatique des données"
      />

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Moteur OCR"
          value={status?.easyocr_available ? (status?.reader_loaded ? 'Chargé' : 'Disponible') : 'Non installé'}
          icon={<Zap size={18} />}
          trend={status?.easyocr_available ? 'up' : 'down'}
        />
        <MetricCard
          title="Poppler (PDF)"
          value={status?.poppler_available ? 'OK' : 'Non dispo'}
          icon={<FileSearch size={18} />}
          trend={status?.poppler_available ? 'up' : 'down'}
        />
        <MetricCard
          title="Extractions totales"
          value={String(status?.total_extractions ?? 0)}
          icon={<Database size={18} />}
        />
        <MetricCard
          title="Dernier traitement"
          value={history?.[0]?.processed_at ? new Date(history[0].processed_at).toLocaleDateString('fr-FR') : '-'}
          icon={<Clock size={18} />}
        />
      </div>

      {/* Tabs — ordre métier Session 30 :
          Upload → Test → Sandbox (inbox) → En attente (scan OCR prêt à associer) →
          Traités (archive post-rapprochement) → Templates. */}
      <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border mb-6 w-fit">
        {([
          { key: 'upload' as Tab, label: 'Upload & OCR', icon: Upload },
          { key: 'test' as Tab, label: 'Test Manuel', icon: ScanLine },
          { key: 'sandbox' as Tab, label: 'Sandbox', icon: Inbox, badge: sandboxCount, badgeColor: 'bg-amber-500' as const, badgeTitle: 'fichier(s) en attente dans la boîte d\u2019arriv\u00e9e' },
          { key: 'en-attente' as Tab, label: 'En attente', icon: Clock, badge: pendingCount, badgeColor: 'bg-orange-600' as const, badgeTitle: 'scan(s) en attente d\u2019association' },
          { key: 'traites' as Tab, label: 'Traités', icon: CheckCircle2, badge: traitesCount, badgeColor: 'bg-emerald-600' as const, badgeTitle: 'scan(s) associ\u00e9(s) \u00e0 une op\u00e9ration' },
          { key: 'templates' as Tab, label: 'Templates justificatifs', icon: FileText },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors',
              activeTab === tab.key
                ? 'bg-primary text-white'
                : 'text-text-muted hover:text-text'
            )}
          >
            <tab.icon size={14} />
            {tab.label}
            {'badge' in tab && (tab.badge ?? 0) > 0 && (
              <span
                className={cn(
                  'text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1',
                  activeTab === tab.key
                    ? 'bg-white/25 text-white'
                    : `${tab.badgeColor} text-white`,
                )}
                title={`${tab.badge} ${tab.badgeTitle}`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'upload' ? (
        <BatchUploadTab onCreateTemplate={handleCreateTemplate} />
      ) : activeTab === 'test' ? (
        <TestManuelTab />
      ) : activeTab === 'sandbox' ? (
        <SandboxTab />
      ) : activeTab === 'en-attente' ? (
        <OcrListTab
          history={history || []}
          isLoading={historyLoading}
          initialSort={preSort === 'scan_date' ? 'scan_date' : undefined}
          initialHighlight={preHighlight || undefined}
          statusFilter="en_attente"
        />
      ) : activeTab === 'traites' ? (
        <OcrListTab
          history={history || []}
          isLoading={historyLoading}
          initialSort={preSort === 'scan_date' ? 'scan_date' : undefined}
          initialHighlight={preHighlight || undefined}
          statusFilter="traites"
        />
      ) : (
        <TemplatesTab preFile={preFile} preIndex={preIndex} preTemplate={preTemplate} preCreateFile={templatePreFile || null} />
      )}
    </div>
  )
}


// ──── Batch Upload Tab ────

function BatchUploadTab({ onCreateTemplate }: { onCreateTemplate: (filename: string) => void }) {
  const navigate = useNavigate()
  const batchUpload = useBatchUploadOcr()
  const [results, setResults] = useState<BatchUploadResult[]>([])
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    setDroppedFiles(acceptedFiles)
    setResults([])
    batchUpload.mutate(acceptedFiles, {
      onSuccess: (data) => setResults(data),
    })
  }, [batchUpload])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxFiles: 50,
    disabled: batchUpload.isPending,
  })

  const successCount = results.filter(r => r.success).length
  const ocrSuccessCount = results.filter(r => r.ocr_success).length
  const hasResults = results.length > 0

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      {!batchUpload.isPending && !hasResults && (
        <div
          {...getRootProps()}
          className={cn(
            'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors',
            isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
          )}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Upload size={28} className="text-primary" />
            </div>
            <div>
              <p className="text-sm text-text font-medium">
                Glissez vos justificatifs ici (PDF, JPG, PNG)
              </p>
              <p className="text-xs text-text-muted mt-1">
                ou cliquez pour sélectionner — jusqu'à 50 fichiers
              </p>
            </div>
            <p className="text-[10px] text-text-muted">
              Les fichiers seront sauvegardés et analysés par OCR automatiquement
            </p>
          </div>
        </div>
      )}

      {/* Processing indicator */}
      {batchUpload.isPending && (
        <div className="bg-surface rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <Loader2 size={20} className="text-primary animate-spin" />
            <div>
              <p className="text-sm font-medium text-text">Traitement OCR en cours...</p>
              <p className="text-xs text-text-muted">
                {droppedFiles.length} fichier(s) en cours d'analyse
              </p>
            </div>
          </div>
          <div className="w-full h-2 bg-background rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
          <div className="mt-4 space-y-1.5">
            {droppedFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-text-muted">
                <Loader2 size={10} className="animate-spin text-primary" />
                <span className="truncate">{f.name}</span>
                <span className="text-[10px]">({(f.size / 1024).toFixed(0)} Ko)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {batchUpload.error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 text-red-400 rounded-lg text-sm">
          <AlertCircle size={16} />
          {batchUpload.error.message}
        </div>
      )}

      {/* Results */}
      {hasResults && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-surface rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle size={18} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-text">
                  Traitement terminé
                </h3>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-text-muted">
                  {successCount}/{results.length} uploadé(s)
                </span>
                <span className="text-emerald-400">
                  {ocrSuccessCount} OCR réussi(s)
                </span>
              </div>
            </div>

            {/* File results list */}
            <div className="space-y-2">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border p-3',
                    r.success && r.ocr_success
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : r.success
                        ? 'border-amber-500/30 bg-amber-500/5'
                        : 'border-red-500/30 bg-red-500/5'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={14} className={cn(
                        r.success && r.ocr_success ? 'text-emerald-400' :
                        r.success ? 'text-amber-400' : 'text-red-400'
                      )} />
                      <span className="text-xs text-text truncate">{r.original_name}</span>
                    </div>
                    {r.success && r.ocr_success ? (
                      <CheckCircle size={13} className="text-emerald-400 shrink-0" />
                    ) : r.success ? (
                      <AlertCircle size={13} className="text-amber-400 shrink-0" />
                    ) : (
                      <AlertCircle size={13} className="text-red-400 shrink-0" />
                    )}
                  </div>

                  {r.success && r.ocr_data && (
                    <div className="flex items-center gap-4 text-[10px] text-text-muted mt-1.5 ml-6">
                      {r.ocr_data.best_date && (
                        <span className="flex items-center gap-0.5">
                          <Calendar size={9} />
                          {r.ocr_data.best_date}
                        </span>
                      )}
                      {r.ocr_data.best_amount != null && (
                        <span className="flex items-center gap-0.5">
                          <DollarSign size={9} />
                          {formatCurrency(r.ocr_data.best_amount)}
                        </span>
                      )}
                      {r.ocr_data.supplier && (
                        <span className="flex items-center gap-0.5">
                          <User size={9} />
                          {r.ocr_data.supplier}
                        </span>
                      )}
                    </div>
                  )}

                  {r.ocr_error && (
                    <p className="text-[10px] text-amber-400 mt-1 ml-6">{r.ocr_error}</p>
                  )}
                  {r.error && (
                    <p className="text-[10px] text-red-400 mt-1 ml-6">{r.error}</p>
                  )}

                  {r.success && (
                    <p className="text-[9px] text-text-muted mt-1 ml-6 opacity-60 truncate">
                      {r.filename}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setResults([]); setDroppedFiles([]) }}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-border rounded-lg text-text-muted hover:text-text hover:bg-surface transition-colors"
            >
              <Upload size={14} />
              Nouveau batch
            </button>
            {results.some(r => r.success && r.ocr_success) && (
              <button
                onClick={() => {
                  const last = results.filter(r => r.success && r.ocr_success).pop()
                  if (last) onCreateTemplate(last.filename)
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm border border-violet-500/30 text-violet-400 rounded-lg hover:bg-violet-500/10 transition-colors"
              >
                <Tag size={14} />
                Créer un template
              </button>
            )}
            <button
              onClick={() => navigate('/justificatifs')}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              Voir dans Justificatifs
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ──── Test Manuel Tab ────

function TestManuelTab() {
  const [mode, setMode] = useState<'upload' | 'existing'>('upload')
  const [selectedFile, setSelectedFile] = useState('')
  const [result, setResult] = useState<OCRResult | null>(null)

  const extractUpload = useExtractUpload()
  const extractOcr = useExtractOcr()

  const { data: justificatifs } = useJustificatifs({
    status: 'all', search: '', sort_by: 'date', sort_order: 'desc',
  })

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return
    extractUpload.mutate(file, {
      onSuccess: (data) => setResult(data),
    })
  }, [extractUpload])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxFiles: 1,
    disabled: extractUpload.isPending,
  })

  const handleExtractExisting = () => {
    if (!selectedFile) return
    extractOcr.mutate(selectedFile, {
      onSuccess: (data) => setResult(data),
    })
  }

  const isExtracting = extractUpload.isPending || extractOcr.isPending

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Input */}
      <div className="space-y-4">
        {/* Mode selector */}
        <div className="flex gap-2">
          <button
            onClick={() => { setMode('upload'); setResult(null) }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm transition-colors',
              mode === 'upload' ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text'
            )}
          >
            <Upload size={13} className="inline mr-1.5" />
            Upload fichier
          </button>
          <button
            onClick={() => { setMode('existing'); setResult(null) }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm transition-colors',
              mode === 'existing' ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text'
            )}
          >
            <FileText size={13} className="inline mr-1.5" />
            Justificatif existant
          </button>
        </div>

        {mode === 'upload' ? (
          <div
            {...getRootProps()}
            className={cn(
              'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
              isDragActive ? 'border-primary bg-primary/5' :
              isExtracting ? 'border-border bg-surface opacity-60' :
              'border-border hover:border-primary/50'
            )}
          >
            <input {...getInputProps()} />
            {isExtracting ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={32} className="text-primary animate-spin" />
                <p className="text-sm text-text-muted">Extraction OCR en cours...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Upload size={32} className="text-text-muted" />
                <p className="text-sm text-text">Glissez un fichier ici (PDF, JPG, PNG) ou cliquez pour sélectionner</p>
                <p className="text-xs text-text-muted">Test OCR ad-hoc (non sauvegardé)</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <select
              value={selectedFile}
              onChange={e => { setSelectedFile(e.target.value); setResult(null) }}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:border-primary"
            >
              <option value="">Sélectionner un justificatif...</option>
              {justificatifs?.map(j => (
                <option key={j.filename} value={j.filename}>
                  {j.original_name} ({j.date} - {j.size_human})
                </option>
              ))}
            </select>
            <button
              onClick={handleExtractExisting}
              disabled={!selectedFile || isExtracting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isExtracting ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
              Lancer l'extraction OCR
            </button>
          </div>
        )}

        {/* Error */}
        {(extractUpload.error || extractOcr.error) && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 text-red-400 rounded-lg text-sm">
            <AlertCircle size={14} />
            {extractUpload.error?.message || extractOcr.error?.message}
          </div>
        )}
      </div>

      {/* Right: Result */}
      <div className="bg-surface rounded-xl border border-border p-5 min-h-[300px]">
        {result ? (
          <OcrResultPanel result={result} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3 py-12">
            <ScanLine size={40} className="opacity-30" />
            <p className="text-sm">Les résultats OCR s'afficheront ici</p>
          </div>
        )}
      </div>
    </div>
  )
}


// ──── OCR Result Panel ────

function OcrResultPanel({ result }: { result: OCRResult }) {
  const [showRaw, setShowRaw] = useState(false)
  const ed = result.extracted_data
  const isSuccess = result.status === 'success'

  return (
    <div className="space-y-4">
      {/* Status badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isSuccess ? (
            <CheckCircle size={16} className="text-emerald-400" />
          ) : (
            <AlertCircle size={16} className="text-red-400" />
          )}
          <span className={cn('text-sm font-medium', isSuccess ? 'text-emerald-400' : 'text-red-400')}>
            {isSuccess ? 'Extraction réussie' : result.status === 'no_text' ? 'Aucun texte détecté' : 'Erreur'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span>{result.page_count} page{result.page_count > 1 ? 's' : ''}</span>
          <span>{result.processing_time_ms}ms</span>
        </div>
      </div>

      {/* Confidence bar */}
      {isSuccess && (
        <div>
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>Confiance</span>
            <span>{Math.round(result.confidence * 100)}%</span>
          </div>
          <div className="w-full h-2 bg-background rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                result.confidence >= 0.8 ? 'bg-emerald-500' :
                result.confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-400'
              )}
              style={{ width: `${Math.round(result.confidence * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Extracted data */}
      {isSuccess && (
        <div className="space-y-3">
          {/* Dates */}
          <div>
            <p className="text-xs text-text-muted mb-1.5">Dates extraites ({ed.dates.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {ed.dates.length > 0 ? ed.dates.map((d, i) => (
                <span
                  key={i}
                  className={cn(
                    'px-2 py-0.5 rounded-full text-xs',
                    i === 0 ? 'bg-primary/15 text-primary font-medium' : 'bg-surface-hover text-text-muted'
                  )}
                >
                  {d}
                </span>
              )) : (
                <span className="text-xs text-text-muted italic">Aucune date</span>
              )}
            </div>
          </div>

          {/* Amounts */}
          <div>
            <p className="text-xs text-text-muted mb-1.5">Montants extraits ({ed.amounts.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {ed.amounts.length > 0 ? ed.amounts.map((a, i) => (
                <span
                  key={i}
                  className={cn(
                    'px-2 py-0.5 rounded-full text-xs',
                    i === 0 ? 'bg-emerald-500/15 text-emerald-400 font-medium' : 'bg-surface-hover text-text-muted'
                  )}
                >
                  {formatCurrency(a)}
                </span>
              )) : (
                <span className="text-xs text-text-muted italic">Aucun montant</span>
              )}
            </div>
          </div>

          {/* Supplier */}
          <div>
            <p className="text-xs text-text-muted mb-1.5">Fournisseur</p>
            {ed.supplier ? (
              <span className="px-2 py-0.5 bg-amber-500/15 text-amber-400 rounded-full text-xs">
                {ed.supplier}
              </span>
            ) : (
              <span className="text-xs text-text-muted italic">Non identifié</span>
            )}
          </div>
        </div>
      )}

      {/* Raw text toggle */}
      {isSuccess && result.raw_text && (
        <div>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-text-muted hover:text-text transition-colors"
          >
            {showRaw ? 'Masquer' : 'Afficher'} le texte brut
          </button>
          {showRaw && (
            <div className="mt-2 bg-background rounded-lg p-3 max-h-48 overflow-y-auto">
              <pre className="text-xs text-text-muted whitespace-pre-wrap font-mono leading-relaxed">
                {result.raw_text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ──── Helpers ────

/** Extrait année et mois depuis le nom de fichier (convention: fournisseur_YYYYMMDD_montant.pdf) */
function parseDateFromFilename(filename: string): { year: number | null; month: number | null } {
  const m = filename.match(/(\d{4})(\d{2})\d{2}/)
  if (m) return { year: parseInt(m[1]), month: parseInt(m[2]) }
  return { year: null, month: null }
}

/** Source canonique année/mois pour un item OCR — DOIT être alignée avec le
 *  widget Pipeline (PendingScansWidget filtre par `ocr_date || date`).
 *  Priorité : best_date (OCR parsé, fiable) → filename (dérivé canonique).
 *  Ne pas utiliser `processed_at` (date de traitement ≠ date de la facture). */
function periodOf(item: OCRHistoryItem): { year: number | null; month: number | null } {
  if (item.best_date && item.best_date.length >= 7) {
    return {
      year: parseInt(item.best_date.slice(0, 4), 10),
      month: parseInt(item.best_date.slice(5, 7), 10),
    }
  }
  return parseDateFromFilename(item.filename)
}

// ──── PDF Preview Hover ────

function PdfPreviewHover({ filename }: { filename: string }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleEnter = () => {
    timerRef.current = setTimeout(() => {
      if (btnRef.current) {
        const rect = btnRef.current.getBoundingClientRect()
        setPos({
          top: rect.top,
          left: rect.left - 320,
        })
      }
      setShow(true)
    }, 300)
  }

  const handleLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setShow(false)
  }

  return (
    <>
      <button
        ref={btnRef}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        className="p-1 text-text-muted/40 hover:text-violet-400 transition-colors"
        title="Aperçu"
      >
        <Eye size={13} />
      </button>
      {show && (
        <div
          className="fixed z-[60] bg-white rounded-lg shadow-2xl border border-border overflow-hidden"
          style={{ top: Math.max(8, Math.min(pos.top - 150, window.innerHeight - 420)), left: Math.max(8, pos.left) }}
          onMouseEnter={() => { if (timerRef.current) clearTimeout(timerRef.current) }}
          onMouseLeave={handleLeave}
        >
          {/* Thumbnail PNG (endpoint cache backend) au lieu d'un <iframe>/preview :
              le plugin PDF du navigateur se décharge en grille/popover et force un hard refresh. */}
          <PdfThumbnail
            justificatifFilename={filename}
            alt="Aperçu PDF"
            className="w-[300px] h-[400px] rounded-none border-0 bg-white [&>img]:object-contain"
            iconSize={48}
            lazy={false}
          />
        </div>
      )}
    </>
  )
}


// ──── OCR List Tab (ex-HistoriqueTab) ────
// Affiche les scans OCR de l'exercice courant, pré-filtrés par statut
// (en_attente = sans opération liée, traites = avec opération liée).
// Utilisé par les 2 onglets `en-attente` et `traites` (split Session 30).

function OcrListTab({
  history,
  isLoading,
  initialSort,
  initialHighlight,
  statusFilter,
}: {
  history: OCRHistoryItem[]
  isLoading: boolean
  initialSort?: 'scan_date'
  initialHighlight?: string
  statusFilter: 'en_attente' | 'traites'
}) {
  const { selectedYear } = useFiscalYearStore()
  const extractOcr = useExtractOcr()
  const deleteMutation = useDeleteJustificatif()
  const [filterMonth, setFilterMonth] = useState<number | null>(null)
  const [filterSupplier, setFilterSupplier] = useState('')
  // Nouveau sort 'scan_date' : trie par `processed_at` (date de traitement OCR),
  // utilisé par le toast d'arrivée pour amener l'utilisateur directement sur les
  // scans les plus récents, indépendamment de l'exercice comptable.
  const [sortField, setSortField] = useState<'date' | 'supplier' | 'confidence' | 'scan_date'>(
    initialSort === 'scan_date' ? 'scan_date' : 'date',
  )
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [scanRenameOpen, setScanRenameOpen] = useState(false)
  // Drawer d'édition OCR (ouvert depuis le bouton Edit de chaque ligne)
  const [editItem, setEditItem] = useState<OCRHistoryItem | null>(null)
  // Highlight pour la navigation depuis le toast d'arrivée
  const [highlightFilename, setHighlightFilename] = useState<string | null>(
    initialHighlight ?? null,
  )

  // Recherche multifocale (libellé, catégorie, montant, fournisseur, filename)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 250)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Scroll-into-view + auto-clear highlight (3s) quand on arrive via toast
  useEffect(() => {
    if (!highlightFilename) return
    const row = document.getElementById(`ocr-hist-row-${highlightFilename}`)
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    const t = setTimeout(() => setHighlightFilename(null), 3500)
    return () => clearTimeout(t)
  }, [highlightFilename])

  // Enrichir avec année/mois — source canonique alignée sur le widget Pipeline :
  // on privilégie `best_date` (OCR parsé) avant de tomber sur le filename.
  const enriched = useMemo(() => {
    return (history || []).map(item => {
      const { year, month } = periodOf(item)
      return { ...item, _year: year, _month: month }
    })
  }, [history])

  // Items de l'année courante (avant filtres month/supplier/search) — base pour les reverse-lookups
  const yearItems = useMemo(
    () => enriched.filter(i => i._year === selectedYear),
    [enriched, selectedYear]
  )

  // Fetch parallèle des reverse-lookups pour permettre le filtre multifocal
  // (catégorie + libellé viennent de l'opération liée, pas du résultat OCR).
  // Même queryKey que `useReverseLookup` → React Query dédoublonne avec les
  // HistoriqueOperationCell qui affichent la colonne "Opération" (zéro surcoût réseau).
  const lookupQueries = useQueries({
    queries: yearItems.map(item => ({
      queryKey: ['justificatif-reverse-lookup', item.filename],
      queryFn: () =>
        api.get<ReverseLookupResult[]>(
          `/justificatifs/reverse-lookup/${item.filename}`
        ),
      enabled: !!item.filename,
      staleTime: 60_000,
    })),
  })

  const lookupByFilename = useMemo(() => {
    const map = new Map<string, ReverseLookupResult[]>()
    yearItems.forEach((item, i) => {
      const data = lookupQueries[i]?.data
      if (data && data.length > 0) map.set(item.filename, data)
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearItems, lookupQueries.map(q => q.data).join('|')])

  // Items après les filtres mois + fournisseur — c'est le scope sur lequel on
  // calcule les compteurs Tous/Sans assoc./Avec assoc. (pour qu'ils reflètent
  // le mois courant) ET la base du filtre association + recherche.
  const scopedItems = useMemo(() => {
    let items = yearItems
    if (filterMonth) items = items.filter(item => item._month === filterMonth)
    if (filterSupplier) items = items.filter(item => (item.supplier || '').toLowerCase().includes(filterSupplier.toLowerCase()))
    return items
  }, [yearItems, filterMonth, filterSupplier])

  // Compteur post-filtres mois/fournisseur + statusFilter (pré-recherche) —
  // affiché dans la barre de filtres pour que l'utilisateur voit combien
  // d'items correspondent réellement au statut actif de l'onglet.
  const scopedCount = useMemo(() => {
    return scopedItems.filter(item => {
      const lookups = lookupByFilename.get(item.filename)
      const isAssociated = !!(lookups && lookups.length > 0)
      return statusFilter === 'traites' ? isAssociated : !isAssociated
    }).length
  }, [scopedItems, lookupByFilename, statusFilter])

  // Filtrer par statut (prop `statusFilter`) + recherche multifocale.
  // Exception : quand le sort est 'scan_date', on IGNORE les filtres
  // mois/fournisseur/année pour afficher tous les scans récents (vue "récents").
  const filtered = useMemo(() => {
    // Si sort = scan_date → vue récents : ignorer les filtres exercice
    // et tirer depuis enriched (tous les items, toutes années confondues).
    let items = sortField === 'scan_date' ? enriched : scopedItems

    // Filtrage STATUT fige par l'onglet (remplace l'ancien segment
    // tous/sans/avec). en_attente = aucune op liée ; traites = ≥1 op liée.
    items = items.filter(item => {
      const lookups = lookupByFilename.get(item.filename)
      const isAssociated = !!(lookups && lookups.length > 0)
      return statusFilter === 'traites' ? isAssociated : !isAssociated
    })

    // Recherche multifocale : libellé, catégorie, sous-catégorie, fournisseur, montant
    // (on exclut volontairement le filename pour éviter les faux positifs avec les dates
    // type uber_20251107_... qui matchent "107")
    // Normalisation lowercase + accent-insensitive : "vehicule" matche "Véhicule".
    const normalize = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const q = normalize(debouncedSearch.trim())
    if (q) {
      const terms = q.split(/\s+/).filter(Boolean)
      items = items.filter(item => {
        const haystack: string[] = [
          normalize(item.supplier || ''),
        ]
        if (item.best_amount != null) {
          haystack.push(String(item.best_amount))
          haystack.push(item.best_amount.toFixed(2))
          haystack.push(item.best_amount.toFixed(2).replace('.', ','))
        }
        const lookups = lookupByFilename.get(item.filename)
        if (lookups) {
          for (const lu of lookups) {
            if (lu.libelle) haystack.push(normalize(lu.libelle))
            if (lu.categorie) haystack.push(normalize(lu.categorie))
            if (lu.sous_categorie) haystack.push(normalize(lu.sous_categorie))
            // Montants de l'op liée (débit/crédit) pour matcher par prix comptable
            if (lu.debit) {
              haystack.push(String(lu.debit))
              haystack.push(lu.debit.toFixed(2))
            }
            if (lu.credit) {
              haystack.push(String(lu.credit))
              haystack.push(lu.credit.toFixed(2))
            }
          }
        }
        const joined = haystack.join(' ')
        return terms.every(term => joined.includes(term))
      })
    }

    // Tri
    items = [...items]
    items.sort((a, b) => {
      let cmp = 0
      if (sortField === 'date') {
        // 'date' = best_date (date OCR de la facture)
        cmp = (a.best_date || '').localeCompare(b.best_date || '')
      } else if (sortField === 'scan_date') {
        // 'scan_date' = processed_at (date de traitement OCR)
        cmp = (a.processed_at || '').localeCompare(b.processed_at || '')
      } else if (sortField === 'supplier') {
        cmp = (a.supplier || '').localeCompare(b.supplier || '')
      } else if (sortField === 'confidence') {
        cmp = a.confidence - b.confidence
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return items
  }, [scopedItems, enriched, statusFilter, debouncedSearch, lookupByFilename, sortField, sortDir])

  // Extraire les fournisseurs uniques pour le filtre
  const suppliers = useMemo(() => {
    const set = new Set<string>()
    enriched.filter(i => i._year === selectedYear).forEach(i => { if (i.supplier) set.add(i.supplier) })
    return [...set].sort()
  }, [enriched, selectedYear])

  // Extraire les mois disponibles
  const availableMonths = useMemo(() => {
    const set = new Set<number>()
    enriched.filter(i => i._year === selectedYear).forEach(i => { if (i._month) set.add(i._month) })
    return [...set].sort((a, b) => a - b)
  }, [enriched, selectedYear])

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-text-muted py-8 justify-center">
        <Loader2 size={16} className="animate-spin" />
        Chargement de l'historique...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Barre de filtres */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <Filter size={12} />
          <span className="font-medium">{selectedYear}</span>
        </div>
        <select
          value={filterMonth ?? ''}
          onChange={(e) => setFilterMonth(e.target.value ? parseInt(e.target.value) : null)}
          className="bg-background border border-border rounded-md px-2 py-1 text-xs text-text focus:outline-none focus:border-primary"
        >
          <option value="">Tous les mois</option>
          {availableMonths.map(m => (
            <option key={m} value={m}>{MOIS_FR[m - 1]}</option>
          ))}
        </select>
        <select
          value={filterSupplier}
          onChange={(e) => setFilterSupplier(e.target.value)}
          className="bg-background border border-border rounded-md px-2 py-1 text-xs text-text focus:outline-none focus:border-primary"
        >
          <option value="">Tous les fournisseurs</option>
          {suppliers.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Compteur global (items après filtres mois/fournisseur) — le statut
            en_attente / traites est déjà filtré par l'onglet actif. */}
        <span className="text-xs text-text-muted px-2 py-1 bg-background border border-border rounded">
          {scopedCount} {statusFilter === 'en_attente' ? 'sans assoc.' : 'associé(s)'}
        </span>

        {/* Toggle tri par date de scan — ignore les filtres exercice comptable
            pour afficher les scans les plus récemment traités (processed_at desc).
            Utilisé par le toast d'arrivée d'un nouveau scan. */}
        <button
          onClick={() => toggleSort(sortField === 'scan_date' ? 'date' : 'scan_date')}
          className={cn(
            'px-2.5 py-1 text-xs rounded border transition-colors flex items-center gap-1.5',
            sortField === 'scan_date'
              ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
              : 'bg-background border-border text-text-muted hover:text-text',
          )}
          title="Trier par date de traitement OCR (récents en premier) — ignore les filtres année/mois/fournisseur"
        >
          <ScanLine size={12} />
          Date de scan
          {sortField === 'scan_date' && (sortDir === 'desc' ? ' ↓' : ' ↑')}
        </button>

        {/* Recherche multifocale : libellé, catégorie, montant, fournisseur */}
        <div className="relative flex-1 min-w-[200px] max-w-[340px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher (libellé, catégorie, montant…)"
            className="w-full bg-background border border-border rounded-md pl-7 pr-7 py-1 text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-primary"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text"
              title="Effacer"
              type="button"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <button
          onClick={() => setScanRenameOpen(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-warning text-background shadow-sm shadow-warning/25 hover:bg-warning/90 hover:shadow-warning/40 hover:scale-[1.02] transition-all"
          title="Scanner et renommer les justificatifs selon la convention fournisseur_YYYYMMDD_montant.XX.pdf"
        >
          <Wand2 size={13} />
          Scanner & Renommer
        </button>
        <span className="text-[10px] text-text-muted">
          {filtered.length} justificatif{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Tableau */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-text-muted py-12">
          <Clock size={40} className="opacity-30" />
          <p className="text-sm">Aucune extraction OCR pour {selectedYear}{filterMonth ? ` — ${MOIS_FR[filterMonth - 1]}` : ''}</p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted text-xs">
                  <th className="text-left px-4 py-3 font-medium">Fichier</th>
                  <th className="text-center px-1 py-3 font-medium w-8"></th>
                  <th
                    className="text-left px-4 py-3 font-medium cursor-pointer hover:text-text"
                    onClick={() => toggleSort('date')}
                  >
                    Date {sortField === 'date' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Montants</th>
                  <th
                    className="text-left px-4 py-3 font-medium cursor-pointer hover:text-text"
                    onClick={() => toggleSort('supplier')}
                  >
                    Fournisseur {sortField === 'supplier' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th
                    className="text-center px-4 py-3 font-medium cursor-pointer hover:text-text"
                    onClick={() => toggleSort('confidence')}
                  >
                    Confiance {sortField === 'confidence' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="text-center px-4 py-3 font-medium">Actions</th>
                  <th className="text-left px-4 py-3 font-medium">Opération</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => (
                  <tr
                    key={item.filename}
                    id={`ocr-hist-row-${item.filename}`}
                    className={cn(
                      'group border-b border-border/50 hover:bg-surface-hover transition-colors',
                      highlightFilename === item.filename && 'flash-highlight',
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <FilenameEditor
                          filename={item.filename}
                          ocrData={{
                            supplier: item.supplier,
                            best_date: item.best_date,
                            best_amount: item.best_amount,
                          }}
                          originalFilename={item.original_filename}
                          compact
                        />
                        {isLegacyPseudoCanonical(item.filename) && (
                          <button
                            type="button"
                            onClick={() => setEditItem(item)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors shrink-0"
                            title="Nom pseudo-canonique (suffix timestamp sandbox) — cliquer pour corriger via l'éditeur OCR"
                          >
                            <AlertTriangle size={10} />
                            Pseudo-canonique
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-3 text-center w-8">
                      <PdfPreviewHover filename={item.filename} />
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {item._month && item._year
                        ? `${String(item._month).padStart(2, '0')}/${item._year}`
                        : item.processed_at ? new Date(item.processed_at).toLocaleDateString('fr-FR') : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {item.amounts_found.slice(0, 2).map((a, j) => (
                          <span key={j} className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded text-[10px]">
                            {formatCurrency(a)}
                          </span>
                        ))}
                        {item.amounts_found.length > 2 && (
                          <span className="text-[10px] text-text-muted">+{item.amounts_found.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted max-w-[140px] truncate" title={item.supplier || ''}>
                      {item.supplier || '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="w-10 h-1.5 bg-background rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              item.confidence >= 0.8 ? 'bg-emerald-500' :
                              item.confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-400'
                            )}
                            style={{ width: `${Math.round(item.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-text-muted">{Math.round(item.confidence * 100)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setEditItem(item)}
                          className="p-1.5 text-text-muted hover:text-primary transition-colors"
                          title="Éditer les données OCR"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => extractOcr.mutate(item.filename)}
                          disabled={extractOcr.isPending}
                          className="p-1.5 text-text-muted hover:text-primary transition-colors"
                          title="Relancer l'extraction"
                        >
                          {extractOcr.isPending ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <RotateCcw size={13} />
                          )}
                        </button>
                        <button
                          onClick={() => {
                            const fname = item.filename
                            const lookups = lookupByFilename.get(fname)
                            const opLibelle = lookups?.[0]?.libelle ?? null
                            showDeleteConfirmToast(fname, opLibelle, () => {
                              deleteMutation.mutate(fname, {
                                onSuccess: (result) => showDeleteSuccessToast(result),
                                onError: (err: Error) => toast.error(`Erreur : ${err.message}`),
                              })
                            })
                          }}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                          title="Supprimer le justificatif"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <HistoriqueOperationCell filename={item.filename} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drawer scan & rename */}
      <ScanRenameDrawer open={scanRenameOpen} onClose={() => setScanRenameOpen(false)} />
      <OcrEditDrawer open={!!editItem} item={editItem} onClose={() => setEditItem(null)} />
    </div>
  )
}

function HistoriqueOperationCell({ filename }: { filename: string }) {
  const { data: results } = useReverseLookup(filename)
  const isAssociated = (results?.length ?? 0) > 0
  return (
    <JustificatifOperationLink
      justificatifFilename={filename}
      isAssociated={isAssociated}
    />
  )
}
