import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  X, FileSpreadsheet, AlertTriangle, MessageSquare, Mail, BookOpen,
  ChevronRight, ChevronDown, Send, Save, Loader2, ExternalLink, Trash2,
  CheckCircle2, AlertCircle, HelpCircle, Clock, RefreshCw, Archive, Download, Eye,
  Lock, Handshake, Sparkles,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { usePlaquetteCheckDrawerStore } from '@/stores/plaquetteCheckDrawerStore'
import {
  usePlaquetteCheck,
  usePatchPlaquetteItem,
  useDeletePlaquetteItem,
  usePlaquetteItemOps,
  useGenerateChallengeEmail,
  useAddJournalEntry,
  useGeneratePlaquetteReport,
  usePreparePlaquetteEmailBundle,
  usePlaquetteReportsHistory,
  useDeletePlaquetteReport,
  useLogComptableResponse,
  isPlaquetteEditable,
  useNegociationSynthesis,
  useComputeNegociation,
  type ItemStatusUpdate,
} from '@/hooks/usePlaquetteCheck'
import { useDashboard } from '@/hooks/useApi'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import { api } from '@/api/client'
import { formatCurrency, cn } from '@/lib/utils'
import type { PlaquetteItem, PlaquetteItemStatut, PlaquetteJournalEntry, RisqueNiveau } from '@/types'
import { PlaquetteStatusBadge } from './PlaquetteStatusBadge'
import { PlaquetteStatusActionsMenu } from './PlaquetteStatusActionsMenu'
import { PlaquetteFinalizationModal } from './PlaquetteFinalizationModal'
import { JournalAttachmentList } from './JournalAttachmentList'
import { JournalByItemView } from './JournalByItemView'
import { PlaquetteRisqueChip } from './PlaquetteRisqueChip'
import { PlaquetteRisqueOverrideModal } from './PlaquetteRisqueOverrideModal'
import { PlaquetteRisqueDrawerSummary } from './PlaquetteRisqueDrawerSummary'
import { PlaquetteNegociationDrawer } from './PlaquetteNegociationDrawer'

type Tab = 'comparatif' | 'saisie' | 'email' | 'archives' | 'journal'

const STATUT_LABELS: Record<PlaquetteItemStatut, string> = {
  non_revu: 'Non revu',
  ok: 'OK',
  a_challenger: 'À challenger',
  refus_justifie: 'Refus justifié',
  en_discussion: 'En discussion',
  resolu: 'Résolu',
}

const STATUT_STYLES: Record<PlaquetteItemStatut, { bg: string; text: string; border: string; icon: typeof CheckCircle2 }> = {
  non_revu: { bg: 'bg-text-muted/15', text: 'text-text-muted', border: 'border-text-muted/30', icon: HelpCircle },
  ok: { bg: 'bg-success/15', text: 'text-success', border: 'border-success/40', icon: CheckCircle2 },
  a_challenger: { bg: 'bg-warning/15', text: 'text-warning', border: 'border-warning/40', icon: AlertTriangle },
  refus_justifie: { bg: 'bg-danger/15', text: 'text-danger', border: 'border-danger/40', icon: AlertCircle },
  en_discussion: { bg: 'bg-sky-500/15', text: 'text-sky-400', border: 'border-sky-500/40', icon: MessageSquare },
  resolu: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/40', icon: CheckCircle2 },
}

// Parse FR amount (idem LiasseScpDrawer)
function parseFrAmount(raw: string): number | null {
  if (!raw) return null
  const clean = raw.replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(clean)
  return Number.isFinite(n) ? n : null
}

function fmtMontant(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return formatCurrency(n)
}

function fmtEcart(n: number | null | undefined): { text: string; color: string } {
  if (n === null || n === undefined) return { text: '—', color: 'text-text-muted' }
  const sign = n >= 0 ? '+' : ''
  const abs = Math.abs(n)
  // Vert si proche de 0 (< 50€), ambre si moyen (< 500€), rouge sinon
  let color = 'text-emerald-400'
  if (abs >= 500) color = 'text-danger'
  else if (abs >= 50) color = 'text-warning'
  return { text: `${sign}${formatCurrency(n)}`, color }
}

