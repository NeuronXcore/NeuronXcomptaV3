import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileCheck,
  Lock,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { useFinalizePlaquette } from '@/hooks/usePlaquetteCheck'
import type { PlaquetteCheck, PlaquetteItemStatut } from '@/types'

interface PlaquetteFinalizationModalProps {
  check: PlaquetteCheck
  onClose: () => void
  onFinalized?: (snapshotGedDocId: string) => void
}

type WizardStep = 1 | 2 | 3

const UNRESOLVED_STATUTS: PlaquetteItemStatut[] = ['non_revu', 'a_challenger']

const STATUT_LABELS: Record<PlaquetteItemStatut, string> = {
  non_revu: 'Non revus',
  ok: 'OK',
  a_challenger: 'À challenger',
  refus_justifie: 'Refus justifié',
  en_discussion: 'En discussion',
  resolu: 'Résolus',
}

const STATUT_COLORS: Record<PlaquetteItemStatut, string> = {
  non_revu: 'bg-text-muted/15 text-text-muted',
  ok: 'bg-emerald-500/15 text-emerald-400',
  a_challenger: 'bg-warning/15 text-warning',
  refus_justifie: 'bg-text-muted/15 text-text-muted',
  en_discussion: 'bg-sky-500/15 text-sky-400',
  resolu: 'bg-emerald-500/15 text-emerald-400',
}

/**
 * Wizard 3 étapes pour finaliser la plaquette et basculer en DECLARE.
 * 1. Récap pré-vol (compteurs items par statut + warning si non résolus)
 * 2. Saisie declaration_ref + date
 * 3. Confirmation + déclenchement finalize
 *
 * Modal 640px centré z-[70], backdrop z-[60].
 *
 * Session 39 P1.
 *
 * **Mount conditionnel** : le parent rend ce composant via `{isOpen && <Modal />}`,
 * ce qui garantit un mount frais à chaque ouverture → state initialisé naturellement
 * (pas de `useEffect` de reset, évite l'anti-pattern set-state-in-effect).
 */
