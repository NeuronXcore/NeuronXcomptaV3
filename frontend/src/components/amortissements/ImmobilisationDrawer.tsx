import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { showDeleteImmoConfirmToast } from '@/lib/deleteImmobilisationToast'
import {
  X, Landmark, Save, Loader2, Info, AlertTriangle, CheckCircle2, RefreshCw,
  ArrowRight, Expand, FileText, Link2, Trash2, Lightbulb,
} from 'lucide-react'
import { cn, formatCurrency, formatDate, isLibelleBrut } from '@/lib/utils'
import { calcTableauAmortissement } from '@/lib/amortissement-engine'
import {
  useCreateImmobilisation, useUpdateImmobilisation, useImmobiliserCandidate,
  useComputeBackfill, useCandidateDetail, useDeleteImmobilisation,
  useImmobilisationSource, useAmortissementConfig,
} from '@/hooks/useAmortissements'
import { useGedPostes } from '@/hooks/useGed'
import PdfThumbnail from '@/components/shared/PdfThumbnail'
import PreviewSubDrawer from '@/components/ocr/PreviewSubDrawer'
import JustifPreviewLightbox from '@/components/shared/JustifPreviewLightbox'
import ManualAssociationDrawer, { type TargetedOp } from '@/components/justificatifs/ManualAssociationDrawer'
import type { Immobilisation, AmortissementCandidate, LigneAmortissement, ImmobilisationCreate } from '@/types'

interface ImmobilisationDrawerProps {
  isOpen: boolean
  onClose: () => void
  immobilisation?: Immobilisation | null
  candidate?: AmortissementCandidate | null
  /**
   * Mode lecture seule : tous les inputs disabled, footer = bouton Fermer uniquement.
   * Utilisé par `GlobalImmobilisationDrawer` pour ouvrir une immo en lecture
   * depuis un badge cliquable dans Editor/Justif/Alertes.
   */
  readonly?: boolean
}

const PLAFONDS_VEHICULE = [
  { label: 'Électrique (≤ 20g CO2)', plafond: 30000 },
  { label: 'Hybride (20-50g CO2)', plafond: 20300 },
  { label: 'Standard (50-130g CO2)', plafond: 18300 },
  { label: 'Polluant (> 130g CO2)', plafond: 9900 },
]

const formatEuro = (n: number) => formatCurrency(n)

const DEFAULT_DUREE = 5

/**
 * Normalise une chaîne (sous-catégorie ou poste) vers le slug utilisé dans
 * `config.durees_par_defaut` ({informatique, materiel-medical, vehicule, …}).
 * Lowercase + retrait diacritiques + espaces → tirets.
 */