export default function PlaquetteCheckDrawer() {
  const { isOpen, year, gedDocumentId, close, journalView, setJournalView } =
    usePlaquetteCheckDrawerStore()
  const openNegociationDrawer = usePlaquetteCheckDrawerStore((s) => s.openNegociationDrawer)
  const closeNegociationDrawer = usePlaquetteCheckDrawerStore((s) => s.closeNegociationDrawer)
  const [tab, setTab] = useState<Tab>('comparatif')
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [editingMontant, setEditingMontant] = useState<{ id: string; value: string } | null>(null)
  const [editingComment, setEditingComment] = useState<{ id: string; value: string } | null>(null)
  const [generatedEmail, setGeneratedEmail] = useState<{ subject: string; body: string; nb_items: number; related_item_ids: string[] } | null>(null)
  const [emailSubjectEdit, setEmailSubjectEdit] = useState('')
  const [emailBodyEdit, setEmailBodyEdit] = useState('')
  // Session 39 P1 — wizard finalisation
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  // Session 39 P2 — modal override risque (null = fermé)
  const [riskOverrideItemId, setRiskOverrideItemId] = useState<string | null>(null)
  // Session 39 P2 — filtre niveau risque (null = tous)
  const [riskFilter, setRiskFilter] = useState<RisqueNiveau | 'overridden' | null>(null)

  // ─── Resize (Session 40 P1.2) — handle drag bord gauche + persistance localStorage ───
  const DRAWER_MIN_WIDTH = 800
  const DRAWER_DEFAULT_WIDTH = 1100
  const DRAWER_WIDTH_KEY = 'plaquette-drawer-width'
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return DRAWER_DEFAULT_WIDTH
    const saved = window.localStorage.getItem(DRAWER_WIDTH_KEY)
    const parsed = saved ? parseInt(saved, 10) : NaN
    return !isNaN(parsed) && parsed >= DRAWER_MIN_WIDTH ? parsed : DRAWER_DEFAULT_WIDTH
  })
  const isResizing = useRef(false)
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const startX = e.clientX
    const startWidth = drawerWidth
    const maxWidth = window.innerWidth * 0.95
    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const delta = startX - ev.clientX
      const newWidth = Math.min(maxWidth, Math.max(DRAWER_MIN_WIDTH, startWidth + delta))
      setDrawerWidth(newWidth)
    }
    const handleMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [drawerWidth])

  // Persist à chaque changement (cheap localStorage write d'un nombre)
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAWER_WIDTH_KEY, String(Math.round(drawerWidth)))
    } catch {
      /* ignore */
    }
  }, [drawerWidth])

  const { data, isLoading, refetch } = usePlaquetteCheck(year)
  const { data: dashboard } = useDashboard(year ?? undefined)
  const patchMutation = usePatchPlaquetteItem(year)
  const deleteMutation = useDeletePlaquetteItem(year)
  const generateEmailMutation = useGenerateChallengeEmail(year)
  const generateReportMutation = useGeneratePlaquetteReport(year)
  const prepareBundleMutation = usePreparePlaquetteEmailBundle(year)
  const addJournalMutation = useAddJournalEntry(year)
  // Session 40 P1 — position de repli
  const { data: negociationSynth } = useNegociationSynthesis(year)
  const computeNegociationMutation = useComputeNegociation(year)
  const openSendDrawer = useSendDrawerStore((s) => s.open)
  const [lastReport, setLastReport] = useState<{ filename: string; size: number; generated_at: string; ged_doc_id: string | null } | null>(null)

  // Session 39 P3 — Hydrate `lastReport` depuis l'historique GED si non encore généré
  // dans la session courante. Permet d'exposer le bouton « Ouvrir avec Aperçu » dans
  // l'onglet Email challenge même quand le drawer est ouvert sans regénération.
  const { data: reportsHistory } = usePlaquetteReportsHistory(year)
  useEffect(() => {
    if (lastReport !== null) return
    const latest = reportsHistory?.reports?.[0]
    if (!latest) return
    setLastReport({
      filename: latest.filename,
      size: latest.size_bytes ?? 0,
      generated_at: latest.generated_at ?? new Date().toISOString(),
      ged_doc_id: latest.doc_id,
    })
  }, [reportsHistory, lastReport])

  // Session 39 P1 — Note : le reset au mount est délégué au parent `PlaquetteCheckDrawerHost`
  // (App.tsx) qui démonte/remonte via `key={year}` à chaque ouverture. Le state interne
  // s'initialise naturellement → pas de useEffect de reset (anti-pattern set-state-in-effect).

  // Esc to close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (expandedItem) {
          setExpandedItem(null)
          e.preventDefault()
          return
        }
        if (editingMontant || editingComment) {
          setEditingMontant(null)
          setEditingComment(null)
          e.preventDefault()
          return
        }
        close()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, expandedItem, editingMontant, editingComment, close])

  const items = data?.items || []
  const counts = useMemo(() => {
    const out: Record<PlaquetteItemStatut, number> = {
      non_revu: 0, ok: 0, a_challenger: 0, refus_justifie: 0, en_discussion: 0, resolu: 0,
    }
    items.forEach((i) => { out[i.statut] = (out[i.statut] || 0) + 1 })
    return out
  }, [items])

  const totalEcartChallenger = useMemo(() => {
    return items
      .filter((i) => i.statut === 'a_challenger')
      .reduce((sum, i) => sum + (i.ecart || 0), 0)
  }, [items])

  const handleCommitMontant = async () => {
    if (!editingMontant) return
    const value = parseFrAmount(editingMontant.value)
    if (value === null && editingMontant.value.trim() !== '') {
      toast.error('Montant invalide')
      return
    }
    try {
      await patchMutation.mutateAsync({
        item_id: editingMontant.id,
        patch: { montant_plaquette: value },
      })
    } catch (e) {
      toast.error(`Erreur : ${(e as Error).message}`)
    } finally {
      setEditingMontant(null)
    }
  }

  const handleStatutChange = async (itemId: string, statut: PlaquetteItemStatut) => {
    try {
      await patchMutation.mutateAsync({ item_id: itemId, patch: { statut } })
    } catch (e) {
      toast.error(`Erreur : ${(e as Error).message}`)
    }
  }

  const handleCommitComment = async () => {
    if (!editingComment) return
    try {
      await patchMutation.mutateAsync({
        item_id: editingComment.id,
        patch: { commentaire: editingComment.value },
      })
    } catch (e) {
      toast.error(`Erreur : ${(e as Error).message}`)
    } finally {
      setEditingComment(null)
    }
  }

  const handleGenerateEmail = async () => {
    try {
      const result = await generateEmailMutation.mutateAsync({ nom: 'Dr Ceccoli' })
      setGeneratedEmail(result)
      setEmailSubjectEdit(result.subject)
      setEmailBodyEdit(result.body)
      setTab('email')
    } catch (e) {
      toast.error(`Erreur : ${(e as Error).message}`)
    }
  }

  const handleGenerateReport = async () => {
    try {
      const result = await generateReportMutation.mutateAsync()
      setLastReport({
        filename: result.filename,
        size: result.size_bytes,
        generated_at: result.generated_at,
        ged_doc_id: result.ged_doc_id,
      })
      const replacedNote = result.replaced_count && result.replaced_count > 0
        ? ` (remplace ${result.replaced_count} ancienne(s) version(s))`
        : ''
      toast.success(`Rapport PDF généré (${Math.round(result.size_bytes / 1024)} Ko)${replacedNote} — enregistré en GED`)
    } catch (e) {
      toast.error(`Erreur génération PDF : ${(e as Error).message}`)
    }
  }

  const handleSendGrouped = async () => {
    try {
      // Bundle = génère rapport + email + retourne pièces jointes
      const bundle = await prepareBundleMutation.mutateAsync()
      setLastReport({
        filename: bundle.rapport_filename,
        size: bundle.rapport_size_bytes,
        generated_at: new Date().toISOString(),
        ged_doc_id: bundle.rapport_ged_doc_id,
      })
      setEmailSubjectEdit(bundle.subject)
      setEmailBodyEdit(bundle.body)
      setGeneratedEmail({
        subject: bundle.subject,
        body: bundle.body,
        nb_items: bundle.nb_items,
        related_item_ids: bundle.related_item_ids,
      })
      // Ouvre SendToAccountantDrawer pré-rempli
      openSendDrawer({
        preselected: bundle.attachments as { type: 'export' | 'rapport' | 'releve' | 'justificatif' | 'ged'; filename: string }[],
        defaultSubject: bundle.subject,
        defaultFilter: 'rapport',
      })
      // Log au journal
      try {
        await addJournalMutation.mutateAsync({
          type: 'email_out',
          subject: bundle.subject,
          body_excerpt: bundle.body.slice(0, 500),
          related_item_ids: bundle.related_item_ids,
          author: 'user',
        })
      } catch { /* silent */ }
      toast.success(`Envoi préparé : Rapport PDF + ${bundle.attachments.length - 1} pièce(s) jointe(s)`, { duration: 4500 })
    } catch (e) {
      toast.error(`Erreur préparation envoi : ${(e as Error).message}`)
    }
  }

  // Session 40 P1 — handlers position de repli
  const handleOpenNegociation = async () => {
    const nbConcessions = negociationSynth?.nb_items_total ?? 0
    if (nbConcessions === 0) {
      // Première ouverture : compute auto avant d'ouvrir le drawer
      try {
        await computeNegociationMutation.mutateAsync({ force_recompute: false })
        toast.success('Position de repli calculée')
      } catch (e) {
        toast.error(`Erreur calcul : ${(e as Error).message}`)
        return
      }
    }
    openNegociationDrawer()
  }

  const handleResetAllConcessions = async () => {
    if (!window.confirm('Réinitialiser toutes les positions de repli en mode auto (efface les overrides manuels) ?')) {
      return
    }
    try {
      await computeNegociationMutation.mutateAsync({ force_recompute: true })
      toast.success('Positions de repli réinitialisées')
    } catch (e) {
      toast.error(`Erreur : ${(e as Error).message}`)
    }
  }

  const handleInjectIntoEmail = async () => {
    closeNegociationDrawer()
    await handleSendGrouped()
  }

  const handleSendToAccountant = async () => {
    // Legacy : on garde le bouton "Préparer envoi" simple pour les cas où on ne veut pas régénérer le PDF
    if (!generatedEmail || !gedDocumentId) {
      toast.error('Génère d\'abord l\'email')
      return
    }
    const preselected: { type: 'export' | 'rapport' | 'releve' | 'justificatif' | 'ged'; filename: string }[] = [
      { type: 'ged', filename: gedDocumentId.split('/').pop() || gedDocumentId },
    ]
    if (lastReport) {
      preselected.unshift({ type: 'rapport', filename: lastReport.filename })
    }
    openSendDrawer({
      preselected,
      defaultSubject: emailSubjectEdit,
      defaultFilter: 'rapport',
    })
    try {
      await addJournalMutation.mutateAsync({
        type: 'email_out',
        subject: emailSubjectEdit,
        body_excerpt: emailBodyEdit.slice(0, 500),
        related_item_ids: generatedEmail.related_item_ids,
        author: 'user',
      })
    } catch { /* silent */ }
    toast.success('Drawer envoi ouvert')
  }

  const handleCopyEmail = () => {
    const full = `Objet : ${emailSubjectEdit}\n\n${emailBodyEdit}`
    navigator.clipboard.writeText(full).then(
      () => toast.success('Email copié dans le presse-papiers'),
      () => toast.error('Impossible de copier'),
    )
  }

  if (!isOpen || year === null) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={close} />

      {/* Drawer (resizable via handle drag, persisté en localStorage) */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full max-w-[95vw] bg-background border-l border-border z-50',
          'flex flex-col',
        )}
        style={{
          width: `${drawerWidth}px`,
          transition: isResizing.current ? 'none' : 'width 200ms ease-out',
        }}
      >
        {/* Resize handle bord gauche */}
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 group hover:bg-primary/30 active:bg-primary/50 transition-colors"
          title="Glisser pour redimensionner"
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-12 rounded-full bg-border group-hover:bg-primary transition-colors" />
        </div>
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span
                className="inline-block text-[10px] font-medium px-2 py-0.5 rounded"
                style={{ background: '#EEEDFE', color: '#3C3489' }}
              >
                Plaquette comptable
              </span>
              <span className="text-[10px] text-text-muted">
                {data?.cabinet_template === 'sygnatures_marenco' ? 'Sygnatures Marenco' : data?.cabinet_template}
              </span>
              {data?.status && (
                <PlaquetteStatusBadge
                  status={data.status}
                  declaredAt={data.declared_at}
                  declarationRef={data.declaration_ref}
                />
              )}
            </div>
            <h2 className="text-lg font-semibold text-text">Vérification — Exercice {year}</h2>
            {data?.updated_at && (
              <p className="text-[10px] text-text-muted mt-0.5">
                MAJ {new Date(data.updated_at).toLocaleString('fr-FR')}
              </p>
            )}
          </div>
          {data && (
            <PlaquetteStatusActionsMenu
              check={data}
              onOpenFinalize={() => setFinalizeOpen(true)}
            />
          )}
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded hover:bg-surface-hover shrink-0"
            aria-label="Recharger"
            title="Recharger (recalcule les montants NeuronX)"
          >
            <RefreshCw size={16} className="text-text-muted" />
          </button>
          <button onClick={close} className="p-1.5 rounded hover:bg-surface-hover shrink-0" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 border-b border-border flex items-center gap-1">
          {[
            { key: 'comparatif' as Tab, label: 'Comparatif', icon: FileSpreadsheet, badge: counts.a_challenger > 0 ? counts.a_challenger : undefined, badgeColor: 'bg-warning' },
            { key: 'saisie' as Tab, label: 'Saisie manuelle', icon: Save, badge: undefined, badgeColor: '' },
            { key: 'email' as Tab, label: 'Email challenge', icon: Mail, badge: generatedEmail?.nb_items, badgeColor: 'bg-primary' },
            { key: 'archives' as Tab, label: 'Archives', icon: Archive, badge: undefined, badgeColor: 'bg-primary' },
            { key: 'journal' as Tab, label: 'Journal', icon: BookOpen, badge: (data?.journal?.length || 0) || undefined, badgeColor: 'bg-text-muted' },
          ].map(({ key, label, icon: Icon, badge, badgeColor }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors',
                tab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              <Icon size={14} />
              {label}
              {badge !== undefined && badge > 0 && (
                <span className={cn('text-[10px] text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center', badgeColor)}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-64 text-text-muted">
              <Loader2 size={20} className="animate-spin mr-2" />
              Chargement…
            </div>
          )}

          {!isLoading && tab === 'comparatif' && (
            <ComparatifTab
              items={items}
              counts={counts}
              totalEcartChallenger={totalEcartChallenger}
              expandedItem={expandedItem}
              setExpandedItem={setExpandedItem}
              editingMontant={editingMontant}
              setEditingMontant={setEditingMontant}
              editingComment={editingComment}
              setEditingComment={setEditingComment}
              year={year}
              onCommitMontant={handleCommitMontant}
              onCommitComment={handleCommitComment}
              onStatutChange={handleStatutChange}
              onDeleteItem={(id) => {
                if (confirm('Supprimer cet item ?')) deleteMutation.mutate(id)
              }}
              onGenerateEmail={handleGenerateEmail}
              isGenerating={generateEmailMutation.isPending}
              totauxPlaquette={data?.totaux_plaquette || {}}
              bncNeuronx={dashboard?.bnc?.solde_bnc}
              chargesProNeuronx={dashboard?.bnc?.charges_pro}
              recettesNeuronx={dashboard?.bnc?.recettes_pro}
              readOnly={!isPlaquetteEditable(data)}
              status={data?.status ?? 'en_cours'}
              declaredAt={data?.declared_at ?? null}
              checkData={data}
              riskFilter={riskFilter}
              onRiskFilterChange={setRiskFilter}
              onOpenRiskOverride={setRiskOverrideItemId}
            />
          )}

          {!isLoading && tab === 'saisie' && (
            <SaisieTab items={items} year={year} />
          )}

          {!isLoading && tab === 'email' && (
            <EmailTab
              generated={generatedEmail}
              subjectEdit={emailSubjectEdit}
              bodyEdit={emailBodyEdit}
              onSubjectChange={setEmailSubjectEdit}
              onBodyChange={setEmailBodyEdit}
              onGenerate={handleGenerateEmail}
              onSend={handleSendToAccountant}
              onCopy={handleCopyEmail}
              onGenerateReport={handleGenerateReport}
              onSendGrouped={handleSendGrouped}
              isGenerating={generateEmailMutation.isPending}
              isGeneratingReport={generateReportMutation.isPending}
              isPreparingBundle={prepareBundleMutation.isPending}
              hasGedDoc={!!gedDocumentId}
              lastReport={lastReport}
              nbChallenger={counts.a_challenger}
              isDeclared={data?.status === 'declare'}
              declaredAt={data?.declared_at ?? null}
              nbRisqueEleveOuCritique={items.filter(it =>
                it.risque_fiscal && ['eleve', 'critique'].includes(it.risque_fiscal.niveau)
                && it.statut !== 'resolu' && it.statut !== 'refus_justifie'
              ).length}
              nbConcessions={negociationSynth?.nb_items_total ?? 0}
              bncSimule={negociationSynth?.bnc_simule ?? null}
              isPreparingConcessions={computeNegociationMutation.isPending}
              onOpenNegociation={handleOpenNegociation}
              onResetAllConcessions={handleResetAllConcessions}
            />
          )}

          {!isLoading && tab === 'archives' && (
            <ArchivesTab year={year} />
          )}

          {!isLoading && tab === 'journal' && (
            <JournalTab
              journal={data?.journal || []}
              year={year}
              items={items}
              journalView={journalView}
              onJournalViewChange={setJournalView}
            />
          )}
        </div>
      </div>
      {/* Session 39 P1 — wizard finalisation. Mount conditionnel pour state frais. */}
      {finalizeOpen && data && (
        <PlaquetteFinalizationModal
          check={data}
          onClose={() => setFinalizeOpen(false)}
          onFinalized={() => refetch()}
        />
      )}
      {/* Session 39 P2 — modal override risque. Mount conditionnel. */}
      {riskOverrideItemId && data && year !== null && (() => {
        const item = data.items.find((i) => i.item_id === riskOverrideItemId)
        if (!item) return null
        return (
          <PlaquetteRisqueOverrideModal
            year={year}
            item={item}
            onClose={() => setRiskOverrideItemId(null)}
          />
        )
      })()}
      {/* Session 40 P1 — sous-drawer Position de repli. Le drawer gère lui-même sa visibilité via le store. */}
      <PlaquetteNegociationDrawer
        onInjectIntoEmail={handleInjectIntoEmail}
        injectingBundle={prepareBundleMutation.isPending}
      />
    </>
  )
}

// ─── Onglet Comparatif ───

function ComparatifTab(props: {
  items: PlaquetteItem[]
  counts: Record<PlaquetteItemStatut, number>
  totalEcartChallenger: number
  expandedItem: string | null
  setExpandedItem: (id: string | null) => void
  editingMontant: { id: string; value: string } | null
  setEditingMontant: (v: { id: string; value: string } | null) => void
  editingComment: { id: string; value: string } | null
  setEditingComment: (v: { id: string; value: string } | null) => void
  year: number
  onCommitMontant: () => void
  onCommitComment: () => void
  onStatutChange: (id: string, s: PlaquetteItemStatut) => void
  onDeleteItem: (id: string) => void
  onGenerateEmail: () => void
  isGenerating: boolean
  totauxPlaquette: { recettes?: number; depenses?: number; benefice?: number; recettes_n1?: number; depenses_n1?: number; benefice_n1?: number }
  bncNeuronx?: number
  chargesProNeuronx?: number
  recettesNeuronx?: number
  // Session 39 P1 — read-only quand status != en_cours
  readOnly: boolean
  status: 'en_cours' | 'validation_finale' | 'declare'
  declaredAt: string | null
  // Session 39 P2 — risque fiscal
  checkData: import('@/types').PlaquetteCheck | undefined
  riskFilter: RisqueNiveau | 'overridden' | null
  onRiskFilterChange: (f: RisqueNiveau | 'overridden' | null) => void
  onOpenRiskOverride: (itemId: string) => void
}) {
  const {
    items, counts, totalEcartChallenger, expandedItem, setExpandedItem,
    editingMontant, setEditingMontant, editingComment, setEditingComment,
    year, onCommitMontant, onCommitComment, onStatutChange, onDeleteItem,
    onGenerateEmail, isGenerating, totauxPlaquette,
    bncNeuronx, chargesProNeuronx, recettesNeuronx,
    readOnly, status, declaredAt,
    checkData, riskFilter, onRiskFilterChange, onOpenRiskOverride,
  } = props

  const ecartBnc = useMemo(() => {
    if (bncNeuronx === undefined || totauxPlaquette.benefice === undefined) return null
    return bncNeuronx - totauxPlaquette.benefice
  }, [bncNeuronx, totauxPlaquette.benefice])

  const declaredDateFr = declaredAt
    ? new Date(declaredAt).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : null

  // Session 39 P3 — handlers pour la card "Aucune plaquette téléversée"
  const navigate = useNavigate()
  const closeDrawer = usePlaquetteCheckDrawerStore((s) => s.close)

  // Session 39 P2 — filtrage + tri par risque
  const filteredItems = useMemo(() => {
    if (!riskFilter) return items
    return items.filter((it) => {
      const r = it.risque_fiscal
      if (!r) return false
      if (riskFilter === 'overridden') return !r.auto_calcule
      return r.niveau === riskFilter
    })
  }, [items, riskFilter])

  return (
    <div className="p-5">
      {/* Session 39 P3 — Card info quand aucune plaquette téléversée */}
      {!checkData?.ged_doc_id && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 flex-none mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-400 mb-1">
                Aucune plaquette comptable {year} n'est encore téléversée.
              </div>
              <div className="text-xs text-amber-400/80 mb-3 leading-relaxed">
                Vous pouvez quand même préparer la vérification en consultant vos agrégats
                NeuronX ci-dessous. Saisissez les montants plaquette manuellement, ou
                téléversez le PDF dès réception du comptable.
              </div>
              <button
                type="button"
                onClick={() => {
                  closeDrawer()
                  navigate(`/ged?type=plaquette_comptable&year=${year}`)
                }}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 rounded border border-amber-500/40 text-amber-400 font-medium"
              >
                Téléverser la plaquette
                <ExternalLink size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session 39 P1 — bandeau statut éditorial */}
      {readOnly && (
        <div
          className={cn(
            'mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
            status === 'declare'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : 'border-sky-500/40 bg-sky-500/10 text-sky-400',
          )}
        >
          <Lock size={13} className="flex-none" />
          <span>
            {status === 'declare' && declaredDateFr
              ? `Exercice déclaré le ${declaredDateFr} — items verrouillés jusqu'à prescription (art. L169 LPF, 4 ans)`
              : status === 'validation_finale'
              ? 'Items verrouillés (validation finale) — utilise « Revenir en cours » dans le header pour modifier'
              : 'Items verrouillés'}
          </span>
        </div>
      )}

      {/* Session 39 P2 — Summary risque fiscal */}
      {checkData && (
        <PlaquetteRisqueDrawerSummary check={checkData} readOnly={readOnly} />
      )}

      {/* Session 39 P2 — Chips filtre par niveau risque */}
      <div className="mb-3 flex items-center gap-1.5 flex-wrap text-[11px]">
        <span className="text-text-muted">Filtrer par risque :</span>
        {[
          { value: null as RisqueNiveau | 'overridden' | null, label: 'Tous', classes: 'border-border text-text-muted hover:bg-surface' },
          { value: 'critique' as const, label: 'Critique', classes: 'border-red-500/40 text-red-400 hover:bg-red-500/10' },
          { value: 'eleve' as const, label: 'Élevé', classes: 'border-orange-500/40 text-orange-400 hover:bg-orange-500/10' },
          { value: 'modere' as const, label: 'Modéré', classes: 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10' },
          { value: 'faible' as const, label: 'Faible', classes: 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10' },
          { value: 'overridden' as const, label: 'M (manuel)', classes: 'border-purple-500/40 text-purple-400 hover:bg-purple-500/10' },
        ].map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onRiskFilterChange(opt.value)}
            className={cn(
              'px-2 py-0.5 rounded-full border transition-colors',
              opt.classes,
              riskFilter === opt.value && 'ring-2 ring-offset-1 ring-offset-background',
            )}
          >
            {opt.label}
          </button>
        ))}
        {riskFilter !== null && (
          <span className="text-[10px] text-text-muted ml-2 italic">
            {filteredItems.length} / {items.length} affichés
          </span>
        )}
      </div>
      {/* Bandeau synthèse BNC */}
      {totauxPlaquette.benefice !== undefined && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-gradient-to-br from-primary/5 to-primary/0 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-primary">Synthèse BNC — Exercice {year}</div>
            {ecartBnc !== null && (
              <div className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded',
                Math.abs(ecartBnc) < 2000 ? 'bg-success/15 text-success'
                : ecartBnc < 0 ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-warning/15 text-warning',
              )}>
                Écart BNC : {ecartBnc >= 0 ? '+' : ''}{formatCurrency(ecartBnc)}
                {ecartBnc < 0 && ' (NeuronX déduit plus de charges → BNC plus faible → moins d\'impôts)'}
                {ecartBnc > 2000 && ' (le comptable a déduit plus que NeuronX)'}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <KpiCell
              label="Recettes pro"
              plaquette={totauxPlaquette.recettes}
              neuronx={recettesNeuronx}
              recettesN1={totauxPlaquette.recettes_n1}
            />
            <KpiCell
              label="Charges déductibles"
              plaquette={totauxPlaquette.depenses}
              neuronx={chargesProNeuronx}
              recettesN1={totauxPlaquette.depenses_n1}
              isCharge
            />
            <KpiCell
              label="Bénéfice fiscal (BNC)"
              plaquette={totauxPlaquette.benefice}
              neuronx={bncNeuronx}
              recettesN1={totauxPlaquette.benefice_n1}
              highlight
            />
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="flex items-center justify-between gap-3 mb-4 p-3 rounded-lg border border-border bg-surface/40">
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-text-muted">Items : </span>
            <span className="font-semibold">{items.length}</span>
          </div>
          {Object.entries(counts).map(([statut, n]) => {
            if (n === 0) return null
            const style = STATUT_STYLES[statut as PlaquetteItemStatut]
            return (
              <div key={statut} className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]', style.bg, style.text)}>
                <style.icon size={10} />
                {STATUT_LABELS[statut as PlaquetteItemStatut]}: {n}
              </div>
            )
          })}
        </div>
        <button
          onClick={onGenerateEmail}
          disabled={isGenerating || counts.a_challenger === 0}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
          Générer email challenge {counts.a_challenger > 0 && `(${counts.a_challenger})`}
        </button>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="">
            <tr>
              <th className="sticky top-0 z-20 bg-surface px-2 py-2 text-left font-medium text-text-muted w-8 shadow-[0_1px_0_0_var(--color-border)]"></th>
              <th className="sticky top-0 z-20 bg-surface px-2 py-2 text-left font-medium text-text-muted shadow-[0_1px_0_0_var(--color-border)]">PCG</th>
              <th className="sticky top-0 z-20 bg-surface px-2 py-2 text-left font-medium text-text-muted shadow-[0_1px_0_0_var(--color-border)]">Libellé</th>
              <th className="sticky top-0 z-20 bg-surface px-2 py-2 text-right font-medium text-text-muted shadow-[0_1px_0_0_var(--color-border)]">Plaquette</th>
              <th className="sticky top-0 z-20 bg-surface px-2 py-2 text-right font-medium text-text-muted shadow-[0_1px_0_0_var(--color-border)]">NeuronX</th>
              <th className="sticky top-0 z-20 bg-surface px-2 py-2 text-right font-medium text-text-muted shadow-[0_1px_0_0_var(--color-border)]">Écart</th>
              <th className="sticky top-0 z-20 bg-surface px-2 py-2 text-left font-medium text-text-muted shadow-[0_1px_0_0_var(--color-border)]">Statut</th>
              <th className="sticky top-0 z-20 bg-surface px-2 py-2 text-left font-medium text-text-muted shadow-[0_1px_0_0_var(--color-border)]">Risque</th>
              <th className="sticky top-0 z-20 bg-surface px-2 py-2 text-left font-medium text-text-muted shadow-[0_1px_0_0_var(--color-border)]">Commentaire</th>
              <th className="sticky top-0 z-20 bg-surface px-2 py-2 w-8 shadow-[0_1px_0_0_var(--color-border)]"></th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => {
              const expanded = expandedItem === item.item_id
              const ecart = fmtEcart(item.ecart)
              const statutStyle = STATUT_STYLES[item.statut]
              return (
                <Row
                  key={item.item_id}
                  item={item}
                  expanded={expanded}
                  setExpanded={(b) => setExpandedItem(b ? item.item_id : null)}
                  year={year}
                  editingMontant={editingMontant}
                  setEditingMontant={setEditingMontant}
                  editingComment={editingComment}
                  setEditingComment={setEditingComment}
                  onCommitMontant={onCommitMontant}
                  onCommitComment={onCommitComment}
                  onStatutChange={onStatutChange}
                  onDelete={onDeleteItem}
                  ecart={ecart}
                  statutStyle={statutStyle}
                  readOnly={readOnly}
                  onOpenRiskOverride={onOpenRiskOverride}
                />
              )
            })}
          </tbody>
          {totalEcartChallenger !== 0 && (
            <tfoot>
              <tr className="bg-warning/10 border-t-2 border-warning/40 font-semibold">
                <td colSpan={5} className="px-2 py-2 text-right text-warning">
                  Écart total des items à challenger ({counts.a_challenger}) :
                </td>
                <td className={cn('px-2 py-2 text-right tabular-nums', totalEcartChallenger >= 0 ? 'text-emerald-400' : 'text-danger')}>
                  {totalEcartChallenger >= 0 ? '+' : ''}{formatCurrency(totalEcartChallenger)}
                </td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function KpiCell({
  label, plaquette, neuronx, recettesN1, isCharge, highlight,
}: {
  label: string
  plaquette: number | undefined
  neuronx: number | undefined
  recettesN1: number | undefined
  isCharge?: boolean
  highlight?: boolean
}) {
  const ecart = (plaquette !== undefined && neuronx !== undefined) ? neuronx - plaquette : null
  const variation_n = (plaquette !== undefined && recettesN1 !== undefined && recettesN1 !== 0)
    ? ((plaquette - recettesN1) / recettesN1) * 100
    : null
  return (
    <div className={cn('rounded-md p-3 border', highlight ? 'bg-primary/10 border-primary/40' : 'bg-surface/40 border-border')}>
      <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">{label}</div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="text-[10px] text-text-muted">Plaquette</div>
        <div className={cn('text-base font-semibold tabular-nums', highlight ? 'text-primary' : 'text-text')}>
          {plaquette !== undefined ? formatCurrency(plaquette) : '—'}
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="text-[10px] text-text-muted">NeuronX</div>
        <div className="text-sm tabular-nums text-text-muted">
          {neuronx !== undefined ? formatCurrency(neuronx) : '—'}
        </div>
      </div>
      {ecart !== null && (
        <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-border/40">
          <div className="text-[10px] text-text-muted">Écart</div>
          <div className={cn(
            'text-xs font-medium tabular-nums',
            Math.abs(ecart) < 100 ? 'text-text-muted'
            : (isCharge ? (ecart < 0 ? 'text-warning' : 'text-emerald-400')  // pour les charges, plus = mieux
                        : (ecart < 0 ? 'text-danger' : 'text-emerald-400')),
          )}>
            {ecart >= 0 ? '+' : ''}{formatCurrency(ecart)}
          </div>
        </div>
      )}
      {variation_n !== null && (
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[10px] text-text-muted">vs N-1</div>
          <div className={cn(
            'text-[10px] tabular-nums',
            variation_n > 5 ? 'text-emerald-400' : variation_n < -5 ? 'text-warning' : 'text-text-muted',
          )}>
            {variation_n >= 0 ? '+' : ''}{variation_n.toFixed(1)} %
          </div>
        </div>
      )}
    </div>
  )
}

function Row(props: {
  item: PlaquetteItem
  expanded: boolean
  setExpanded: (b: boolean) => void
  year: number
  editingMontant: { id: string; value: string } | null
  setEditingMontant: (v: { id: string; value: string } | null) => void
  editingComment: { id: string; value: string } | null
  setEditingComment: (v: { id: string; value: string } | null) => void
  onCommitMontant: () => void
  onCommitComment: () => void
  onStatutChange: (id: string, s: PlaquetteItemStatut) => void
  onDelete: (id: string) => void
  ecart: { text: string; color: string }
  statutStyle: { bg: string; text: string; border: string; icon: typeof CheckCircle2 }
  readOnly?: boolean  // Session 39 P1
  onOpenRiskOverride?: (itemId: string) => void  // Session 39 P2
}) {
  const {
    item, expanded, setExpanded, year,
    editingMontant, setEditingMontant, editingComment, setEditingComment,
    onCommitMontant, onCommitComment, onStatutChange, onDelete, ecart, statutStyle,
    readOnly = false, onOpenRiskOverride,
  } = props

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-surface/30">
        <td className="px-1 py-1.5">
          {item.nb_ops_neuronx > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-0.5 rounded hover:bg-surface-hover"
              aria-label={expanded ? 'Réduire' : 'Voir les ops'}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          )}
        </td>
        <td className="px-2 py-1.5 font-mono text-[10px] text-text-muted">{item.compte_pcg || '—'}</td>
        <td className="px-2 py-1.5">
          <div className="text-text">{item.compte_label}</div>
          {item.rubrique_2035 && (
            <div className="text-[10px] text-text-muted">{item.rubrique_2035}</div>
          )}
          {item.categories_neuronx.length > 0 && (
            <div className="flex items-center gap-1 mt-0.5">
              {item.categories_neuronx.slice(0, 3).map((c) => (
                <span key={c} className="text-[9px] px-1 py-px rounded bg-primary/10 text-primary">{c}</span>
              ))}
            </div>
          )}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {editingMontant?.id === item.item_id && !readOnly ? (
            <input
              type="text"
              value={editingMontant.value}
              onChange={(e) => setEditingMontant({ id: item.item_id, value: e.target.value })}
              onBlur={onCommitMontant}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitMontant()
                else if (e.key === 'Escape') setEditingMontant(null)
              }}
              className="w-24 px-1.5 py-0.5 rounded border border-primary bg-background text-right tabular-nums text-xs"
              autoFocus
              placeholder="0,00"
            />
          ) : (
            <button
              disabled={readOnly}
              onClick={() => {
                if (readOnly) return
                setEditingMontant({
                  id: item.item_id,
                  value: item.montant_plaquette !== null
                    ? item.montant_plaquette.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : '',
                })
              }}
              className={cn(
                'px-1 py-0.5 rounded text-xs',
                readOnly ? 'cursor-default text-text-muted' : 'hover:bg-surface-hover',
              )}
              title={readOnly ? 'Plaquette verrouillée' : 'Cliquer pour éditer'}
            >
              {fmtMontant(item.montant_plaquette)}
            </button>
          )}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
          <div>{fmtMontant(item.montant_neuronx)}</div>
          {item.nb_ops_neuronx > 0 && (
            <div className="text-[9px]">({item.nb_ops_neuronx} ops)</div>
          )}
        </td>
        <td className={cn('px-2 py-1.5 text-right tabular-nums font-semibold', ecart.color)}>
          {ecart.text}
        </td>
        <td className="px-2 py-1.5">
          <select
            value={item.statut}
            onChange={(e) => onStatutChange(item.item_id, e.target.value as PlaquetteItemStatut)}
            disabled={readOnly}
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded border bg-background',
              statutStyle.text, statutStyle.border,
              readOnly && 'cursor-not-allowed opacity-70',
            )}
            title={readOnly ? 'Plaquette verrouillée' : undefined}
          >
            {Object.entries(STATUT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </td>
        {/* Session 39 P2 — Cellule risque */}
        <td className="px-2 py-1.5">
          <PlaquetteRisqueChip
            risque={item.risque_fiscal}
            onClick={onOpenRiskOverride ? () => onOpenRiskOverride(item.item_id) : undefined}
            readOnly={readOnly}
            compact
          />
        </td>
        <td className="px-2 py-1.5 max-w-[280px]">
          {editingComment?.id === item.item_id && !readOnly ? (
            <textarea
              value={editingComment.value}
              onChange={(e) => setEditingComment({ id: item.item_id, value: e.target.value })}
              onBlur={onCommitComment}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onCommitComment()
                else if (e.key === 'Escape') setEditingComment(null)
              }}
              className="w-full px-1.5 py-0.5 rounded border border-primary bg-background text-xs resize-none"
              rows={2}
              autoFocus
              placeholder="Note ou question pour le comptable… (⌘+Enter pour valider)"
            />
          ) : (
            <button
              disabled={readOnly}
              onClick={() => {
                if (readOnly) return
                setEditingComment({ id: item.item_id, value: item.commentaire || '' })
              }}
              className={cn(
                'text-left w-full px-1 py-0.5 rounded text-text-muted italic text-[11px]',
                readOnly ? 'cursor-default' : 'hover:bg-surface-hover',
              )}
              title={readOnly ? 'Plaquette verrouillée' : undefined}
            >
              {item.commentaire || (readOnly ? '—' : '+ ajouter')}
            </button>
          )}
        </td>
        <td className="px-1 py-1.5">
          {!readOnly && (
            <button
              onClick={() => onDelete(item.item_id)}
              className="p-0.5 rounded hover:bg-danger/10 text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Supprimer"
              title="Supprimer cet item"
            >
              <Trash2 size={11} />
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="bg-surface/20 px-4 py-3 border-b border-border">
            <DrillDownOps year={year} itemId={item.item_id} />
          </td>
        </tr>
      )}
    </>
  )
}

