import { useState, useMemo, useEffect } from 'react'
import { X, FileText, ExternalLink, Info, Calendar, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useLiasseScpDrawerStore } from '@/stores/liasseScpDrawerStore'
import { useLiasseScp, useSaveLiasse, useDeleteLiasse } from '@/hooks/useLiasseScp'
import { useDashboard } from '@/hooks/useApi'
import { api } from '@/api/client'
import { formatCurrency, cn } from '@/lib/utils'

const YEAR_SOURCE_LABEL: Record<string, string> = {
  ged_year: 'détecté depuis le document (champ année)',
  ged_date: 'détecté depuis la date du document',
  ged_filename: 'détecté depuis le nom du fichier',
  fiscal_store: '',
}

// Normalise "312 580,00", "312580", "312580.00", "312 580.00" → 312580.00
function parseFrAmount(raw: string): number | null {
  if (!raw) return null
  const clean = raw.replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(clean)
  return Number.isFinite(n) ? n : null
}

// Format "312 580,00" pour l'affichage dans l'input
function formatFrAmount(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function availableYears(currentYear: number): number[] {
  const out: number[] = []
  for (let y = currentYear + 1; y >= currentYear - 4; y--) out.push(y)
  return out
}

export default function LiasseScpDrawer() {
  const { isOpen, initialYear, gedDocumentId, yearSource, close } = useLiasseScpDrawerStore()

  // State local : année corrigeable par l'utilisateur
  const [year, setYear] = useState<number | null>(null)
  const [caInput, setCaInput] = useState<string>('')
  const [noteInput, setNoteInput] = useState<string>('')
  // Quand l'utilisateur modifie manuellement l'année, on retire la pastille de détection
  const [userOverrodeYear, setUserOverrodeYear] = useState(false)

  // Initialiser au 1er open
  useEffect(() => {
    if (isOpen && initialYear !== null) {
      setYear(initialYear)
      setUserOverrodeYear(false)
    }
  }, [isOpen, initialYear])

  // Fermeture → reset input
  useEffect(() => {
    if (!isOpen) {
      setCaInput('')
      setNoteInput('')
      setYear(null)
      setUserOverrodeYear(false)
    }
  }, [isOpen])

  const { data: existingLiasse } = useLiasseScp(year)
  const { data: dashboard } = useDashboard(year)
  const saveMutation = useSaveLiasse()
  const deleteMutation = useDeleteLiasse()

  const honoraires_bancaires = dashboard?.bnc?.recettes_pro_bancaires ?? 0

  // Prérempli avec la valeur existante au chargement
  useEffect(() => {
    if (existingLiasse) {
      setCaInput(formatFrAmount(existingLiasse.ca_declare))
      setNoteInput(existingLiasse.note ?? '')
    } else {
      setCaInput('')
      setNoteInput('')
    }
  }, [existingLiasse?.ca_declare, existingLiasse?.note])

  const caValue = useMemo(() => parseFrAmount(caInput), [caInput])

  const ecart = useMemo(() => {
    if (caValue === null || !honoraires_bancaires) return null
    const abs = caValue - honoraires_bancaires
    const pct = honoraires_bancaires ? (abs / honoraires_bancaires) * 100 : 0
    return { abs, pct }
  }, [caValue, honoraires_bancaires])

  const ecartColor = useMemo(() => {
    if (!ecart) return 'text-text-muted'
    const absPct = Math.abs(ecart.pct)
    if (absPct > 10) return 'text-danger'
    if (absPct >= 5) return 'text-warning'
    return 'text-text-muted'
  }, [ecart])

  const isEdit = !!existingLiasse
  const canSave = caValue !== null && caValue > 0 && year !== null

  const handleSave = async () => {
    if (!canSave || year === null || caValue === null) return
    try {
      await saveMutation.mutateAsync({
        year,
        ca_declare: caValue,
        ged_document_id: gedDocumentId,
        note: noteInput || null,
      })
      toast.success(isEdit ? 'CA mis à jour' : 'CA enregistré')
      close()
    } catch (e) {
      toast.error(`Erreur : ${(e as Error).message}`)
    }
  }

  const handleDelete = async () => {
    if (year === null) return
    if (!confirm(`Supprimer la liasse ${year} ? Le BNC retombera en base bancaire provisoire.`)) return
    try {
      await deleteMutation.mutateAsync(year)
      toast.success('Liasse supprimée')
      close()
    } catch (e) {
      toast.error(`Erreur : ${(e as Error).message}`)
    }
  }

  const handleOpenGed = () => {
    if (!gedDocumentId) return
    // Endpoint existant : POST /api/ged/documents/{id}/open-native
    api.post(`/ged/documents/${encodeURIComponent(gedDocumentId)}/open-native`).catch(() => {
      toast.error("Impossible d'ouvrir le document")
    })
  }

  if (!isOpen) return null

  const currentYear = new Date().getFullYear()
  const years = availableYears(currentYear)
  const showDetectionBadge = yearSource && yearSource !== 'fiscal_store' && !userOverrodeYear

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={close} />

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[520px] max-w-[98vw] bg-background border-l border-border z-50',
          'transform transition-transform duration-300 ease-out flex flex-col',
          'translate-x-0',
        )}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="inline-block text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ background: '#FAEEDA', color: '#854F0B' }}
                >
                  Liasse fiscale SCP
                </span>
                {isEdit && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-success/15 text-success">
                    Enregistré
                  </span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-text">Exercice {year ?? '—'}</h2>
              <p className="text-xs text-text-muted mt-0.5">Déclaration 2035 annuelle (quote-part SCP)</p>
            </div>
            <button
              onClick={close}
              className="p-1 rounded hover:bg-surface-hover shrink-0"
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Year selector */}
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-text-muted shrink-0" />
            <span className="text-xs text-text-muted">Exercice :</span>
            <select
              value={year ?? ''}
              onChange={(e) => {
                setYear(Number(e.target.value))
                setUserOverrodeYear(true)
              }}
              className="bg-surface border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-primary"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {showDetectionBadge && yearSource && (
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 flex items-center gap-1"
                title={YEAR_SOURCE_LABEL[yearSource]}
              >
                <CheckCircle2 size={10} />
                {YEAR_SOURCE_LABEL[yearSource]}
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Section 1 : document GED lié */}
          {gedDocumentId && (
            <div className="bg-surface rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                  <FileText size={18} className="text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-muted mb-0.5">Document GED lié</p>
                  <p className="text-sm text-text truncate font-mono">{gedDocumentId}</p>
                </div>
                <button
                  onClick={handleOpenGed}
                  className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                >
                  <ExternalLink size={12} />
                  Ouvrir
                </button>
              </div>
            </div>
          )}

          {/* Section 2 : input CA */}
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              CA déclaré quote-part (ligne AG du 2035)
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={caInput}
                onChange={(e) => setCaInput(e.target.value)}
                placeholder="312 580,00"
                className={cn(
                  'w-full bg-surface border rounded-lg pl-4 pr-12 py-3 text-lg font-mono tabular-nums',
                  'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
                  caValue === null && caInput ? 'border-danger/60' : 'border-border'
                )}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted text-sm">€</span>
            </div>
            {caValue === null && caInput && (
              <p className="text-xs text-danger mt-1">Format invalide. Exemple : 312 580,00</p>
            )}
          </div>

          {/* Section 3 : comparateur live */}
          <div className="bg-surface rounded-lg border border-border p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">CA liasse SCP</span>
              <span className="font-mono tabular-nums text-text">
                {caValue !== null ? formatCurrency(caValue) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Honoraires crédités en {year}</span>
              <span className="font-mono tabular-nums text-text">
                {honoraires_bancaires ? formatCurrency(honoraires_bancaires) : '—'}
              </span>
            </div>
            <div className="border-t border-border/50 pt-2 flex items-center justify-between text-sm font-medium">
              <span className="text-text">Écart</span>
              <span className={cn('font-mono tabular-nums', ecartColor)}>
                {ecart
                  ? `${ecart.abs >= 0 ? '+' : ''}${formatCurrency(ecart.abs)} (${ecart.pct >= 0 ? '+' : ''}${ecart.pct.toFixed(1)} %)`
                  : '—'}
              </span>
            </div>
          </div>

          {/* Hint */}
          <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-3 flex gap-2">
            <Info size={14} className="text-sky-400 shrink-0 mt-0.5" />
            <p className="text-xs text-text-muted leading-relaxed">
              <span className="font-medium text-text">Écart attendu :</span> décalages de trésorerie
              (janvier N+1 rattaché à N), prélèvements SCP, régularisations. S'il reste inexpliqué,
              vérifier avec le comptable SCP.
            </p>
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Note (optionnelle)
            </label>
            <textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Référence comptable, commentaire..."
              rows={2}
              className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2">
          <div>
            {isEdit && (
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="text-xs text-danger hover:underline disabled:opacity-50"
              >
                Supprimer
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={close}
              className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text hover:bg-surface-hover"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saveMutation.isPending}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isEdit ? 'Mettre à jour' : 'Valider le CA'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