function slugifyForDuree(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/**
 * Cherche la durée par défaut pour une sous-cat / poste donné dans la config.
 * Tolérant aux variantes de casse / accents (ex. « Informatique » → `informatique`).
 * Retourne `DEFAULT_DUREE` (5 ans) si aucun match.
 */
function resolveDureeDefaut(
  durees: Record<string, number> | undefined,
  ...candidates: (string | null | undefined)[]
): number {
  if (!durees) return DEFAULT_DUREE
  for (const c of candidates) {
    const slug = slugifyForDuree(c)
    if (slug && Object.prototype.hasOwnProperty.call(durees, slug)) {
      const v = Number(durees[slug])
      if (!Number.isNaN(v) && v > 0) return v
    }
  }
  return DEFAULT_DUREE
}

export default function ImmobilisationDrawer({ isOpen, onClose, immobilisation, candidate, readonly = false }: ImmobilisationDrawerProps) {
  const navigate = useNavigate()
  const { data: postesConfig } = useGedPostes()
  const createMutation = useCreateImmobilisation()
  const updateMutation = useUpdateImmobilisation()
  const immobiliserMutation = useImmobiliserCandidate()
  const deleteMutation = useDeleteImmobilisation()
  const computeBackfill = useComputeBackfill()

  // Détail candidate (op source + justificatif + préfill OCR) — Prompt B2
  const { data: candidateDetail } = useCandidateDetail(
    candidate?.filename ?? null,
    candidate?.index ?? null,
  )

  // Sous-drawer preview justif + drawer association manuelle ciblée
  const [showJustifSubDrawer, setShowJustifSubDrawer] = useState(false)
  const [showManualAssoc, setShowManualAssoc] = useState(false)
  // Lightbox plein écran (chaînée depuis le sub-drawer)
  const [lightboxFilename, setLightboxFilename] = useState<string | null>(null)

  const isEdit = !!immobilisation
  const isCandidate = !!candidate

  // Source op + justif (mode édition pure — pas en candidate ni readonly)
  const editSourceImmoId = isEdit && !isCandidate ? immobilisation?.id ?? null : null
  const { data: editSource } = useImmobilisationSource(editSourceImmoId)
  // Source effective utilisée pour le rendu : candidateDetail.justificatif en mode
  // candidate, sinon editSource.justif_filename en mode édition. Permet aux deux
  // chemins de partager les mêmes sub-drawers/lightbox.
  const editJustifFilename: string | null = !isCandidate && editSource?.justif_filename
    ? editSource.justif_filename
    : null
  const candidateJustifFilename: string | null = isCandidate && candidateDetail?.justificatif
    ? candidateDetail.justificatif.filename
    : null
  const activeJustifFilename = editJustifFilename ?? candidateJustifFilename
  // Section Reprise visible uniquement en mode création (pas en édition)
  const reprisAllowed = !isEdit

  // Config amortissements (durées par défaut, seuils, sous-cats exclues)
  const { data: amortConfig } = useAmortissementConfig()
  const dureesParDefaut = amortConfig?.durees_par_defaut

  // Champs principaux (renommés)
  const [designation, setDesignation] = useState('')
  const [dateAcquisition, setDateAcquisition] = useState('')
  const [baseAmortissable, setBaseAmortissable] = useState(0)
  const [duree, setDuree] = useState(DEFAULT_DUREE)
  // Flag pour empêcher l'auto-update durée quand l'utilisateur a explicitement
  // choisi une valeur (sinon changer le poste écraserait son choix).
  const [dureeManuallyEdited, setDureeManuallyEdited] = useState(false)
  // Mode locké à 'lineaire' en création / lecture seule en édition (legacy degressif autorisé en lecture)
  const [mode, setMode] = useState<string>('lineaire')
  const [poste, setPoste] = useState('')
  const [dateMes, setDateMes] = useState('')
  const [quotePartPro, setQuotePartPro] = useState(100)
  const [co2, setCo2] = useState('')
  const [plafond, setPlafond] = useState<number | null>(null)
  const [notes, setNotes] = useState('')

  // Section Reprise d'exercice antérieur
  const [isReprise, setIsReprise] = useState(false)
  const [exerciceEntree, setExerciceEntree] = useState<number>(new Date().getFullYear())
  const [amortAnterieurs, setAmortAnterieurs] = useState<number>(0)
  const [vncOuverture, setVncOuverture] = useState<number>(0)
  const [backfillManuallyEdited, setBackfillManuallyEdited] = useState(false)

  useEffect(() => {
    if (immobilisation) {
      setDesignation(immobilisation.designation)
      setDateAcquisition(immobilisation.date_acquisition)
      setBaseAmortissable(immobilisation.base_amortissable)
      setDuree(immobilisation.duree)
      setMode(immobilisation.mode)
      setPoste(immobilisation.poste ?? '')
      setDateMes(immobilisation.date_mise_en_service || '')
      setQuotePartPro(immobilisation.quote_part_pro)
      setCo2(immobilisation.co2_classe || '')
      setPlafond(immobilisation.plafond_fiscal ?? null)
      setNotes(immobilisation.notes || '')
      // Édition d'une immo existante : la durée est figée par l'utilisateur,
      // on flag manualEdited pour empêcher l'auto-update sur changement poste.
      setDureeManuallyEdited(true)
      // Section reprise — pré-remplir si existe
      if (immobilisation.exercice_entree_neuronx != null) {
        setIsReprise(true)
        setExerciceEntree(immobilisation.exercice_entree_neuronx)
        setAmortAnterieurs(immobilisation.amortissements_anterieurs)
        setVncOuverture(immobilisation.vnc_ouverture ?? 0)
        setBackfillManuallyEdited(true)
      } else {
        setIsReprise(false)
        setExerciceEntree(new Date().getFullYear())
        setAmortAnterieurs(0)
        setVncOuverture(0)
        setBackfillManuallyEdited(false)
      }
    } else if (candidate) {
      setDesignation(candidate.libelle)
      setDateAcquisition(candidate.date)
      setBaseAmortissable(candidate.debit)
      // Durée par défaut dérivée de la sous-catégorie (Matériel/Informatique/…)
      // ou de la catégorie en fallback. Respecte la config utilisateur.
      setDuree(resolveDureeDefaut(dureesParDefaut, candidate.sous_categorie, candidate.categorie))
      setDureeManuallyEdited(false)
      setMode('lineaire')
      setPoste('')
      setDateMes(candidate.date)
      setQuotePartPro(100)
      setCo2(''); setPlafond(null); setNotes('')
      setIsReprise(false); setExerciceEntree(new Date().getFullYear())
      setAmortAnterieurs(0); setVncOuverture(0); setBackfillManuallyEdited(false)
    } else {
      // Création vierge : durée par défaut pas encore résolue (pas de poste/sous-cat).
      // L'utilisateur choisira un poste → useEffect ci-dessous met à jour la durée.
      setDesignation(''); setDateAcquisition(''); setBaseAmortissable(0)
      setDuree(DEFAULT_DUREE); setDureeManuallyEdited(false)
      setMode('lineaire'); setPoste(''); setDateMes(''); setQuotePartPro(100)
      setCo2(''); setPlafond(null); setNotes('')
      setIsReprise(false); setExerciceEntree(new Date().getFullYear())
      setAmortAnterieurs(0); setVncOuverture(0); setBackfillManuallyEdited(false)
    }
    // dureesParDefaut volontairement absent des deps : la résolution se fait à
    // l'ouverture du drawer ; un changement de config en cours d'édition ne doit
    // pas écraser les valeurs courantes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immobilisation?.id, candidate?.index, isOpen])

  // Auto-update durée quand l'utilisateur change le poste comptable, tant qu'il
  // n'a pas explicitement modifié la durée (sinon on respecte son choix).
  useEffect(() => {
    if (dureeManuallyEdited) return
    if (!poste) return
    const proposed = resolveDureeDefaut(dureesParDefaut, poste)
    if (proposed !== duree) setDuree(proposed)
    // Volontaire : on ne dépend pas de `duree` (sinon boucle infinie).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poste, dureesParDefaut, dureeManuallyEdited])

  // Close on escape — z-stack : lightbox > sub-drawer > manual-assoc > drawer
  // (la lightbox a son propre handler Esc avec stopPropagation, donc en pratique
  // ce handler ne reçoit Esc que si la lightbox est fermée — on garde quand même
  // la garde explicite pour clarté.)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (lightboxFilename) {
        // Géré par la lightbox elle-même via window listener en mode capture
        return
      }
      if (showJustifSubDrawer) {
        setShowJustifSubDrawer(false)
        e.stopPropagation()
        return
      }
      if (showManualAssoc) {
        setShowManualAssoc(false)
        e.stopPropagation()
        return
      }
      onClose()
    }
    if (isOpen) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose, showJustifSubDrawer, showManualAssoc, lightboxFilename])

  // Préfill OCR quand candidate détail arrive — n'override que les champs vides
  useEffect(() => {
    if (!candidateDetail?.ocr_prefill || !isCandidate) return
    const prefill = candidateDetail.ocr_prefill
    setDesignation((d) => d || prefill.designation || '')
    setDateAcquisition((d) => d || prefill.date_acquisition || '')
    setBaseAmortissable((b) => b || prefill.base_amortissable || 0)
  }, [candidateDetail?.ocr_prefill, isCandidate])

  // Reset sub-drawers quand le drawer principal se ferme ou change d'item
  useEffect(() => {
    if (!isOpen) {
      setShowJustifSubDrawer(false)
      setShowManualAssoc(false)
      setLightboxFilename(null)
    }
  }, [isOpen, candidate?.index])

  // Calcul backfill auto avec debounce 400ms (sauf si édité manuellement)
  useEffect(() => {
    if (!isReprise || backfillManuallyEdited) return
    if (!dateAcquisition || !baseAmortissable || !duree || !exerciceEntree) return

    const yearAcq = parseInt(dateAcquisition.slice(0, 4))
    if (Number.isNaN(yearAcq) || exerciceEntree <= yearAcq) return

    const timeoutId = setTimeout(() => {
      computeBackfill.mutate(
        {
          date_acquisition: dateAcquisition,
          base_amortissable: baseAmortissable,
          duree,
          exercice_entree_neuronx: exerciceEntree,
          quote_part_pro: quotePartPro,
        },
        {
          onSuccess: (res) => {
            setAmortAnterieurs(res.amortissements_anterieurs_theorique)
            setVncOuverture(res.vnc_ouverture_theorique)
          },
        },
      )
    }, 400)

    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateAcquisition, baseAmortissable, duree, exerciceEntree, quotePartPro, isReprise, backfillManuallyEdited])

  // Realtime tableau preview (inchangé pour les immos sans reprise)
  const tableau = useMemo<LigneAmortissement[]>(() => {
    if (!dateAcquisition || baseAmortissable <= 0 || duree <= 0) return []
    return calcTableauAmortissement({
      base_amortissable: baseAmortissable,
      duree,
      mode: (mode === 'degressif' ? 'degressif' : 'lineaire'),
      date_mise_en_service: dateMes || dateAcquisition,
      quote_part_pro: quotePartPro,
      plafond_fiscal: plafond,
    })
  }, [baseAmortissable, duree, mode, dateAcquisition, dateMes, quotePartPro, plafond])

  const currentYear = new Date().getFullYear()

  // Validation cohérence backfill
  const incoherenceBackfill = isReprise
    ? Math.abs(amortAnterieurs + vncOuverture - baseAmortissable) > 1
    : false

  const handleSubmit = () => {
    const payload: ImmobilisationCreate = {
      designation,
      date_acquisition: dateAcquisition,
      base_amortissable: baseAmortissable,
      duree,
      // En création : toujours lineaire. En édition : on conserve la valeur courante (legacy degressif autorisé en lecture).
      mode: isEdit ? mode : 'lineaire',
      quote_part_pro: quotePartPro,
      poste: poste || null,
      date_mise_en_service: dateMes || null,
      plafond_fiscal: plafond,
      co2_classe: co2 || null,
      notes: notes || null,
      operation_source: candidate ? { file: candidate.filename, index: candidate.index } : null,
      exercice_entree_neuronx: isReprise ? exerciceEntree : null,
      amortissements_anterieurs: isReprise ? amortAnterieurs : 0,
      vnc_ouverture: isReprise ? vncOuverture : null,
    }

    if (isCandidate) {
      immobiliserMutation.mutate(payload, { onSuccess: () => onClose() })
    } else if (isEdit && immobilisation) {
      updateMutation.mutate({ id: immobilisation.id, data: payload as unknown as Record<string, unknown> }, { onSuccess: () => onClose() })
    } else {
      createMutation.mutate(payload, { onSuccess: () => onClose() })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending || immobiliserMutation.isPending
  const canSave = !!designation && !!dateAcquisition && baseAmortissable > 0 && !incoherenceBackfill

  // Suppression d'une immo existante : cascade les ops liées (clear immobilisation_id +
  // vide Catégorie/Sous-catégorie). L'OD dotation n'est PAS auto-supprimée — la 7ᵉ task
  // auto `dotation_manquante` réapparaîtra naturellement si l'OD existait.
  const handleDelete = () => {
    if (!immobilisation || readonly) return
    const label = immobilisation.designation?.trim() || 'cette immobilisation'

    showDeleteImmoConfirmToast(label, async () => {
      try {
        const result = await deleteMutation.mutateAsync(immobilisation.id)
        const opsCount = result.ops_unlinked?.length ?? 0
        const years = result.affected_years ?? []
        let msg = 'Immobilisation supprimée'
        if (opsCount > 0) {
          msg += ` — ${opsCount} opération${opsCount > 1 ? 's' : ''} déliée${opsCount > 1 ? 's' : ''}`
        }
        toast.success(msg)
        if (years.length > 0) {
          toast(
            `OD dotation potentiellement obsolète pour ${years.join(', ')} — régénère via l'onglet Dotation.`,
            { icon: '⚠️', duration: 8000 },
          )
        }
        onClose()
      } catch (err) {
        toast.error(`Erreur: ${err instanceof Error ? err.message : 'inconnue'}`)
      }
    })
  }

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[650px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Landmark size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">
                {isEdit ? 'Modifier l\'immobilisation' : isCandidate ? 'Immobiliser l\'opération' : 'Nouvelle immobilisation'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text"><X size={18} /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {readonly && (
            <div className="px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-md flex items-start gap-2 text-xs text-blue-400">
              <Info size={12} className="shrink-0 mt-0.5" />
              <span>Lecture seule — éditez cette immobilisation depuis la page Amortissements.</span>
            </div>
          )}

          {/* Section Opération source — affichée en candidate ET en édition pure
              (parité ; en édition, on s'appuie sur useImmobilisationSource via
              transitivité op). */}
          {isCandidate && candidate && candidateDetail && (
            <div className="space-y-3 pb-4 border-b border-border">
              <p className="text-[10px] text-text-muted uppercase tracking-wide font-medium">
                Opération source
              </p>

              {/* Carte op readonly */}
              <div className="bg-surface rounded-md p-3 border border-border">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text truncate">
                      {candidateDetail.operation['Libellé']}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {formatDate(candidateDetail.operation['Date'] || '')}
                      {' · '}{candidateDetail.operation['Catégorie'] ?? '—'}
                      {candidateDetail.operation['Sous-catégorie'] && ` / ${candidateDetail.operation['Sous-catégorie']}`}
                    </p>
                  </div>
                  <p className="text-sm font-medium tabular-nums text-red-400 shrink-0">
                    −{formatCurrency(Math.abs(Number(candidateDetail.operation['Débit'] ?? 0)))}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(
                    `/editor?file=${encodeURIComponent(candidate.filename)}&highlight=${candidate.index}&from=amortissements`
                  )}
                  className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Voir dans l'éditeur <ArrowRight size={10} />
                </button>
              </div>

              {/* Bloc justificatif */}
              {candidateDetail.justificatif ? (
                <JustificatifPreviewBlock
                  filename={candidateDetail.justificatif.filename}
                  ocrData={candidateDetail.justificatif.ocr_data}
                  onExpand={() => setShowJustifSubDrawer(true)}
                />
              ) : (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3 flex items-start gap-2.5">
                  <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-amber-400 mb-1.5">
                      Aucun justificatif associé à cette opération
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowManualAssoc(true)}
                      className="text-xs text-amber-300 underline hover:text-amber-100 flex items-center gap-1"
                    >
                      <Link2 size={10} /> Associer un justificatif
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mode édition pure : section source via useImmobilisationSource */}
          {isEdit && !isCandidate && (
            <div className="space-y-3 pb-4 border-b border-border">
              <p className="text-[10px] text-text-muted uppercase tracking-wide font-medium">
                Opération source &amp; justificatif
              </p>

              {!editSource ? (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3 flex items-start gap-2.5 text-xs text-blue-400">
                  <Info size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Aucune opération source rattachée (immobilisation créée manuellement
                    ou en reprise d'exercice antérieur).
                  </span>
                </div>
              ) : (
                <>
                  {/* Carte op readonly */}
                  <div className="bg-surface rounded-md p-3 border border-border">
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text truncate">
                          {editSource.libelle || '—'}
                        </p>
                        <p className="text-xs text-text-muted mt-0.5">
                          {formatDate(editSource.date)}
                          {' · '}{editSource.categorie || '—'}
                          {editSource.sous_categorie && ` / ${editSource.sous_categorie}`}
                        </p>
                      </div>
                      <p className="text-sm font-medium tabular-nums text-red-400 shrink-0">
                        −{formatCurrency(Math.abs(editSource.debit))}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(
                        `/editor?file=${encodeURIComponent(editSource.operation_file)}&highlight=${editSource.operation_index}&from=amortissements`
                      )}
                      className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      Voir dans l'éditeur <ArrowRight size={10} />
                    </button>
                  </div>

                  {/* Bloc justificatif (présent ou absent) */}
                  {editSource.justif_filename ? (
                    <JustificatifPreviewBlock
                      filename={editSource.justif_filename}
                      ocrData={{}}
                      onExpand={() => setShowJustifSubDrawer(true)}
                    />
                  ) : (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3 flex items-start gap-2.5">
                      <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-amber-400 mb-1.5">
                          Aucun justificatif associé
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowManualAssoc(true)}
                          className="text-xs text-amber-300 underline hover:text-amber-100 flex items-center gap-1"
                        >
                          <Link2 size={10} /> Associer un justificatif
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Form */}
          <fieldset disabled={readonly} className="contents">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] text-text-muted block mb-1">Désignation</label>
              <input type="text" value={designation} onChange={e => setDesignation(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
              <div className="text-xs text-primary flex items-start gap-1.5 mt-1.5">
                <Lightbulb size={12} className="mt-0.5 flex-shrink-0" />
                <span>
                  Donne un nom court et descriptif (ex&nbsp;: «&nbsp;Ordinateur&nbsp;», «&nbsp;Fauteuil bureau&nbsp;»).
                  {isLibelleBrut(designation) && (
                    <> Cette immo a été créée depuis le libellé bancaire — à renommer.</>
                  )}
                </span>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Date d'acquisition</label>
              <input type="date" value={dateAcquisition} onChange={e => setDateAcquisition(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Base amortissable</label>
              <input type="number" step="0.01" value={baseAmortissable || ''} onChange={e => setBaseAmortissable(parseFloat(e.target.value) || 0)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Poste comptable</label>
              <select value={poste} onChange={e => setPoste(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary">
                <option value="">Sélectionner...</option>
                {(postesConfig?.postes ?? []).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Durée (années)</label>
              <select
                value={duree}
                onChange={(e) => {
                  setDuree(parseInt(e.target.value))
                  setDureeManuallyEdited(true)
                }}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              >
                {[1, 3, 5, 7, 10].map(d => <option key={d} value={d}>{d} ans</option>)}
              </select>
            </div>

            {/* Mode — readonly lock en création + édition (legacy degressif affiché en readonly) */}
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Mode</label>
              <div className="flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-border">
                <span className="text-sm font-medium text-text">
                  {mode === 'degressif' ? 'Dégressif (legacy)' : 'Linéaire'}
                </span>
                <button
                  type="button"
                  title="Le dégressif est réservé à la comptabilité d'engagement (option formelle formulaire 2036). Non applicable en BNC régime recettes."
                  className="ml-auto text-text-muted hover:text-text"
                >
                  <Info size={14} />
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-text-muted block mb-1">Mise en service</label>
              <input type="date" value={dateMes} onChange={e => setDateMes(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
            </div>
          </div>

          {/* Usage pro slider */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Usage professionnel : {quotePartPro}%</label>
            <input type="range" min={0} max={100} step={5} value={quotePartPro}
              onChange={e => setQuotePartPro(parseInt(e.target.value))}
              className="w-full accent-primary" />
          </div>

          {/* Section Reprise d'exercice antérieur (visible uniquement en création) */}
          {reprisAllowed && (
            <div className="pt-4 border-t border-border">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isReprise}
                  onChange={(e) => {
                    setIsReprise(e.target.checked)
                    if (!e.target.checked) {
                      setAmortAnterieurs(0)
                      setVncOuverture(0)
                      setBackfillManuallyEdited(false)
                    }
                  }}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium text-text">Reprise d'une immobilisation existante</span>
                <span className="text-xs text-text-muted">(achat antérieur à NeuronXcompta)</span>
              </label>

              {isReprise && (
                <div className="mt-3 pl-6 space-y-3">
                  {/* Exercice d'entrée */}
                  <div>
                    <label className="text-xs text-text-muted block mb-1">
                      Exercice d'entrée dans NeuronX
                    </label>
                    <select
                      value={exerciceEntree}
                      onChange={(e) => {
                        setExerciceEntree(parseInt(e.target.value))
                        setBackfillManuallyEdited(false)
                      }}
                      className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-surface text-text focus:outline-none focus:border-primary"
                    >
                      {Array.from({ length: 10 }, (_, i) => {
                        const y = new Date().getFullYear() - 5 + i
                        const yAcq = parseInt(dateAcquisition?.slice(0, 4) || '0')
                        if (y <= yAcq) return null
                        return <option key={y} value={y}>{y}</option>
                      })}
                    </select>
                    {dateAcquisition && (
                      <p className="text-[11px] text-text-muted mt-1">
                        Acquisition : {dateAcquisition.slice(0, 4)} · {exerciceEntree - parseInt(dateAcquisition.slice(0, 4))} exercice(s) antérieur(s)
                      </p>
                    )}
                  </div>

                  {/* Cumul amortissements antérieurs */}
                  <div>
                    <label className="text-xs text-text-muted mb-1 flex items-center gap-1">
                      Cumul amortissements antérieurs
                      {computeBackfill.isPending && <Loader2 size={10} className="animate-spin" />}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        value={amortAnterieurs}
                        onChange={(e) => {
                          setAmortAnterieurs(parseFloat(e.target.value) || 0)
                          setBackfillManuallyEdited(true)
                        }}
                        className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-surface text-text focus:outline-none focus:border-primary tabular-nums"
                      />
                      <span className="text-sm text-text-muted">€</span>
                    </div>
                  </div>

                  {/* VNC ouverture */}
                  <div>
                    <label className="text-xs text-text-muted block mb-1">
                      VNC d'ouverture {exerciceEntree}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        value={vncOuverture}
                        onChange={(e) => {
                          setVncOuverture(parseFloat(e.target.value) || 0)
                          setBackfillManuallyEdited(true)
                        }}
                        className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-surface text-text focus:outline-none focus:border-primary tabular-nums"
                      />
                      <span className="text-sm text-text-muted">€</span>
                    </div>
                  </div>

                  {/* Bouton recalcul manuel */}
                  {backfillManuallyEdited && (
                    <button
                      type="button"
                      onClick={() => {
                        setBackfillManuallyEdited(false)
                      }}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <RefreshCw size={10} /> Recalculer depuis la durée légale
                    </button>
                  )}

                  {/* Validation temps réel */}
                  <div className={cn(
                    'text-xs px-3 py-2 rounded-md flex items-start gap-2 border',
                    incoherenceBackfill
                      ? 'bg-red-500/10 text-red-400 border-red-500/30'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  )}>
                    {incoherenceBackfill ? (
                      <>
                        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                        <span>
                          Incohérence : {formatEuro(amortAnterieurs)} + {formatEuro(vncOuverture)} ={' '}
                          {formatEuro(amortAnterieurs + vncOuverture)} ≠ base {formatEuro(baseAmortissable)}
                        </span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={12} className="shrink-0 mt-0.5" />
                        <span>Cohérence validée · base = antérieurs + VNC ouverture</span>
                      </>
                    )}
                  </div>

                  {/* Info */}
                  <div className="text-xs bg-blue-500/10 border border-blue-500/20 rounded-md p-2.5 flex items-start gap-2 text-blue-400">
                    <Info size={12} className="shrink-0 mt-0.5" />
                    <p>
                      NeuronXcompta ne produira aucune dotation pour les exercices antérieurs
                      à {exerciceEntree}. Les {formatEuro(amortAnterieurs)} cumulés sont hors scope
                      fiscal NeuronX (supposés déjà passés par votre ancien comptable).
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Vehicle section */}
          {poste === 'vehicule' && (
            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <h4 className="text-xs font-semibold text-text">Véhicule — Plafond fiscal</h4>
              <select value={co2} onChange={e => {
                setCo2(e.target.value)
                const found = PLAFONDS_VEHICULE.find(p => p.label === e.target.value)
                setPlafond(found?.plafond ?? 18300)
              }} className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary">
                <option value="">Sélectionner classe CO2...</option>
                {PLAFONDS_VEHICULE.map(p => <option key={p.label} value={p.label}>{p.label} — {formatCurrency(p.plafond)}</option>)}
              </select>
              {plafond && <p className="text-xs text-text-muted">Base amortissable plafonnée à {formatCurrency(plafond)}</p>}
            </div>
          )}

          {/* Realtime tableau preview — désactivé si reprise (le tableau sera calculé côté backend avec backfill) */}
          {!isReprise && tableau.length > 0 && (
            <div className="bg-surface rounded-lg border border-border p-4">
              <h4 className="text-xs font-semibold text-text mb-2">Aperçu tableau d'amortissement</h4>
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-text-muted border-b border-border">
                    <th className="text-left py-1">Exercice</th>
                    <th className="text-right py-1">Dot. brute</th>
                    <th className="text-right py-1">Déduc. ({quotePartPro}%)</th>
                    <th className="text-right py-1">Cumul</th>
                    <th className="text-right py-1">VNC</th>
                  </tr>
                </thead>
                <tbody>
                  {tableau.map(l => (
                    <tr key={l.exercice} className={cn('border-b border-border/50', l.exercice === currentYear && 'bg-primary/5')}>
                      <td className="py-1 text-text">{l.exercice}</td>
                      <td className="py-1 text-right">{formatCurrency(l.dotation_brute)}</td>
                      <td className="py-1 text-right text-emerald-400">{formatCurrency(l.dotation_deductible)}</td>
                      <td className="py-1 text-right text-text-muted">{formatCurrency(l.amortissements_cumules)}</td>
                      <td className="py-1 text-right font-medium">{formatCurrency(l.vnc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary resize-none" />
          </div>
          </fieldset>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0">
          {/* Warning ambre non bloquant si candidate sans justif */}
          {isCandidate && candidateDetail && !candidateDetail.justificatif && !readonly && (
            <p className="text-xs text-amber-400 mb-3 flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              Création sans justificatif associé — à régulariser ensuite via la page Justificatifs.
            </p>
          )}
          <div className={cn(
            "flex gap-2",
            // Mode édition pure (pas candidate, pas readonly) : justify-between pour
            // pousser Supprimer à gauche, Annuler/Enregistrer à droite.
            isEdit && !isCandidate && !readonly ? "justify-between" : "justify-end",
          )}>
            {readonly ? (
              <button onClick={onClose} className="px-4 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-surface-hover text-text">Fermer</button>
            ) : (
              <>
                {isEdit && !isCandidate && (
                  <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending || isPending}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-danger/10 text-danger border border-danger/30 rounded-lg hover:bg-danger/20 disabled:opacity-50"
                    title="Supprimer cette immobilisation et délier l'opération associée"
                  >
                    {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Supprimer
                  </button>
                )}
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-text">Annuler</button>
                  <button onClick={handleSubmit} disabled={isPending || !canSave || deleteMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50">
                    {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {isCandidate ? "Confirmer l'immobilisation" : isEdit ? 'Enregistrer' : 'Créer'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sous-drawer preview justificatif (z-index 60 pour s'empiler par-dessus le drawer principal z-50) */}
      {activeJustifFilename && (
        <PreviewSubDrawer
          filename={showJustifSubDrawer ? activeJustifFilename : null}
          mainDrawerOpen={isOpen && showJustifSubDrawer}
          mainDrawerWidth={650}
          width={700}
          zIndex={60}
          onClose={() => setShowJustifSubDrawer(false)}
          onOpenLightbox={() => setLightboxFilename(activeJustifFilename)}
        />
      )}

      {/* Lightbox plein écran chaînée depuis le sub-drawer */}
      <JustifPreviewLightbox
        filename={lightboxFilename}
        onClose={() => setLightboxFilename(null)}
      />

      {/* Drawer association manuelle (mode ciblé sur l'op candidate ou source) */}
      {isCandidate && candidate && (
        <ManualAssociationDrawer
          open={showManualAssoc}
          onClose={() => setShowManualAssoc(false)}
          year={parseInt((candidate.date || '').slice(0, 4)) || new Date().getFullYear()}
          month={parseInt((candidate.date || '').slice(5, 7)) || null}
          targetedOps={[{
            filename: candidate.filename,
            index: candidate.index,
            libelle: candidate.libelle,
            date: candidate.date,
            montant: Math.abs(candidate.debit ?? 0),
            categorie: candidate.categorie,
            sousCategorie: candidate.sous_categorie,
          } as TargetedOp]}
        />
      )}
      {/* Mode édition pure : association manuelle ciblée sur l'op source */}
      {!isCandidate && isEdit && editSource && (
        <ManualAssociationDrawer
          open={showManualAssoc}
          onClose={() => setShowManualAssoc(false)}
          year={parseInt((editSource.date || '').slice(0, 4)) || new Date().getFullYear()}
          month={parseInt((editSource.date || '').slice(5, 7)) || null}
          targetedOps={[{
            filename: editSource.operation_file,
            index: editSource.operation_index,
            libelle: editSource.libelle,
            date: editSource.date,
            montant: Math.max(Math.abs(editSource.debit), Math.abs(editSource.credit)),
            categorie: editSource.categorie,
            sousCategorie: editSource.sous_categorie,
          } as TargetedOp]}
        />
      )}
    </>
  )
}

// ─── Sous-composant : preview thumbnail + métadonnées OCR ───

function JustificatifPreviewBlock({ filename, ocrData, onExpand }: {
  filename: string
  ocrData: Record<string, any>
  onExpand: () => void
}) {
  const supplier = ocrData?.supplier || ocrData?.extracted_data?.supplier
  const bestAmount = ocrData?.best_amount || ocrData?.extracted_data?.best_amount
  return (
    <div className="flex items-center gap-3 p-3 bg-surface border border-border rounded-md">
      <button
        type="button"
        onClick={onExpand}
        className="relative group rounded border border-border overflow-hidden shrink-0"
        style={{ width: 80, height: 100 }}
        title="Agrandir"
      >
        <PdfThumbnail
          justificatifFilename={filename}
          className="w-full h-full object-cover"
          iconSize={28}
          lazy={false}
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Expand size={16} className="text-white" />
        </div>
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-text truncate flex items-center gap-1">
          <FileText size={10} className="text-text-muted" />
          {filename}
        </p>
        {supplier && (
          <p className="text-xs text-text-muted mt-0.5 truncate">{supplier}</p>
        )}
        {bestAmount != null && (
          <p className="text-xs text-text-muted">{formatCurrency(Number(bestAmount))}</p>
        )}
      </div>
    </div>
  )
}
