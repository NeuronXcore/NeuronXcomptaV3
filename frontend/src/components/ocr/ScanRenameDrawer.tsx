import { useEffect, useState } from 'react'
import {
  X,
  Wand2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useScanRename, useApplyScanRename } from '@/hooks/useOcr'
import type { ScanRenamePlan } from '@/hooks/useOcr'

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

  // Lance le scan à chaque ouverture du drawer (reset aussi la checkbox)
  useEffect(() => {
    if (!open) return
    setPlan(null)
    setIncludeOcr(false)
    setSkippedOpen(false)
    scan.mutate(undefined, {
      onSuccess: (data) => setPlan(data),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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

      {/* Drawer */}
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

              {/* Section Skipped */}
              {skippedTotal > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setSkippedOpen((v) => !v)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium text-text-muted hover:bg-surface/60 transition-colors"
                  >
                    {skippedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Fichiers ignorés ({skippedTotal}) — action manuelle requise
                  </button>
                  {skippedOpen && (
                    <div className="px-3 py-2 border-t border-border space-y-2">
                      {plan.skipped.no_ocr.length > 0 && (
                        <SkippedList
                          title="OCR manquant"
                          items={plan.skipped.no_ocr}
                        />
                      )}
                      {plan.skipped.bad_supplier.length > 0 && (
                        <SkippedList
                          title="Supplier OCR douteux"
                          items={plan.skipped.bad_supplier.map(
                            (b) => `${b.filename} (supplier: ${b.supplier || '—'})`,
                          )}
                        />
                      )}
                      {plan.skipped.no_date_amount.length > 0 && (
                        <SkippedList
                          title="Date ou montant OCR manquant"
                          items={plan.skipped.no_date_amount}
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

function SkippedList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted font-medium mb-1">
        {title} ({items.length})
      </div>
      <ul className="space-y-0.5 text-[11px] text-text-muted">
        {items.map((item, i) => (
          <li key={i} className="truncate font-mono">
            • {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