function DrillDownOps({ year, itemId }: { year: number; itemId: string }) {
  const { data, isLoading } = usePlaquetteItemOps(year, itemId)
  const navigate = useNavigate()
  const closeDrawer = usePlaquetteCheckDrawerStore((s) => s.close)

  if (isLoading) return <div className="text-text-muted text-xs flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Chargement…</div>
  if (!data || data.operations.length === 0) return <div className="text-text-muted text-xs italic">Aucune opération NeuronX correspondante</div>

  const handleOpenInEditor = (file: string, index: number) => {
    closeDrawer()
    navigate(`/editor?file=${encodeURIComponent(file)}&highlight=${index}&from=plaquette`)
  }

  return (
    <div>
      <div className="text-[10px] text-text-muted mb-2 font-medium">{data.nb_ops} opérations NeuronX (triées par montant) :</div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-surface/40 sticky top-0">
            <tr>
              <th className="px-2 py-1 text-left text-text-muted">Date</th>
              <th className="px-2 py-1 text-left text-text-muted">Libellé</th>
              <th className="px-2 py-1 text-left text-text-muted">Cat / Sous-cat</th>
              <th className="px-2 py-1 text-right text-text-muted">Débit</th>
              <th className="px-2 py-1 text-center text-text-muted">📎</th>
              <th className="px-2 py-1 text-center text-text-muted">🔒</th>
              <th className="px-2 py-1 text-center text-text-muted w-8"></th>
            </tr>
          </thead>
          <tbody>
            {data.operations.map((op) => (
              <tr key={`${op.file}:${op.index}`} className="border-b border-border/30 hover:bg-surface/40 group/op">
                <td className="px-2 py-1 text-text-muted whitespace-nowrap">{op.date || '—'}</td>
                <td className="px-2 py-1 truncate max-w-[280px]" title={op.libelle}>{op.libelle}</td>
                <td className="px-2 py-1 text-text-muted">
                  {op.categorie}{op.sous_categorie ? ` › ${op.sous_categorie}` : ''}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-danger">
                  {op.debit > 0 ? formatCurrency(op.debit) : ''}
                </td>
                <td className="px-2 py-1 text-center">
                  {op.justificatif && <CheckCircle2 size={10} className="text-emerald-400 inline" />}
                </td>
                <td className="px-2 py-1 text-center">
                  {op.locked && <span className="text-warning" title="Verrouillée">🔒</span>}
                </td>
                <td className="px-1 py-1 text-center">
                  <button
                    onClick={() => handleOpenInEditor(op.file, op.index)}
                    className="p-1 rounded hover:bg-primary/15 text-text-muted hover:text-primary opacity-0 group-hover/op:opacity-100 transition-opacity"
                    title="Ouvrir cette opération dans l'éditeur"
                  >
                    <ExternalLink size={11} />
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

// ─── Onglet Saisie manuelle (raccourci : juste un message guide en MVP) ───

function SaisieTab({ items, year: _year }: { items: PlaquetteItem[]; year: number }) {
  const filledCount = items.filter((i) => i.montant_plaquette !== null).length
  return (
    <div className="p-5">
      <div className="rounded-lg border border-border bg-surface/20 p-4 mb-4">
        <h3 className="text-sm font-semibold mb-2">Saisie manuelle des montants</h3>
        <p className="text-xs text-text-muted mb-3">
          Pour la Phase 1 MVP, la saisie se fait directement dans l'onglet <strong>Comparatif</strong> en cliquant sur les
          montants &laquo; — &raquo; dans la colonne <strong>Plaquette</strong>. Tu peux aussi modifier les statuts
          et commentaires inline.
        </p>
        <p className="text-xs text-text-muted">
          <strong>Progression :</strong> {filledCount} / {items.length} lignes saisies.
        </p>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start gap-2">
          <FileSpreadsheet size={16} className="text-primary mt-0.5 shrink-0" />
          <div className="text-xs">
            <p className="font-medium text-primary mb-1">Pour reproduire la plaquette 2025 (référence)</p>
            <p className="text-text-muted">
              Ouvre le PDF côte à côte ("Détail de la 2035" pages 7-8) et saisis les montants par compte.
              Le calcul NeuronX se met à jour automatiquement à chaque sauvegarde.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Onglet Email Challenge ───

function EmailTab(props: {
  generated: { subject: string; body: string; nb_items: number; related_item_ids: string[] } | null
  subjectEdit: string
  bodyEdit: string
  onSubjectChange: (v: string) => void
  onBodyChange: (v: string) => void
  onGenerate: () => void
  onSend: () => void
  onCopy: () => void
  onGenerateReport: () => void
  onSendGrouped: () => void
  isGenerating: boolean
  isGeneratingReport: boolean
  isPreparingBundle: boolean
  hasGedDoc: boolean
  lastReport: { filename: string; size: number; generated_at: string; ged_doc_id: string | null } | null
  nbChallenger: number
  // Session 39 P1
  isDeclared: boolean
  declaredAt: string | null
  // Session 39 P2
  nbRisqueEleveOuCritique: number
  // Session 40 P1 — position de repli
  nbConcessions: number
  bncSimule: number | null
  isPreparingConcessions: boolean
  onOpenNegociation: () => void
  onResetAllConcessions: () => void
}) {
  const {
    generated, subjectEdit, bodyEdit, onSubjectChange, onBodyChange,
    onGenerate, onSend, onCopy, onGenerateReport, onSendGrouped,
    isGenerating, isGeneratingReport, isPreparingBundle, hasGedDoc,
    lastReport, nbChallenger, isDeclared, declaredAt,
    nbRisqueEleveOuCritique,
    nbConcessions, bncSimule, isPreparingConcessions,
    onOpenNegociation, onResetAllConcessions,
  } = props

  const declaredDateFr = declaredAt
    ? new Date(declaredAt).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : null

  return (
    <div className="p-5 space-y-4">
      {/* Session 39 P1 — bannière declare en lecture seule */}
      {isDeclared && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
          <div className="flex items-start gap-2">
            <Lock size={14} className="mt-0.5 flex-none text-emerald-400" />
            <p className="text-xs text-emerald-400">
              <strong>Exercice déclaré{declaredDateFr ? ` le ${declaredDateFr}` : ''}.</strong>{' '}
              Les rapports et envois restent consultables en lecture seule. Le journal
              reste appendable pour logger les questions fiscalistes ultérieures.
            </p>
          </div>
        </div>
      )}

      {/* WORKFLOW RECOMMANDÉ : envoi groupé en 1 clic */}
      <div className={cn(
        'rounded-lg border bg-gradient-to-br p-4',
        isDeclared ? 'border-border/50 from-surface/40 to-surface/0' : 'border-primary/40 from-primary/10 to-primary/0',
      )}>
        <div className="flex items-start gap-3 mb-3">
          <div className={cn('rounded-full p-2 shrink-0', isDeclared ? 'bg-text-muted/20' : 'bg-primary/20')}>
            <Send size={18} className={isDeclared ? 'text-text-muted' : 'text-primary'} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-text mb-1">Workflow recommandé — Envoi groupé en 1 clic</h3>
            <p className="text-[11px] text-text-muted">
              Génère <strong>automatiquement</strong> le rapport PDF de vérification (synthèse BNC + anomalies argumentées + tableau complet),
              construit l'email texte, et pré-remplit le drawer d'envoi avec <strong>2 pièces jointes</strong> :
              le rapport et la plaquette comptable originale.
            </p>
          </div>
        </div>
        <button
          onClick={onSendGrouped}
          disabled={isPreparingBundle || nbChallenger === 0 || !hasGedDoc || isDeclared}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            isDeclared
              ? 'Exercice déclaré — envoi désactivé (consulte les archives)'
              : nbChallenger === 0
              ? 'Aucun item marqué "à challenger"'
              : !hasGedDoc
              ? 'Le drawer plaquette n\'est pas lié à un doc GED'
              : 'Génère rapport PDF + email + ouvre drawer envoi'
          }
        >
          {isPreparingBundle ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {isPreparingBundle
            ? 'Préparation en cours...'
            : `Préparer envoi groupé (Rapport + Plaquette) — ${nbChallenger} point(s) à challenger`}
        </button>
        {!hasGedDoc && (
          <p className="text-[10px] text-warning mt-2 italic">
            ⚠ Le drawer plaquette n'est pas lié à un doc GED — bouton désactivé. Ouvre la plaquette depuis la GED.
          </p>
        )}
        {nbChallenger === 0 && (
          <p className="text-[10px] text-text-muted mt-2 italic">
            Marque d'abord des items en <strong>"À challenger"</strong> dans l'onglet Comparatif.
          </p>
        )}
        {/* Session 39 P2 — bandeau alerte risque fiscal élevé/critique */}
        {nbRisqueEleveOuCritique > 0 && (
          <div className="mt-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-[11px] text-orange-300 flex items-start gap-2">
            <span className="flex-none">⚠</span>
            <span>
              <strong>{nbRisqueEleveOuCritique} item(s)</strong> avec risque fiscal{' '}
              <strong>élevé ou critique</strong> non résolu(s).{' '}
              Le rapport PDF inclura une section <em>Préparation contrôle fiscal</em> avec le top 5 et les références juridiques applicables.
            </span>
          </div>
        )}
      </div>

      {/* Session 40 P1 — Position de repli (optionnel, alternatif au challenge 100 %) */}
      {nbChallenger > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="rounded-full p-2 shrink-0 bg-amber-500/20">
              <Handshake size={18} className="text-amber-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-text flex items-center gap-2 mb-1">
                Position de repli
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-text-muted/15 text-text-muted">
                  Optionnel
                </span>
              </h3>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Plutôt que challenger 100 % de chaque écart, calibre une position de
                négociation item par item avec <strong>% à céder</strong>, <strong>ton adaptatif</strong>{' '}
                et <strong>argumentation rédigée</strong>. Le moteur propose une recommandation auto basée sur
                le risque fiscal, les pièces et les références BOI/CGI.
              </p>
            </div>
          </div>
          {nbConcessions === 0 ? (
            <button
              onClick={onOpenNegociation}
              disabled={isDeclared || isPreparingConcessions || nbChallenger === 0}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              title={isDeclared ? 'Exercice déclaré — édition désactivée' : undefined}
            >
              {isPreparingConcessions ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isPreparingConcessions ? 'Calcul des positions…' : 'Préparer la position de repli'}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] flex-wrap">
                <CheckCircle2 size={11} className="text-emerald-400" />
                <strong className="text-text">{nbConcessions} item{nbConcessions > 1 ? 's' : ''}</strong> configuré{nbConcessions > 1 ? 's' : ''}
                {bncSimule !== null && (
                  <>
                    <span className="text-text-muted">·</span>
                    <span className="text-text-muted">
                      BNC simulé <strong className="text-text tabular-nums">{formatCurrency(bncSimule)}</strong>
                    </span>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onOpenNegociation}
                  disabled={isDeclared}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[11px] hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Handshake size={12} />
                  Ajuster
                </button>
                <button
                  onClick={onResetAllConcessions}
                  disabled={isDeclared || isPreparingConcessions}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-border bg-surface hover:bg-surface-hover text-[11px] text-text-muted hover:text-text disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Réinitialise toutes les positions en mode auto"
                >
                  {isPreparingConcessions ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Réinitialiser
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section "Rapport PDF" */}
      <div className="rounded-lg border border-border bg-surface/20 p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-semibold text-text flex items-center gap-2">
            <FileSpreadsheet size={14} className="text-primary" />
            Rapport PDF de vérification
          </h3>
          <button
            onClick={onGenerateReport}
            disabled={isGeneratingReport || isDeclared}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] bg-surface-hover hover:bg-surface border border-border disabled:opacity-50 disabled:cursor-not-allowed"
            title={isDeclared ? 'Exercice déclaré — re-génération désactivée' : undefined}
          >
            {isGeneratingReport ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {lastReport ? 'Re-générer' : 'Générer'}
          </button>
        </div>
        {lastReport ? (
          <div className="text-[11px] space-y-2">
            <div className="flex items-center gap-2 text-text-muted">
              <CheckCircle2 size={11} className="text-emerald-400" />
              <span className="font-mono text-text">{lastReport.filename}</span>
              <span>· {Math.round(lastReport.size / 1024)} Ko</span>
            </div>
            <div className="text-[10px] text-text-muted">
              Généré le {new Date(lastReport.generated_at).toLocaleString('fr-FR')} · Enregistré dans la GED comme rapport.
            </div>
            {lastReport.ged_doc_id && (
              <button
                type="button"
                onClick={() => {
                  const docId = lastReport.ged_doc_id!
                  api.post(`/ged/documents/${encodeURIComponent(docId)}/open-native`).catch(() => {
                    window.open(`/api/ged/documents/${encodeURIComponent(docId)}/preview`, '_blank', 'noopener,noreferrer')
                  })
                }}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-surface-hover hover:bg-surface text-[10px] text-text"
                title="Ouvrir le PDF avec Aperçu (macOS)"
              >
                <ExternalLink size={11} />
                Ouvrir avec Aperçu
              </button>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-text-muted italic">
            Aucun rapport généré pour cette session. Le bouton ci-dessus génère un PDF A4 (~30 Ko) avec la synthèse BNC,
            les anomalies argumentées et le tableau complet — il est automatiquement enregistré en GED.
          </p>
        )}
      </div>

      {/* Section "Email texte" (workflow alternatif) */}
      <details className="rounded-lg border border-border bg-surface/10 p-3">
        <summary className="cursor-pointer text-xs font-medium text-text-muted hover:text-text flex items-center gap-2">
          <Mail size={12} />
          Workflow avancé — Éditer le texte de l'email
          {generated && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{generated.nb_items} items</span>}
        </summary>
        <div className="mt-3 space-y-3">
          {!generated ? (
            <button
              onClick={onGenerate}
              disabled={isGenerating}
              className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-surface-hover disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={11} className="animate-spin inline mr-1" /> : <Mail size={11} className="inline mr-1" />}
              Générer le texte de l'email maintenant
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-text-muted">
                  <strong>{generated.nb_items}</strong> item(s) à challenger inclus
                </div>
                <button
                  onClick={onGenerate}
                  disabled={isGenerating}
                  className="text-[10px] px-2 py-0.5 rounded text-text-muted hover:bg-surface-hover flex items-center gap-1"
                >
                  {isGenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  Re-générer
                </button>
              </div>
              <div>
                <label className="block text-[9px] uppercase text-text-muted mb-1">Objet</label>
                <input
                  type="text"
                  value={subjectEdit}
                  onChange={(e) => onSubjectChange(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-border bg-background text-xs"
                />
              </div>
              <div>
                <label className="block text-[9px] uppercase text-text-muted mb-1">Corps</label>
                <textarea
                  value={bodyEdit}
                  onChange={(e) => onBodyChange(e.target.value)}
                  rows={14}
                  className="w-full px-2 py-1.5 rounded border border-border bg-background text-[11px] font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onSend}
                  disabled={!hasGedDoc}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-surface-hover disabled:opacity-50"
                  title={hasGedDoc ? 'Ouvre le drawer Envoi avec rapport (si généré) + plaquette' : 'Document GED non lié'}
                >
                  <Send size={11} />
                  Préparer envoi (texte édité)
                </button>
                <button
                  onClick={onCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-surface-hover"
                >
                  📋 Copier
                </button>
              </div>
            </>
          )}
        </div>
      </details>
    </div>
  )
}

// ─── Onglet Archives — Historique des rapports PDF générés ───

function ArchivesTab({ year }: { year: number }) {
  const { data, isLoading, refetch } = usePlaquetteReportsHistory(year)
  const deleteMutation = useDeletePlaquetteReport(year)

  const handleView = (preview_url: string) => {
    window.open(preview_url, '_blank', 'noopener,noreferrer')
  }

  const handleOpenNative = (doc_id: string, preview_url: string) => {
    api.post(`/ged/documents/${encodeURIComponent(doc_id)}/open-native`).catch(() => {
      // Fallback navigateur si l'open-native échoue (ex. pas macOS, doc bougé)
      window.open(preview_url, '_blank', 'noopener,noreferrer')
    })
  }

  const handleDownload = (filename: string, preview_url: string) => {
    const link = document.createElement('a')
    link.href = preview_url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleDelete = (filename: string) => {
    if (!confirm(`Supprimer définitivement le rapport "${filename}" ?\n\nL'entrée GED et le fichier sur disque seront supprimés. Action irréversible.`)) return
    deleteMutation.mutate(filename, {
      onSuccess: () => toast.success(`Rapport "${filename}" supprimé`),
      onError: (e) => toast.error(`Erreur : ${e.message}`),
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted text-xs">
        <Loader2 size={14} className="animate-spin mr-2" />
        Chargement des archives…
      </div>
    )
  }

  const reports = data?.reports || []

  if (reports.length === 0) {
    return (
      <div className="p-5">
        <div className="rounded-lg border border-border bg-surface/20 p-6 text-center">
          <Archive size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-sm text-text-muted mb-1">Aucun rapport archivé</p>
          <p className="text-[11px] text-text-muted">
            Génère un PDF depuis l'onglet <strong>Email challenge</strong> — chaque rapport est
            automatiquement enregistré ici comme entrée GED <code className="text-[10px] bg-surface px-1 rounded">type: rapport</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-text-muted">
          <strong>{reports.length}</strong> rapport(s) PDF archivé(s) pour l'exercice {year}
        </div>
        <button
          onClick={() => refetch()}
          className="text-[11px] px-2 py-1 rounded text-text-muted hover:bg-surface-hover flex items-center gap-1"
        >
          <RefreshCw size={11} />
          Actualiser
        </button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface/60 border-b border-border">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-text-muted">Date génération</th>
              <th className="px-3 py-2 text-left font-medium text-text-muted">Filename</th>
              <th className="px-3 py-2 text-right font-medium text-text-muted">Taille</th>
              <th className="px-3 py-2 text-center font-medium text-text-muted w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.doc_id} className="border-b border-border/40 hover:bg-surface/30">
                <td className="px-3 py-2 text-text-muted whitespace-nowrap">
                  {r.generated_at ? new Date(r.generated_at).toLocaleString('fr-FR') : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-text" title={r.filename}>
                  {r.filename}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-text-muted whitespace-nowrap">
                  {r.size_bytes !== null ? `${Math.round(r.size_bytes / 1024)} Ko` : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => handleView(r.preview_url)}
                      className="p-1.5 rounded hover:bg-primary/15 text-text-muted hover:text-primary"
                      title="Voir le PDF dans un nouvel onglet"
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      onClick={() => handleOpenNative(r.doc_id, r.preview_url)}
                      className="p-1.5 rounded hover:bg-primary/15 text-text-muted hover:text-primary"
                      title="Ouvrir avec Aperçu (macOS)"
                    >
                      <ExternalLink size={13} />
                    </button>
                    <button
                      onClick={() => handleDownload(r.filename, r.preview_url)}
                      className="p-1.5 rounded hover:bg-primary/15 text-text-muted hover:text-primary"
                      title="Télécharger le PDF"
                    >
                      <Download size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(r.filename)}
                      disabled={deleteMutation.isPending}
                      className="p-1.5 rounded hover:bg-danger/15 text-text-muted hover:text-danger disabled:opacity-50"
                      title="Supprimer le rapport (GED + disque)"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-text-muted italic">
        Tous les rapports sont enregistrés dans la GED comme <code className="text-[9px] bg-surface px-1 rounded">type: rapport</code>,{' '}
        <code className="text-[9px] bg-surface px-1 rounded">source_module: plaquette</code>. Tu peux aussi les retrouver via
        <code className="text-[9px] bg-surface px-1 rounded ml-1">/ged?type=rapport</code>.
      </p>
    </div>
  )
}

// ─── Onglet Journal ───

function JournalTab({
  journal, year, items, journalView, onJournalViewChange,
}: {
  journal: PlaquetteJournalEntry[]
  year: number
  items: PlaquetteItem[]
  journalView: 'timeline' | 'by-item'
  onJournalViewChange: (v: 'timeline' | 'by-item') => void
}) {
  const [showResponseModal, setShowResponseModal] = useState(false)

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="text-xs text-text-muted">
            <strong>{journal.length}</strong> entrée(s) journal
          </div>
          {/* Session 39 P1 — segmented control Timeline / Par item */}
          <div className="inline-flex rounded-md border border-border bg-surface/40 p-0.5">
            <button
              type="button"
              onClick={() => onJournalViewChange('timeline')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
                journalView === 'timeline'
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:text-text',
              )}
            >
              <Clock size={11} />
              Timeline
            </button>
            <button
              type="button"
              onClick={() => onJournalViewChange('by-item')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
                journalView === 'by-item'
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:text-text',
              )}
            >
              <BookOpen size={11} />
              Par item
            </button>
          </div>
        </div>
        <button
          onClick={() => setShowResponseModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20"
          title="Loguer une réponse reçue du comptable + basculer des items en lot"
        >
          <Mail size={12} />
          + Loguer réponse comptable
        </button>
      </div>

      {journalView === 'by-item' ? (
        <JournalByItemView year={year} />
      ) : journal.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface/20 p-6 text-center">
          <BookOpen size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-sm text-text-muted">
            Aucune entrée. Le journal s'alimente automatiquement quand tu envoies un mail challenge,
            et manuellement via le bouton "+ Loguer réponse comptable" ci-dessus à la réception d'une réponse.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {journal.slice().reverse().map((e) => {
            const icon = e.type === 'email_out' ? <Mail size={14} className="text-primary" />
              : e.type === 'email_in' ? <Mail size={14} className="text-emerald-400" />
              : <MessageSquare size={14} className="text-text-muted" />
            return (
              <div key={e.entry_id} className={cn(
                'rounded-lg border p-3',
                e.type === 'email_in' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-surface/20'
              )}>
                <div className="flex items-center gap-2 mb-1">
                  {icon}
                  <span className="text-xs font-medium">{e.subject || '(sans objet)'}</span>
                  <span className="text-[10px] text-text-muted ml-auto flex items-center gap-1">
                    <Clock size={9} />
                    {new Date(e.timestamp).toLocaleString('fr-FR')}
                  </span>
                </div>
                {e.body_excerpt && (
                  <p className="text-[11px] text-text-muted whitespace-pre-wrap line-clamp-4">{e.body_excerpt}</p>
                )}
                {e.author && (
                  <p className="text-[9px] text-text-muted mt-1 italic">par {e.author}</p>
                )}
                {/* Session 39 P1 — attachements */}
                <JournalAttachmentList
                  year={year}
                  entryId={e.entry_id}
                  attachments={e.attachments || []}
                />
              </div>
            )
          })}
        </div>
      )}

      {showResponseModal && (
        <LogComptableResponseModal
          year={year}
          items={items}
          onClose={() => setShowResponseModal(false)}
        />
      )}
    </div>
  )
}

// ─── Modal — Loguer une réponse comptable ───

function LogComptableResponseModal({
  year, items, onClose,
}: {
  year: number
  items: PlaquetteItem[]
  onClose: () => void
}) {
  const [subject, setSubject] = useState(`Réponse plaquette ${year}`)
  const [body, setBody] = useState('')
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10))
  // Map item_id → { selected, new_statut, appended_comment }
  // Lazy init depuis `items` (prop stable au mount — le modal est conditionné par `{showResponseModal && ...}`
  // côté parent, donc remonté à chaque ouverture). Évite l'anti-pattern set-state-in-effect.
  const [itemUpdates, setItemUpdates] = useState<Record<string, { selected: boolean; new_statut: PlaquetteItemStatut; appended_comment: string }>>(() => {
    const initial: Record<string, { selected: boolean; new_statut: PlaquetteItemStatut; appended_comment: string }> = {}
    for (const i of items) {
      if (i.statut === 'a_challenger' || i.statut === 'en_discussion') {
        initial[i.item_id] = {
          selected: false,
          new_statut: 'resolu',
          appended_comment: '',
        }
      }
    }
    return initial
  })

  const logMutation = useLogComptableResponse(year)

  const handleToggle = (item_id: string) => {
    setItemUpdates(s => ({ ...s, [item_id]: { ...s[item_id], selected: !s[item_id]?.selected } }))
  }
  const handleStatusChange = (item_id: string, new_statut: PlaquetteItemStatut) => {
    setItemUpdates(s => ({ ...s, [item_id]: { ...s[item_id], new_statut } }))
  }
  const handleCommentChange = (item_id: string, appended_comment: string) => {
    setItemUpdates(s => ({ ...s, [item_id]: { ...s[item_id], appended_comment } }))
  }

  const selectedUpdates: ItemStatusUpdate[] = useMemo(() => {
    return Object.entries(itemUpdates)
      .filter(([, v]) => v.selected)
      .map(([item_id, v]) => ({
        item_id,
        new_statut: v.new_statut,
        appended_comment: v.appended_comment || null,
      }))
  }, [itemUpdates])

  const handleSubmit = async () => {
    if (!body.trim()) {
      toast.error('Le corps de la réponse est requis')
      return
    }
    try {
      const result = await logMutation.mutateAsync({
        subject,
        body_excerpt: body,
        received_at: receivedAt + 'T12:00:00',
        items_updates: selectedUpdates,
      })
      toast.success(`Réponse loguée${result.updated_items_count > 0 ? ` + ${result.updated_items_count} item(s) mis à jour` : ''}`)
      onClose()
    } catch (e) {
      toast.error(`Erreur : ${(e as Error).message}`)
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); e.stopPropagation() } }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])

  const concernedItems = items.filter(i => itemUpdates[i.item_id] !== undefined)

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] max-w-[95vw] max-h-[90vh] bg-background border border-border rounded-lg shadow-2xl z-[70] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-emerald-400" />
            <h3 className="text-sm font-semibold">Loguer une réponse comptable</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-[10px] uppercase text-text-muted mb-1">Date de réception</label>
            <input
              type="date"
              value={receivedAt}
              onChange={e => setReceivedAt(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="px-2 py-1.5 rounded border border-border bg-background text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-text-muted mb-1">Objet du mail/note</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-border bg-background text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-text-muted mb-1">Contenu de la réponse</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              className="w-full px-2 py-1.5 rounded border border-border bg-background text-[11px] font-mono"
              placeholder="Colle ici la réponse reçue du comptable (mail, note téléphonique, etc.)"
            />
          </div>

          {concernedItems.length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-[11px] text-text-muted mb-2">
                Cocher les items à mettre à jour suite à cette réponse ({selectedUpdates.length} sélectionné(s) sur {concernedItems.length}) :
              </p>
              <div className="space-y-2">
                {concernedItems.map(item => {
                  const upd = itemUpdates[item.item_id]
                  if (!upd) return null
                  return (
                    <div key={item.item_id} className={cn(
                      'rounded border p-2',
                      upd.selected ? 'border-primary bg-primary/5' : 'border-border bg-surface/20'
                    )}>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={upd.selected}
                          onChange={() => handleToggle(item.item_id)}
                          className="mt-0.5 accent-primary"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="font-mono text-text-muted">{item.compte_pcg}</span>
                            <span className="font-medium truncate">{item.compte_label}</span>
                          </div>
                          <div className="text-[10px] text-text-muted">
                            Statut actuel : <span className="font-medium">{STATUT_LABELS[item.statut]}</span>
                            {item.ecart !== null && (
                              <span className="ml-2">Écart : {item.ecart >= 0 ? '+' : ''}{formatCurrency(item.ecart)}</span>
                            )}
                          </div>
                        </div>
                      </label>
                      {upd.selected && (
                        <div className="mt-2 ml-6 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] uppercase text-text-muted">Nouveau statut :</span>
                            <select
                              value={upd.new_statut}
                              onChange={e => handleStatusChange(item.item_id, e.target.value as PlaquetteItemStatut)}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-background"
                            >
                              {Object.entries(STATUT_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                          </div>
                          <textarea
                            value={upd.appended_comment}
                            onChange={e => handleCommentChange(item.item_id, e.target.value)}
                            rows={2}
                            placeholder="Ajout au commentaire (optionnel — sera préfixé '[date réponse comptable]')"
                            className="w-full px-1.5 py-1 rounded border border-border bg-background text-[10px]"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-surface-hover">
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={logMutation.isPending || !body.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {logMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Enregistrer la réponse{selectedUpdates.length > 0 && ` (+${selectedUpdates.length} item${selectedUpdates.length > 1 ? 's' : ''})`}
          </button>
        </div>
      </div>
    </>
  )
}
