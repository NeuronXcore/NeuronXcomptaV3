import { useState, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import {
  useOcrStatus, useOcrHistory, useExtractOcr, useExtractUpload,
  useBatchUploadOcr,
} from '@/hooks/useOcr'
import type { BatchUploadResult } from '@/hooks/useOcr'
import { useJustificatifs } from '@/hooks/useJustificatifs'
import { formatCurrency, cn } from '@/lib/utils'
import {
  ScanLine, FileSearch, Clock, CheckCircle, AlertCircle,
  Loader2, Zap, Database, Upload, RotateCcw, FileText,
  ArrowRight, DollarSign, Calendar, User,
} from 'lucide-react'
import TemplatesTab from './TemplatesTab'
import type { OCRResult, OCRHistoryItem } from '@/types'

type Tab = 'upload' | 'test' | 'historique' | 'templates'

export default function OcrPage() {
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const preFile = searchParams.get('file')
  const preIndex = searchParams.get('index')
  const preTemplate = searchParams.get('template')

  const [activeTab, setActiveTab] = useState<Tab>(preFile ? 'templates' : 'upload')
  const { data: status } = useOcrStatus()
  const { data: history, isLoading: historyLoading } = useOcrHistory(30)

  return (
    <div className="p-6 max-w-7xl mx-auto">
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

      {/* Tabs */}
      <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border mb-6 w-fit">
        {([
          { key: 'upload' as Tab, label: 'Upload & OCR', icon: Upload },
          { key: 'test' as Tab, label: 'Test Manuel', icon: ScanLine },
          { key: 'historique' as Tab, label: 'Historique', icon: Clock },
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
          </button>
        ))}
      </div>

      {activeTab === 'upload' ? (
        <BatchUploadTab />
      ) : activeTab === 'test' ? (
        <TestManuelTab />
      ) : activeTab === 'templates' ? (
        <TemplatesTab preFile={preFile} preIndex={preIndex} preTemplate={preTemplate} />
      ) : (
        <HistoriqueTab history={history || []} isLoading={historyLoading} />
      )}
    </div>
  )
}


// ──── Batch Upload Tab ────

function BatchUploadTab() {
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


// ──── Historique Tab ────

function HistoriqueTab({ history, isLoading }: { history: OCRHistoryItem[]; isLoading: boolean }) {
  const extractOcr = useExtractOcr()

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-text-muted py-8 justify-center">
        <Loader2 size={16} className="animate-spin" />
        Chargement de l'historique...
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 text-text-muted py-12">
        <Clock size={40} className="opacity-30" />
        <p className="text-sm">Aucune extraction OCR réalisée</p>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs">
              <th className="text-left px-4 py-3 font-medium">Fichier</th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Dates trouvées</th>
              <th className="text-left px-4 py-3 font-medium">Montants</th>
              <th className="text-left px-4 py-3 font-medium">Fournisseur</th>
              <th className="text-center px-4 py-3 font-medium">Confiance</th>
              <th className="text-right px-4 py-3 font-medium">Temps</th>
              <th className="text-center px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-surface-hover transition-colors">
                <td className="px-4 py-3">
                  <span className="text-text text-xs truncate max-w-[180px] block" title={item.filename}>
                    {item.filename.length > 30
                      ? item.filename.slice(0, 15) + '...' + item.filename.slice(-12)
                      : item.filename}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted text-xs">
                  {item.processed_at ? new Date(item.processed_at).toLocaleDateString('fr-FR') : '-'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {item.dates_found.slice(0, 2).map((d, j) => (
                      <span key={j} className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">{d}</span>
                    ))}
                    {item.dates_found.length > 2 && (
                      <span className="text-[10px] text-text-muted">+{item.dates_found.length - 2}</span>
                    )}
                  </div>
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
                <td className="px-4 py-3 text-xs text-text-muted max-w-[120px] truncate" title={item.supplier || ''}>
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
                <td className="px-4 py-3 text-right text-xs text-text-muted">
                  {item.processing_time_ms}ms
                </td>
                <td className="px-4 py-3 text-center">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