export function PlaquetteFinalizationModal({
  check,
  onClose,
  onFinalized,
}: PlaquetteFinalizationModalProps) {
  const [step, setStep] = useState<WizardStep>(1)
  const [declarationRef, setDeclarationRef] = useState('')
  const [declaredDate, setDeclaredDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  )
  const [acceptUnresolved, setAcceptUnresolved] = useState(false)

  const finalize = useFinalizePlaquette(check.year)

  // Stats items par statut
  const statutCounts = useMemo(() => {
    const counts: Record<PlaquetteItemStatut, number> = {
      non_revu: 0,
      ok: 0,
      a_challenger: 0,
      refus_justifie: 0,
      en_discussion: 0,
      resolu: 0,
    }
    check.items.forEach((it) => {
      counts[it.statut] = (counts[it.statut] ?? 0) + 1
    })
    return counts
  }, [check.items])

  const unresolvedCount = useMemo(
    () => UNRESOLVED_STATUTS.reduce((sum, s) => sum + statutCounts[s], 0),
    [statutCounts],
  )

  const hasWarning = unresolvedCount > 0

  // Preview filename snapshot (sans timestamp précis, juste pour l'UI)
  const snapshotFilenamePreview = useMemo(() => {
    const yyyymmdd = declaredDate.replace(/-/g, '')
    return `plaquette_check_final_${check.year}_${yyyymmdd}_HHMMSS.pdf`
  }, [check.year, declaredDate])

  // ─── Navigation ───
  const canGoStep2 = !hasWarning || acceptUnresolved
  const canGoStep3 = declarationRef.trim().length > 0

  const handleNext = () => {
    if (step === 1 && canGoStep2) setStep(2)
    else if (step === 2 && canGoStep3) setStep(3)
  }

  const handlePrev = () => {
    if (step === 2) setStep(1)
    else if (step === 3) setStep(2)
  }

  const handleConfirm = async () => {
    try {
      // Convertit la date en ISO datetime à minuit (heure locale Paris approximée UTC offset)
      const declaredAtIso = new Date(`${declaredDate}T00:00:00`).toISOString()
      const result = await finalize.mutateAsync({
        declaration_ref: declarationRef.trim(),
        declared_at: declaredAtIso,
      })
      toast.success(
        `Plaquette ${check.year} déclarée — snapshot figé en GED (verrouillé jusqu'à prescription)`,
        { duration: 6000 },
      )
      onFinalized?.(result.snapshot_ged_doc_id)
      onClose()
    } catch (e) {
      toast.error(`Finalisation échouée : ${(e as Error).message}`)
    }
  }

  // ─── Rendu ───

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm"
        onClick={onClose}
        role="presentation"
      />
      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Finaliser et déclarer la plaquette"
        className="fixed left-1/2 top-1/2 z-[70] w-[640px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15">
              <Lock size={16} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text">
                Finaliser la plaquette {check.year}
              </h2>
              <p className="text-[11px] text-text-muted">
                Étape {step} sur 3 — création du snapshot immuable
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface hover:text-text"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Stepper indicator */}
        <div className="flex items-center justify-center gap-2 px-5 pt-3.5 pb-1">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                'h-1.5 w-12 rounded-full transition-colors',
                s <= step ? 'bg-emerald-500' : 'bg-border',
              )}
            />
          ))}
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {step === 1 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-text">
                Récapitulatif pré-finalisation
              </h3>
              <p className="text-xs text-text-muted">
                Vérifie l'état des {check.items.length} items avant le freeze. Une fois
                la plaquette déclarée, elle sera verrouillée jusqu'à prescription
                (4 ans — art. L169 LPF).
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(STATUT_LABELS) as PlaquetteItemStatut[]).map((s) => (
                  <div
                    key={s}
                    className={cn(
                      'rounded-md border border-border px-2.5 py-2 text-center',
                      STATUT_COLORS[s],
                    )}
                  >
                    <div className="text-base font-semibold tabular-nums">
                      {statutCounts[s]}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide">
                      {STATUT_LABELS[s]}
                    </div>
                  </div>
                ))}
              </div>

              {hasWarning && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      size={16}
                      className="mt-0.5 flex-none text-warning"
                    />
                    <div className="flex-1">
                      <p className="text-xs text-warning">
                        Il reste <strong>{unresolvedCount} item(s) non résolus</strong>{' '}
                        (statut <em>non_revu</em> ou <em>à challenger</em>). Tu peux
                        finaliser quand même — l'état actuel sera figé tel quel.
                      </p>
                      <label className="mt-2 flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={acceptUnresolved}
                          onChange={(e) => setAcceptUnresolved(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 accent-warning"
                        />
                        <span className="text-xs text-text">
                          J'accepte de finaliser malgré {unresolvedCount} item(s) non
                          résolus
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {!hasWarning && (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
                  <div className="flex items-start gap-2">
                    <CheckCircle2
                      size={16}
                      className="mt-0.5 flex-none text-emerald-400"
                    />
                    <p className="text-xs text-emerald-400">
                      Tous les items sont résolus ou justifiés — prêt pour le freeze.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-text">
                Référence de la déclaration
              </h3>
              <p className="text-xs text-text-muted">
                Renseigne la référence officielle obtenue après télédéclaration de la
                2042. Ces informations seront figées dans le snapshot.
              </p>
              <div className="space-y-1">
                <label
                  htmlFor="declaration-ref"
                  className="block text-xs font-medium text-text"
                >
                  Référence déclaration 2042 *
                </label>
                <input
                  id="declaration-ref"
                  type="text"
                  value={declarationRef}
                  onChange={(e) => setDeclarationRef(e.target.value)}
                  placeholder="2042 N° XXXXXXXXXXXXX télédéclaré le JJ/MM/AAAA"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="declared-date"
                  className="block text-xs font-medium text-text"
                >
                  Date de déclaration
                </label>
                <input
                  id="declared-date"
                  type="date"
                  value={declaredDate}
                  onChange={(e) => setDeclaredDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              <div className="space-y-1 pt-1">
                <div className="text-[11px] uppercase tracking-wide text-text-muted">
                  Aperçu du snapshot GED
                </div>
                <code className="block rounded-md bg-surface px-2.5 py-1.5 font-mono text-[11px] text-text-muted">
                  {snapshotFilenamePreview}
                </code>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-text">Confirmation</h3>
              <div className="rounded-md border border-border bg-surface/40 p-3 space-y-2">
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-text-muted">Exercice :</span>
                  <span className="font-semibold text-text">{check.year}</span>
                </div>
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-text-muted">Date de déclaration :</span>
                  <span className="font-semibold text-text">
                    {new Date(declaredDate).toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-xs">
                  <span className="flex-none text-text-muted">Référence :</span>
                  <span className="text-right font-mono text-[11px] text-text">
                    {declarationRef.trim()}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-xs pt-1 border-t border-border">
                  <span className="text-text-muted">Items au total :</span>
                  <span className="font-semibold text-text">
                    {check.items.length}
                    {hasWarning && (
                      <span className="ml-1 text-warning">
                        ({unresolvedCount} non résolus)
                      </span>
                    )}
                  </span>
                </div>
              </div>
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
                <div className="flex items-start gap-2">
                  <FileCheck
                    size={16}
                    className="mt-0.5 flex-none text-emerald-400"
                  />
                  <div className="text-xs text-emerald-400">
                    <strong>Ce qui se passe au clic :</strong>
                    <ol className="mt-1 list-decimal pl-4 space-y-0.5">
                      <li>Le statut passe à <em>declare</em> (irréversible)</li>
                      <li>Un PDF watermarké est enregistré en GED (protégé)</li>
                      <li>
                        Le JSON courant est figé dans{' '}
                        <code>data/plaquette_check/{check.year}/final_snapshot.json</code>
                      </li>
                      <li>Les items deviennent définitivement read-only</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={step === 1 ? onClose : handlePrev}
            disabled={finalize.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface hover:text-text disabled:opacity-50"
          >
            {step === 1 ? (
              'Annuler'
            ) : (
              <>
                <ArrowLeft size={14} />
                Précédent
              </>
            )}
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={(step === 1 && !canGoStep2) || (step === 2 && !canGoStep3)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Suivant
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={finalize.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Lock size={14} />
              {finalize.isPending
                ? 'Finalisation…'
                : 'Finaliser et générer le snapshot'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
