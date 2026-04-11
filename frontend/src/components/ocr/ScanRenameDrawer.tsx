import { useEffect, useMemo, useState } from 'react'
import {
  X,
  Wand2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  FileText,
  Save,
  Maximize2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn, formatCurrency, buildConventionFilename } from '@/lib/utils'
import { useScanRename, useApplyScanRename } from '@/hooks/useOcr'
import type { ScanRenamePlan, SkippedItem } from '@/hooks/useOcr'
import { useCategories } from '@/hooks/useApi'
import { useOperationFiles, useYearOperations } from '@/hooks/useOperations'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useManualAssociate } from '@/hooks/useRapprochement'
import { useUpdateOcrData } from '@/hooks/useOcr'
import { useRenameJustificatif } from '@/hooks/useJustificatifs'
import PreviewSubDrawer from './PreviewSubDrawer'
import type { CategoryRaw, Operation } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ScanRenameDrawer({ open, onClose }: Props) {
  const scan = useScanRename()
  const apply = useApplyScanRename()
  const [plan, setPlan] = useState<ScanRenamePlan | null>(null)
  const [includeOcr, setIncludeOcr] = useState(false)
  const [skippedOpen, setSkippedOpen] = useState(false)
  // State du sous-drawer de preview PDF grand format (clic sur mini thumbnail)
  const [previewFilename, setPreviewFilename] = useState<string | null>(null)

  // Lance le scan à chaque ouverture du drawer (reset aussi la checkbox + preview)
  useEffect(() => {
    if (!open) {
      // Reset preview quand le main drawer ferme
      setPreviewFilename(null)
      return
    }
    setPlan(null)
    setIncludeOcr(false)
    setSkippedOpen(false)
    setPreviewFilename(null)
    scan.mutate(undefined, {
      onSuccess: (data) => setPlan(data),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Esc ferme le sous-drawer (et pas le main drawer) quand il est ouvert.
  // Capture mode : intercepte Esc AVANT que d'autres handlers remontent.
  useEffect(() => {
    if (!previewFilename) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setPreviewFilename(null)
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [previewFilename])

  const handleApply = () => {
    apply.mutate(
      { applyOcr: includeOcr },
      {
        onSuccess: (data) => {
          setPlan(data)
          // Si tout est appliqué et il ne reste rien à faire, fermer
          const remainingSafe = data.to_rename_safe.length
          const remainingOcr = includeOcr ? data.to_rename_ocr.length : 0
          if (remainingSafe === 0 && remainingOcr === 0) {
            setTimeout(() => onClose(), 800)
          }
        },
      },
    )
  }

  // Relance le scan dry-run après qu'un item skipped a été complété manuellement
  // (édition OCR data / association op). Met à jour le plan → l'item sort du
  // bucket skipped et apparaît dans SAFE ou OCR (ou disparaît s'il a été associé).
  const handleRescan = () => {
    scan.mutate(undefined, { onSuccess: setPlan })
  }

  const isLoading = scan.isPending && !plan
  const isApplying = apply.isPending
  const safeCount = plan?.to_rename_safe.length ?? 0
  const ocrCount = plan?.to_rename_ocr.length ?? 0
  const canApply =
    !!plan && !isApplying && (safeCount > 0 || (includeOcr && ocrCount > 0))

  const skippedTotal =
    (plan?.skipped.no_ocr.length ?? 0) +
    (plan?.skipped.bad_supplier.length ?? 0) +
    (plan?.skipped.no_date_amount.length ?? 0)

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Sous-drawer de preview PDF grand format (slide depuis la gauche du main) */}
      <PreviewSubDrawer
        filename={previewFilename}
        mainDrawerOpen={open}
        onClose={() => setPreviewFilename(null)}
      />

      {/* Drawer principal */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[680px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wand2 size={18} className="text-violet-400" />
              <h2 className="text-sm font-semibold text-text">
                Scanner & Renommer
              </h2>
              <span className="text-[11px] text-text-muted">
                convention <code className="px-1 bg-surface rounded">fournisseur_YYYYMMDD_montant.XX.pdf</code>
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-text-muted py-10 justify-center">
              <Loader2 size={16} className="animate-spin" />
              Scan en cours…
            </div>
          )}

          {!isLoading && scan.isError && (
            <div className="flex items-center gap-2 text-red-400 py-6 justify-center">
              <AlertTriangle size={16} />
              Erreur lors du scan : {scan.error?.message ?? 'inconnue'}
            </div>
          )}

          {plan && (
            <>
              {/* Bandeau résumé */}
              <div className="grid grid-cols-3 gap-2">
                <SummaryCard label="Scannés" value={plan.scanned} />
                <SummaryCard
                  label="Déjà canoniques"
                  value={plan.already_canonical}
                  tone="success"
                />
                <SummaryCard
                  label="À renommer"
                  value={safeCount + ocrCount}
                  tone={safeCount + ocrCount > 0 ? 'warning' : 'muted'}
                />
              </div>

              {/* Section SAFE */}
              {safeCount > 0 ? (
                <Section
                  title="Renames SAFE"
                  subtitle="Parsés depuis le nom de fichier existant"
                  badge={safeCount}
                  tone="success"
                >
                  <div className="space-y-1">
                    {plan.to_rename_safe.map((item) => (
                      <RenameRow key={item.old} old={item.old} next={item.new} tone="success" />
                    ))}
                  </div>
                </Section>
              ) : plan.scanned > 0 && !apply.isSuccess ? (
                <div className="flex items-center gap-2 text-text-muted text-xs bg-surface/60 rounded-lg px-3 py-2">
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  Aucun rename SAFE nécessaire — tous les noms parsables sont déjà canoniques
                </div>
              ) : null}

              {/* Section OCR */}
              {ocrCount > 0 && (
                <Section
                  title="Renames OCR"
                  subtitle="Reconstruits depuis l'OCR — review recommandé (le filename n'est pas structuré)"
                  badge={ocrCount}
                  tone="warning"
                >
                  <label className="flex items-center gap-2 text-xs text-text cursor-pointer bg-warning/5 border border-warning/20 rounded-md px-3 py-2 mb-2">
                    <input
                      type="checkbox"
                      checked={includeOcr}
                      onChange={(e) => setIncludeOcr(e.target.checked)}
                      className="h-3.5 w-3.5 accent-warning"
                    />
                    Inclure les renames OCR dans l'application
                    <span className="text-[10px] text-text-muted ml-auto">
                      (confiance plus faible)
                    </span>
                  </label>
                  <div className="space-y-1">
                    {plan.to_rename_ocr.map((item) => (
                      <RenameRow
                        key={item.old}
                        old={item.old}
                        next={item.new}
                        tone="warning"
                        hint={`supplier OCR: ${item.supplier_ocr || '—'}`}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {/* Section Skipped — désormais éditable */}
              {skippedTotal > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setSkippedOpen((v) => !v)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium text-text-muted hover:bg-surface/60 transition-colors"
                  >
                    {skippedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Fichiers ignorés ({skippedTotal}) — action manuelle possible
                  </button>
                  {skippedOpen && (
                    <div className="px-3 py-2 border-t border-border space-y-3">
                      {plan.skipped.bad_supplier.length > 0 && (
                        <SkippedEditableList
                          title="Supplier OCR douteux"
                          items={plan.skipped.bad_supplier}
                          onItemUpdated={handleRescan}
                          onPreviewRequest={setPreviewFilename}
                          currentPreview={previewFilename}
                        />
                      )}
                      {plan.skipped.no_date_amount.length > 0 && (
                        <SkippedEditableList
                          title="Date ou montant OCR manquant"
                          items={plan.skipped.no_date_amount}
                          onItemUpdated={handleRescan}
                          onPreviewRequest={setPreviewFilename}
                          currentPreview={previewFilename}
                        />
                      )}
                      {plan.skipped.no_ocr.length > 0 && (
                        <SkippedEditableList
                          title="OCR manquant"
                          items={plan.skipped.no_ocr}
                          onItemUpdated={handleRescan}
                          onPreviewRequest={setPreviewFilename}
                          currentPreview={previewFilename}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Résultat de l'apply */}
              {plan.applied && (
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 text-xs',
                    plan.applied.errors.length === 0
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                      : 'bg-warning/10 border border-warning/20 text-warning',
                  )}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 size={14} />
                    {plan.applied.ok} renommage(s) appliqué(s)
                    {plan.applied.errors.length > 0 && (
                      <span className="text-red-400">
                        · {plan.applied.errors.length} erreur(s)
                      </span>
                    )}
                  </div>
                  {plan.applied.errors.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-[10px] text-red-400">
                      {plan.applied.errors.map((e, i) => (
                        <li key={i}>
                          {e.old} → {e.new} : {e.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between gap-3">
          <div className="text-xs text-text-muted">
            {plan && (
              <>
                {safeCount > 0 && (
                  <span>
                    {safeCount} safe
                    {includeOcr && ocrCount > 0 && ` + ${ocrCount} OCR`}
                  </span>
                )}
                {safeCount === 0 && includeOcr && ocrCount > 0 && (
                  <span>{ocrCount} OCR</span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs border border-border rounded-lg text-text-muted hover:text-text hover:bg-surface transition-colors"
            >
              Fermer
            </button>
            <button
              onClick={handleApply}
              disabled={!canApply}
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg transition-colors font-medium',
                canApply
                  ? 'bg-primary text-white hover:bg-primary/90'
                  : 'bg-surface text-text-muted cursor-not-allowed',
              )}
            >
              {isApplying ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Wand2 size={12} />
              )}
              Appliquer
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Sous-composants ───────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'success' | 'warning' | 'muted'
}) {
  const toneClasses = {
    default: 'bg-surface text-text',
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    muted: 'bg-surface text-text-muted',
  }[tone]
  return (
    <div
      className={cn(
        'rounded-lg border border-border px-3 py-2 text-center',
        toneClasses,
      )}
    >
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide opacity-80">
        {label}
      </div>
    </div>
  )
}

function Section({
  title,
  subtitle,
  badge,
  tone,
  children,
}: {
  title: string
  subtitle?: string
  badge: number
  tone: 'success' | 'warning'
  children: React.ReactNode
}) {
  const badgeClasses = {
    success: 'bg-emerald-500/15 text-emerald-400',
    warning: 'bg-warning/15 text-warning',
  }[tone]
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-xs font-semibold text-text uppercase tracking-wide">
          {title}
        </h3>
        <span
          className={cn(
            'text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums',
            badgeClasses,
          )}
        >
          {badge}
        </span>
        {subtitle && (
          <span className="text-[10px] text-text-muted ml-auto">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  )
}

function RenameRow({
  old,
  next,
  tone,
  hint,
}: {
  old: string
  next: string
  tone: 'success' | 'warning'
  hint?: string
}) {
  const borderTone =
    tone === 'success' ? 'border-l-emerald-500/50' : 'border-l-warning/50'
  return (
    <div
      className={cn(
        'bg-surface/40 rounded-md border border-border border-l-[3px] px-3 py-2',
        borderTone,
      )}
    >
      <div className="flex items-center gap-2 text-xs text-text-muted truncate">
        <span className="truncate">{old}</span>
      </div>
      <div className="flex items-center gap-2 mt-1 text-xs">
        <ArrowRight size={12} className="text-text-muted shrink-0" />
        <span className="text-text font-mono truncate">{next}</span>
      </div>
      {hint && (
        <div className="text-[10px] text-text-muted mt-1 italic truncate">
          {hint}
        </div>
      )}
    </div>
  )
}

// ─── Skipped items éditables ───────────────────────────────────────────

function SkippedEditableList({
  title,
  items,
  onItemUpdated,
  onPreviewRequest,
  currentPreview,
}: {
  title: string
  items: SkippedItem[]
  onItemUpdated: () => void
  onPreviewRequest: (filename: string | null) => void
  currentPreview: string | null
}) {
  const [expandedFilename, setExpandedFilename] = useState<string | null>(null)
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted font-medium mb-1">
        {title} ({items.length})
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <SkippedItemCard
            key={item.filename}
            item={item}
            isExpanded={expandedFilename === item.filename}
            onToggle={() =>
              setExpandedFilename(
                expandedFilename === item.filename ? null : item.filename,
              )
            }
            onUpdated={() => {
              setExpandedFilename(null)
              onItemUpdated()
            }}
            onPreviewRequest={onPreviewRequest}
            isPreviewActive={currentPreview === item.filename}
          />
        ))}
      </div>
    </div>
  )
}

function SkippedItemCard({
  item,
  isExpanded,
  onToggle,
  onUpdated,
  onPreviewRequest,
  isPreviewActive,
}: {
  item: SkippedItem
  isExpanded: boolean
  onToggle: () => void
  onUpdated: () => void
  onPreviewRequest: (filename: string | null) => void
  isPreviewActive: boolean
}) {
  return (
    <div className="bg-surface/40 rounded-md border border-border border-l-[3px] border-l-warning/50 overflow-hidden">
      {/* Header cliquable */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface/60 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown size={12} className="text-text-muted shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-text-muted shrink-0" />
        )}
        <span className="text-xs font-mono text-text truncate flex-1">
          {item.filename}
        </span>
        {item.supplier && (
          <span className="text-[10px] text-text-muted shrink-0">
            {item.supplier}
          </span>
        )}
      </button>

      {/* Contenu expand */}
      {isExpanded && (
        <SkippedItemEditor
          item={item}
          onUpdated={onUpdated}
          onPreviewRequest={onPreviewRequest}
          isPreviewActive={isPreviewActive}
        />
      )}
    </div>
  )
}

function SkippedItemEditor({
  item,
  onUpdated,
  onPreviewRequest,
  isPreviewActive,
}: {
  item: SkippedItem
  onUpdated: () => void
  onPreviewRequest: (filename: string | null) => void
  isPreviewActive: boolean
}) {
  // ── OCR data editing (supplier / date / montant) ──
  const [selectedAmount, setSelectedAmount] = useState<number | null>(item.best_amount)
  const [manualAmount, setManualAmount] = useState('')
  const [useManualAmount, setUseManualAmount] = useState(false)

  const [selectedDate, setSelectedDate] = useState<string | null>(item.best_date)
  const [manualDate, setManualDate] = useState('')
  const [useManualDate, setUseManualDate] = useState(false)

  const [supplier, setSupplier] = useState(item.supplier || '')

  // ── Catégorie / sous-catégorie hints (pré-filtrent l'op selector) ──
  const [catFilter, setCatFilter] = useState('')
  const [subCatFilter, setSubCatFilter] = useState('')

  // ── Sélection opération cible ──
  const [selectedOpKey, setSelectedOpKey] = useState<string>('')

  // Hooks data
  const { data: categoriesData } = useCategories()
  const { selectedYear } = useFiscalYearStore()
  const { data: files = [] } = useOperationFiles()
  const monthsForYear = useMemo(
    () => files.filter((f) => f.year === selectedYear),
    [files, selectedYear],
  )
  const { data: yearOps } = useYearOperations(monthsForYear, true)

  // Hooks mutations
  const updateOcrMutation = useUpdateOcrData()
  const associateMutation = useManualAssociate()
  const renameMutation = useRenameJustificatif()

  // Dates/amounts filtrées (cohérent avec OcrDataEditor)
  const filteredDates = useMemo(() => {
    const now = new Date()
    const maxDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
    return item.dates.filter((d) => {
      const parsed = new Date(d)
      return parsed.getFullYear() >= 2020 && parsed <= maxDate
    })
  }, [item.dates])

  // Effective values
  const effectiveAmount = useManualAmount
    ? parseFloat(manualAmount) || null
    : selectedAmount
  const effectiveDate = useManualDate ? manualDate : selectedDate

  const hasOcrChanges = useMemo(() => {
    if (effectiveAmount !== item.best_amount) return true
    if (effectiveDate !== item.best_date) return true
    if (supplier !== (item.supplier || '')) return true
    return false
  }, [effectiveAmount, effectiveDate, supplier, item])

  // Changements des hints cat/sous-cat. Note : le SkippedItem backend ne
  // remonte pas encore les hints existants, donc on considère juste qu'ils
  // ont été saisis (non vides) comme un changement à persister.
  const hasHintChanges = useMemo(() => {
    return catFilter !== '' || subCatFilter !== ''
  }, [catFilter, subCatFilter])

  // Catégories dérivées
  const categoryNames = useMemo(() => {
    if (!categoriesData) return []
    return [...new Set(categoriesData.raw.map((c: CategoryRaw) => c['Catégorie']))]
      .filter(Boolean)
      .sort()
  }, [categoriesData])

  const subcategoriesMap = useMemo(() => {
    if (!categoriesData) return new Map<string, string[]>()
    const map = new Map<string, string[]>()
    for (const c of categoriesData.raw) {
      const cat = c['Catégorie']
      const sub = c['Sous-catégorie']
      if (cat && sub && sub !== 'null') {
        if (!map.has(cat)) map.set(cat, [])
        const list = map.get(cat)!
        if (!list.includes(sub)) list.push(sub)
      }
    }
    for (const [, list] of map) list.sort()
    return map
  }, [categoriesData])

  // Opérations candidates (pas de justificatif, filtrées par cat/sous-cat si défini)
  interface EnrichedOp extends Operation {
    _originalIndex: number
    _filename: string
  }

  const opCandidates = useMemo<EnrichedOp[]>(() => {
    if (!yearOps) return []
    // Reconstruire _originalIndex (position dans le fichier source)
    const byFile = new Map<string, number>()
    const enriched: EnrichedOp[] = yearOps.map((op) => {
      const fname = op._sourceFile ?? ''
      const idx = byFile.get(fname) ?? 0
      byFile.set(fname, idx + 1)
      return { ...op, _originalIndex: idx, _filename: fname } as EnrichedOp
    })
    return enriched
      .filter((op) => !op['Lien justificatif'])
      .filter((op) => !catFilter || op['Catégorie'] === catFilter)
      .filter(
        (op) =>
          !subCatFilter ||
          !catFilter ||
          op['Sous-catégorie'] === subCatFilter,
      )
      .slice(0, 50)
  }, [yearOps, catFilter, subCatFilter])

  const isSaving =
    updateOcrMutation.isPending ||
    renameMutation.isPending ||
    associateMutation.isPending

  // Calcule le nom canonique qu'on aura après l'édition (si date + montant valides).
  // Sert à renommer physiquement avant l'association quand l'utilisateur valide.
  const plannedCanonicalName = useMemo(() => {
    const finalSupplier = supplier || item.supplier || ''
    const finalDate = effectiveDate || item.best_date
    const finalAmount = effectiveAmount ?? item.best_amount
    if (!finalDate || finalAmount == null) return null
    const canonical = buildConventionFilename(finalSupplier, finalDate, finalAmount)
    if (!canonical || canonical === item.filename) return null
    return canonical
  }, [supplier, effectiveDate, effectiveAmount, item])

  const handleValidate = async () => {
    let currentFilename = item.filename

    // 1. Update OCR data + hints cat/sous-cat si changements
    if (hasOcrChanges || hasHintChanges) {
      const data: Record<string, unknown> = {}
      if (effectiveAmount !== item.best_amount && effectiveAmount !== null) {
        data.best_amount = effectiveAmount
      }
      if (effectiveDate !== item.best_date && effectiveDate) {
        data.best_date = effectiveDate
      }
      if (supplier !== (item.supplier || '')) {
        data.supplier = supplier
      }
      if (hasHintChanges) {
        data.category_hint = catFilter
        data.sous_categorie_hint = subCatFilter
      }
      if (Object.keys(data).length > 0) {
        try {
          await updateOcrMutation.mutateAsync({ filename: currentFilename, data })
        } catch (err) {
          toast.error(`Erreur édition OCR : ${(err as Error).message}`)
          return
        }
      }
    }

    // 2. Rename vers le nom canonique si date + montant sont maintenant valides
    // ET qu'on va associer l'item (éviter de modifier les fichiers sans action finale).
    // Pour un simple "Enregistrer" sans op cible, on laisse le rename au bouton
    // "Appliquer" du drawer principal (2 étapes intentionnelles).
    if (selectedOpKey && plannedCanonicalName) {
      try {
        const result = await renameMutation.mutateAsync({
          filename: currentFilename,
          newFilename: plannedCanonicalName,
        })
        // Le backend peut avoir dédupliqué (ex: _2.pdf si collision)
        currentFilename = result.new
      } catch (err) {
        toast.error(`Erreur renommage : ${(err as Error).message}`)
        return
      }
    }

    // 3. Associate to operation if selected
    if (selectedOpKey) {
      const [opFile, opIdxStr] = selectedOpKey.split('::')
      const opIdx = parseInt(opIdxStr, 10)
      try {
        await associateMutation.mutateAsync({
          justificatif_filename: currentFilename,
          operation_file: opFile,
          operation_index: opIdx,
        })
        toast.success(
          plannedCanonicalName
            ? `Renommé en ${currentFilename} et associé`
            : 'Justificatif associé',
        )
      } catch (err) {
        toast.error(`Erreur association : ${(err as Error).message}`)
        return
      }
    } else if (hasOcrChanges || hasHintChanges) {
      toast.success('Données OCR mises à jour')
    }

    // 4. Re-scan pour rafraîchir le plan
    onUpdated()
  }

  const canValidate = hasOcrChanges || hasHintChanges || !!selectedOpKey

  // Thumbnail via endpoint qui résout automatiquement en_attente/traites.
  // Les skipped peuvent être dans n'importe lequel des 2 dossiers (scope="both").
  const thumbUrl = `/api/justificatifs/${encodeURIComponent(item.filename)}/thumbnail`

  return (
    <div className="border-t border-border px-3 py-3 space-y-3">
      <div className="flex gap-3">
        {/* Thumbnail 60×84 cliquable → ouvre le sous-drawer de preview PDF */}
        <button
          type="button"
          onClick={() =>
            onPreviewRequest(isPreviewActive ? null : item.filename)
          }
          className={cn(
            'shrink-0 w-[60px] h-[84px] bg-white rounded border overflow-hidden flex items-center justify-center group relative cursor-pointer transition-colors',
            isPreviewActive
              ? 'border-primary ring-2 ring-primary/40'
              : 'border-border hover:border-primary',
          )}
          title={isPreviewActive ? 'Fermer l\'aperçu' : 'Agrandir le PDF'}
        >
          <img
            src={thumbUrl}
            alt=""
            className="w-full h-full object-contain"
            onError={(e) => {
              const img = e.target as HTMLImageElement
              img.style.display = 'none'
              const fb = img.nextElementSibling as HTMLElement | null
              if (fb) fb.classList.remove('hidden')
            }}
          />
          <FileText size={20} className="hidden text-text-muted" />
          {/* Overlay hover */}
          <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <Maximize2 size={14} className="text-white" />
          </span>
        </button>

        {/* Éditeur OCR compact */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Fournisseur */}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
              Fournisseur
            </label>
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Nom du fournisseur"
              className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs text-text"
            />
          </div>

          {/* Date */}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
              Date facture
            </label>
            {filteredDates.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5 mb-1">
                {filteredDates.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSelectedDate(d)
                      setUseManualDate(false)
                      setManualDate('')
                    }}
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                      !useManualDate && selectedDate === d
                        ? 'bg-primary text-white border-primary'
                        : 'border-border text-text-muted hover:border-primary',
                    )}
                  >
                    {d.split('-').reverse().join('/')}
                  </button>
                ))}
              </div>
            )}
            <input
              type="date"
              value={manualDate}
              onChange={(e) => {
                setManualDate(e.target.value)
                setUseManualDate(true)
                setSelectedDate(null)
              }}
              className="mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs text-text"
            />
          </div>

          {/* Montant */}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
              Montant TTC
            </label>
            {item.amounts.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5 mb-1">
                {item.amounts.map((amt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSelectedAmount(amt)
                      setUseManualAmount(false)
                      setManualAmount('')
                    }}
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                      !useManualAmount && selectedAmount === amt
                        ? 'bg-primary text-white border-primary'
                        : 'border-border text-text-muted hover:border-primary',
                    )}
                  >
                    {formatCurrency(amt)}
                  </button>
                ))}
              </div>
            )}
            <input
              type="number"
              step="0.01"
              placeholder="Autre montant"
              value={manualAmount}
              onChange={(e) => {
                setManualAmount(e.target.value)
                setUseManualAmount(true)
                setSelectedAmount(null)
              }}
              className="mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs text-text w-32"
            />
          </div>
        </div>
      </div>

      {/* Catégorie / sous-catégorie (filtres op selector) */}
      <div className="grid grid-cols-2 gap-2">
        <select
          value={catFilter}
          onChange={(e) => {
            setCatFilter(e.target.value)
            setSubCatFilter('')
          }}
          className="bg-background border border-border rounded px-2 py-1 text-xs text-text"
        >
          <option value="">Catégorie (filtre ops)</option>
          {categoryNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={subCatFilter}
          onChange={(e) => setSubCatFilter(e.target.value)}
          disabled={!catFilter || (subcategoriesMap.get(catFilter) ?? []).length === 0}
          className="bg-background border border-border rounded px-2 py-1 text-xs text-text disabled:opacity-40"
        >
          <option value="">Sous-catégorie</option>
          {(subcategoriesMap.get(catFilter) ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Op selector */}
      <div>
        <label className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
          Associer à une opération ({opCandidates.length} candidate
          {opCandidates.length > 1 ? 's' : ''})
        </label>
        <select
          value={selectedOpKey}
          onChange={(e) => setSelectedOpKey(e.target.value)}
          className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs text-text"
        >
          <option value="">Ne pas associer maintenant</option>
          {opCandidates.map((op) => {
            const key = `${op._filename}::${op._originalIndex}`
            const amount = op['Débit'] || op['Crédit'] || 0
            return (
              <option key={key} value={key}>
                {op['Date']} · {(op['Libellé'] || '').slice(0, 40)} ·{' '}
                {formatCurrency(amount)}
                {op['Catégorie'] ? ` · ${op['Catégorie']}` : ''}
              </option>
            )
          })}
        </select>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {/* Aperçu du nouveau nom canonique */}
        {plannedCanonicalName && (
          <div className="text-[10px] text-text-muted flex items-center gap-1.5 min-w-0">
            <ArrowRight size={10} className="shrink-0" />
            <code className="truncate font-mono text-emerald-400">
              {plannedCanonicalName}
            </code>
          </div>
        )}
        <button
          onClick={handleValidate}
          disabled={!canValidate || isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ml-auto"
        >
          {isSaving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Save size={12} />
          )}
          {selectedOpKey
            ? plannedCanonicalName
              ? 'Renommer & associer'
              : 'Associer'
            : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}

// PreviewSubDrawer est désormais un composant partagé (components/ocr/PreviewSubDrawer.tsx)
// — il accepte un prop `mainDrawerWidth` pour se positionner à gauche du
// drawer parent. ScanRenameDrawer utilise 680px (la valeur par défaut).
