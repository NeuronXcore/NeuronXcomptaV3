import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Handshake, ShieldCheck, Scale, Sparkles, X, Loader2,
  RefreshCw, Lock, Send, RotateCcw, Zap, ZapOff, LayoutGrid, Table2,
  FileDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { usePlaquetteCheckDrawerStore } from '@/stores/plaquetteCheckDrawerStore'
import {
  usePlaquetteCheck,
  useNegociationSynthesis,
  useComputeNegociation,
  usePatchItemConcession,
  useResetItemConcession,
  useRegenerateArgumentation,
  useGenerateReconciliationPdf,
  isPlaquetteEditable,
} from '@/hooks/usePlaquetteCheck'
import { api } from '@/api/client'
import type {
  ConcessionTone,
  PlaquetteItem,
  NegociationSynthesis,
} from '@/types'
import { formatCurrency, cn } from '@/lib/utils'

const TONE_CONFIG: Record<
  ConcessionTone,
  { label: string; Icon: typeof ShieldCheck; classes: string }
> = {
  ferme: {
    label: 'Ferme',
    Icon: ShieldCheck,
    classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
  },
  equilibre: {
    label: 'Équilibré',
    Icon: Scale,
    classes: 'bg-sky-500/15 text-sky-400 border-sky-500/40',
  },
  conciliant: {
    label: 'Conciliant',
    Icon: Handshake,
    classes: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  },
}

interface Props {
  onInjectIntoEmail: () => void
  injectingBundle: boolean
}

export function PlaquetteNegociationDrawer({ onInjectIntoEmail, injectingBundle }: Props) {
  const isOpen = usePlaquetteCheckDrawerStore((s) => s.negociationDrawerOpen)
  const close = usePlaquetteCheckDrawerStore((s) => s.closeNegociationDrawer)
  const year = usePlaquetteCheckDrawerStore((s) => s.year)

  const { data: check } = usePlaquetteCheck(year)
  const { data: synth, isLoading: synthLoading } = useNegociationSynthesis(year)
  const computeMutation = useComputeNegociation(year)
  const reconciliationMutation = useGenerateReconciliationPdf(year)

  // ─── Mode pilotage live (Session 40 P1.1) ───
  // En mode live : la synthèse (BNC simulé, concession totale, surcoût IR, compteurs)
  // se met à jour instantanément côté client pendant le drag du slider, sans attendre
  // le roundtrip backend. L'argumentation reste régénérée en debounce + PATCH (cher).
  const [liveMode, setLiveMode] = useState<boolean>(true)
  // Map<item_id, pct> = overrides locaux en cours de drag (cleared quand backend rattrape)
  const [livePcts, setLivePcts] = useState<Map<string, number>>(new Map())

  // ─── Vue Cards vs Tableau ───
  // Cards = argumentation rédigée + slider intégré (détaillée, calibrage)
  // Tableau = vue compacte par poste comptable avec slider + contre-proposition (vue d'ensemble)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards')

  // ─── Resize (Session 40 P1.2) — handle drag bord gauche + persistance localStorage ───
  const SUB_MIN_WIDTH = 550
  const SUB_MAX_WIDTH = 1100
  const SUB_DEFAULT_WIDTH = 720
  const SUB_WIDTH_KEY = 'plaquette-nego-drawer-width'
  const [subDrawerWidth, setSubDrawerWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return SUB_DEFAULT_WIDTH
    const saved = window.localStorage.getItem(SUB_WIDTH_KEY)
    const parsed = saved ? parseInt(saved, 10) : NaN
    return !isNaN(parsed) && parsed >= SUB_MIN_WIDTH && parsed <= SUB_MAX_WIDTH
      ? parsed
      : SUB_DEFAULT_WIDTH
  })
  const isResizingSub = useRef(false)
  const handleSubResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingSub.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const startX = e.clientX
    const startWidth = subDrawerWidth
    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizingSub.current) return
      const delta = startX - ev.clientX
      const newWidth = Math.min(SUB_MAX_WIDTH, Math.max(SUB_MIN_WIDTH, startWidth + delta))
      setSubDrawerWidth(newWidth)
    }
    const handleMouseUp = () => {
      isResizingSub.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [subDrawerWidth])

  // Persist à chaque changement (cheap localStorage write d'un nombre)
  useEffect(() => {
    try {
      window.localStorage.setItem(SUB_WIDTH_KEY, String(Math.round(subDrawerWidth)))
    } catch {
      /* ignore */
    }
  }, [subDrawerWidth])

  // Clear livePcts quand drawer ferme
  useEffect(() => {
    if (!isOpen) {
      setLivePcts(new Map())
    }
  }, [isOpen])

  // Clear livePcts quand mode live désactivé
  useEffect(() => {
    if (!liveMode) {
      setLivePcts(new Map())
    }
  }, [liveMode])

  // Quand la synth backend rattrape un live pct (PATCH propagé), on retire l'entrée du Map
  // pour qu'on bascule sur les valeurs backend sans pollution stale.
  useEffect(() => {
    if (!check || livePcts.size === 0) return
    const items = check.items || []
    let modified = false
    const next = new Map(livePcts)
    livePcts.forEach((livePct, itemId) => {
      const item = items.find((it) => it.item_id === itemId)
      const backendPct = item?.concession?.pct_maintenu
      if (backendPct !== undefined && Math.abs(backendPct - livePct) < 0.5) {
        next.delete(itemId)
        modified = true
      }
    })
    if (modified) setLivePcts(next)
  }, [check, livePcts])

  const handleLivePctChange = useCallback((itemId: string, pct: number) => {
    setLivePcts((prev) => {
      const next = new Map(prev)
      next.set(itemId, pct)
      return next
    })
  }, [])

  // Tri figé : on hash la liste mais ne re-trie PAS quand seul concession.last_updated_at change.
  // Les cards rerenderont avec les nouveaux items (référence change à chaque refetch) mais
  // l'ordre reste figé tant qu'on n'ajoute/supprime pas d'item.
  const orderSignature = useMemo(() => {
    if (!check) return ''
    const list = (check.items || []).filter((it) => it.statut === 'a_challenger')
    return list.map((it) => it.item_id).join('|')
  }, [check])

  // Ordre figé = sortIds calculé une seule fois quand orderSignature change
  const sortIds = useMemo<string[]>(() => {
    if (!check) return []
    const list = (check.items || []).filter((it) => it.statut === 'a_challenger')
    return list
      .slice()
      .sort((a, b) => (b.concession?.force_score ?? 0) - (a.concession?.force_score ?? 0))
      .map((it) => it.item_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderSignature])

  // Re-construction de la liste ordonnée à chaque rerender via sortIds (items frais)
  const sortedItems = useMemo<PlaquetteItem[]>(() => {
    if (!check) return []
    const byId = new Map((check.items || []).map((it) => [it.item_id, it]))
    return sortIds.map((id) => byId.get(id)).filter((it): it is PlaquetteItem => it !== undefined)
  }, [check, sortIds])

  const isEditable = isPlaquetteEditable(check)
  const isDeclared = check?.status === 'declare'

  // ─── Synthèse live (calculée client-side quand liveMode actif) ───
  // Recalcule BNC simulé, concession totale, surcoût IR via TMI effectif estimé sur synth backend.
  const liveSynthesis = useMemo<NegociationSynthesis | undefined>(() => {
    if (!liveMode || !check || !synth || livePcts.size === 0) return undefined

    const items = (check.items || []).filter((it) => it.statut === 'a_challenger' && it.concession)
    let concessionTotale = 0
    let nbMaintenus = 0
    let nbEnDiscussion = 0
    let nbConcedes = 0

    items.forEach((it) => {
      const c = it.concession!
      const mp = it.montant_plaquette ?? 0
      const mn = it.montant_neuronx ?? 0
      const ecart = mn - mp
      const livePct = livePcts.get(it.item_id)
      const pct = livePct !== undefined ? livePct : c.pct_maintenu
      const montantConcede = ecart * (1 - pct / 100)
      concessionTotale += Math.abs(montantConcede)
      if (pct >= 99.5) nbMaintenus += 1
      else if (pct <= 0.5) nbConcedes += 1
      else nbEnDiscussion += 1
    })

    // BNC simulé : on garde la convention backend (concession sur charges → BNC monte).
    // Approximation : on suppose que toutes les concessions sont sur des charges (cas standard
    // — l'utilisateur ne challenge pas généralement des items recettes).
    const deltaBnc = concessionTotale - synth.concession_totale
    const bncSimule = synth.bnc_simule + deltaBnc

    // Surcout IR estimé via TMI effectif extrait du synth backend
    let irSimule: number | null = null
    let economieIr: number | null = null
    if (
      synth.ir_projete_actuel !== null
      && synth.economie_ir !== null
      && synth.concession_totale > 0
    ) {
      // TMI eff = |economie_ir| / concession_totale du backend
      const tmiEff = Math.abs(synth.economie_ir) / synth.concession_totale
      // Live : delta IR proportionnel à la concession live
      irSimule = synth.ir_projete_actuel + concessionTotale * tmiEff
      economieIr = synth.ir_projete_actuel - irSimule
    }

    return {
      year: synth.year,
      nb_items_total: items.length,
      nb_items_maintenus: nbMaintenus,
      nb_items_en_discussion: nbEnDiscussion,
      nb_items_concedes: nbConcedes,
      concession_totale: Math.round(concessionTotale * 100) / 100,
      bnc_neuronx_initial: synth.bnc_neuronx_initial,
      bnc_simule: Math.round(bncSimule * 100) / 100,
      ir_projete_actuel: synth.ir_projete_actuel,
      ir_projete_simule: irSimule !== null ? Math.round(irSimule * 100) / 100 : null,
      economie_ir: economieIr !== null ? Math.round(economieIr * 100) / 100 : null,
    }
  }, [liveMode, check, synth, livePcts])

  const displayedSynth = liveSynthesis ?? synth
  const isLivePreview = !!liveSynthesis

  // Esc handler en mode capture pour ne fermer QUE ce drawer
  useEffect(() => {
    if (!isOpen) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [isOpen, close])

  if (!isOpen || !check || year === null) return null

  const handleExportReconciliation = async () => {
    try {
      const result = await reconciliationMutation.mutateAsync()
      const sizeKb = Math.round(result.size_bytes / 1024)
      const replacedNote = result.replaced_count > 0
        ? ` (remplace ${result.replaced_count} ancienne(s) version(s))`
        : ''
      toast.success(
        `Réconciliation PDF générée (${sizeKb} Ko)${replacedNote} — enregistrée en GED`,
        {
          duration: 6000,
        },
      )
      // Bonus : ouvrir le PDF avec Aperçu via open-native (macOS)
      if (result.ged_doc_id) {
        try {
          await api.post(`/ged/documents/${encodeURIComponent(result.ged_doc_id)}/open-native`)
        } catch {
          // Fallback navigateur
          window.open(`/api/ged/documents/${encodeURIComponent(result.ged_doc_id)}/preview`, '_blank', 'noopener,noreferrer')
        }
      }
    } catch (e) {
      toast.error(`Erreur génération réconciliation : ${(e as Error).message}`)
    }
  }

  const handleRegenerateAll = () => {
    const hasOverrides = sortedItems.some((it) => it.concession?.source === 'manual')
    if (hasOverrides) {
      if (!window.confirm(
        'Certains items ont des overrides manuels. Recalculer écrasera ces choix. Continuer ?'
      )) {
        return
      }
      computeMutation.mutate({ force_recompute: true }, {
        onSuccess: () => toast.success('Concessions recalculées'),
        onError: () => toast.error('Erreur recalcul'),
      })
    } else {
      computeMutation.mutate({ force_recompute: false }, {
        onSuccess: () => toast.success('Concessions à jour'),
        onError: () => toast.error('Erreur recalcul'),
      })
    }
  }

  return (
    <>
      {/* Backdrop dédié — au-dessus du drawer parent z-50 */}
      <div className="fixed inset-0 bg-black/60 z-[60]" onClick={close} />
      <div
        className="fixed top-0 right-0 h-full max-w-[95vw] bg-background border-l border-border z-[70] flex flex-col shadow-2xl"
        style={{
          width: `${subDrawerWidth}px`,
          transition: isResizingSub.current ? 'none' : 'width 200ms ease-out',
        }}
      >
        {/* Resize handle bord gauche */}
        <div
          onMouseDown={handleSubResizeMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 group hover:bg-primary/30 active:bg-primary/50 transition-colors"
          title="Glisser pour redimensionner"
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-12 rounded-full bg-border group-hover:bg-primary transition-colors" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-surface/30">
          <div className="flex items-center gap-2">
            <div className="rounded-full p-1.5 bg-primary/20">
              <Handshake size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text">Position de repli — {year}</h2>
              <p className="text-[10px] text-text-muted">
                {sortedItems.length} item(s) à challenger · tri par force d'argumentation
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Toggle vue Cards / Tableau */}
            <div className="flex items-center bg-surface-hover rounded border border-border overflow-hidden">
              <button
                onClick={() => setViewMode('cards')}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-[10px] transition',
                  viewMode === 'cards' ? 'bg-primary text-white' : 'text-text-muted hover:text-text',
                )}
                title="Vue cards (argumentation détaillée)"
              >
                <LayoutGrid size={11} />
                Cards
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-[10px] transition',
                  viewMode === 'table' ? 'bg-primary text-white' : 'text-text-muted hover:text-text',
                )}
                title="Vue tableau (compacte avec contre-proposition par poste)"
              >
                <Table2 size={11} />
                Tableau
              </button>
            </div>
            {/* Toggle Mode pilotage live */}
            {isEditable && (
              <button
                onClick={() => setLiveMode((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] border transition',
                  liveMode
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                    : 'bg-surface-hover hover:bg-surface border-border text-text-muted',
                )}
                title={
                  liveMode
                    ? 'Mode pilotage live actif — synthèse mise à jour en temps réel pendant le drag'
                    : 'Mode standard — synthèse mise à jour après PATCH backend'
                }
              >
                {liveMode ? <Zap size={11} /> : <ZapOff size={11} />}
                {liveMode ? 'Live' : 'Standard'}
              </button>
            )}
            {isEditable && (
              <button
                onClick={handleRegenerateAll}
                disabled={computeMutation.isPending || sortedItems.length === 0}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] bg-surface-hover hover:bg-surface border border-border disabled:opacity-50"
                title="Recalcule toutes les positions auto (préserve les overrides manuels sauf confirmation)"
              >
                {computeMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                Régénérer tout
              </button>
            )}
            <button
              onClick={close}
              className="p-1.5 hover:bg-surface-hover rounded text-text-muted hover:text-text"
              aria-label="Fermer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Bannière declare */}
        {isDeclared && (
          <div className="mx-5 mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5">
            <div className="flex items-start gap-2">
              <Lock size={12} className="mt-0.5 flex-none text-emerald-400" />
              <p className="text-[11px] text-emerald-400">
                <strong>Exercice déclaré.</strong> Position de repli figée en lecture seule.
              </p>
            </div>
          </div>
        )}

        {/* Bandeau synthèse */}
        <SynthesisBanner synth={displayedSynth} loading={synthLoading} isLivePreview={isLivePreview} />

        {/* Liste items */}
        <div className={cn(
          'flex-1 overflow-y-auto',
          viewMode === 'cards' ? 'px-5 py-3 space-y-3' : 'px-3 py-3',
        )}>
          {sortedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Handshake size={32} className="text-text-muted/40 mb-3" />
              <p className="text-sm text-text-muted">
                Aucun item à challenger.
              </p>
              <p className="text-[11px] text-text-muted mt-1">
                Marque d'abord des écarts en <strong>« À challenger »</strong> dans l'onglet Comparatif.
              </p>
            </div>
          ) : viewMode === 'cards' ? (
            sortedItems.map((item) => (
              <NegoItemCard
                key={item.item_id}
                item={item}
                year={year}
                readOnly={!isEditable}
                liveMode={liveMode}
                onLivePctChange={handleLivePctChange}
              />
            ))
          ) : (
            <NegoItemTable
              items={sortedItems}
              year={year}
              readOnly={!isEditable}
              liveMode={liveMode}
              livePcts={livePcts}
              onLivePctChange={handleLivePctChange}
              bncInitial={displayedSynth?.bnc_neuronx_initial}
            />
          )}
        </div>

        {/* Footer sticky */}
        <div className="border-t border-border bg-surface/30 p-3 flex justify-between items-center gap-3">
          <button
            onClick={handleExportReconciliation}
            disabled={reconciliationMutation.isPending || sortedItems.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Génère un PDF de réconciliation (positions par poste + ajustements demandés vs comptable)"
          >
            {reconciliationMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
            Exporter PDF réconciliation
          </button>
          <div className="flex gap-2">
            <button
              onClick={close}
              className="px-3 py-1.5 rounded border border-border text-xs hover:bg-surface-hover"
            >
              Fermer
            </button>
            <button
              onClick={onInjectIntoEmail}
              disabled={injectingBundle || sortedItems.length === 0 || isDeclared}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                isDeclared
                  ? 'Exercice déclaré — envoi désactivé'
                  : sortedItems.length === 0
                  ? 'Aucun item à injecter'
                  : 'Génère rapport + email enrichi + ouvre drawer envoi'
              }
            >
              {injectingBundle ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Injecter dans le mail ({sortedItems.length} items)
            </button>
          </div>
        </div>
      </div>
    </>
  )
}


// ─── Sous-composants ───

function SynthesisBanner({
  synth,
  loading,
  isLivePreview,
}: {
  synth: NegociationSynthesis | undefined
  loading: boolean
  isLivePreview: boolean
}) {
  if (loading || !synth) {
    return (
      <div className="border-b border-border bg-surface/30 px-5 py-3 flex items-center justify-center text-[11px] text-text-muted">
        {loading ? <Loader2 size={12} className="animate-spin mr-2" /> : null}
        Synthèse en cours de calcul…
      </div>
    )
  }

  const concessionRatio = synth.bnc_neuronx_initial > 0
    ? Math.min(1, synth.concession_totale / Math.abs(synth.bnc_neuronx_initial))
    : 0

  return (
    <div className={cn(
      'border-b border-border px-5 py-3 space-y-2 transition-colors',
      isLivePreview ? 'bg-emerald-500/5' : 'bg-surface/30',
    )}>
      {isLivePreview && (
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-emerald-400">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Aperçu live · synchronisation backend en cours
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <KpiCell
          label="BNC initial NeuronX"
          value={formatCurrency(synth.bnc_neuronx_initial)}
          tone="neutral"
        />
        <KpiCell
          label="Concession totale"
          value={`−${formatCurrency(synth.concession_totale)}`}
          tone="danger"
        />
        <KpiCell
          label="BNC après concession"
          value={formatCurrency(synth.bnc_simule)}
          tone="primary"
        />
      </div>

      {/* Progress bar concession/BNC */}
      <div className="space-y-1">
        <div className="flex justify-between text-[9px] text-text-muted">
          <span>Concession vs BNC initial</span>
          <span>{(concessionRatio * 100).toFixed(1)} %</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-warning to-danger"
            style={{ width: `${concessionRatio * 100}%` }}
          />
        </div>
      </div>

      {/* IR projeté — convention signe : economie_ir > 0 = vraie économie (vert),
          economie_ir < 0 = surcoût IR (rouge) car la concession augmente le BNC.
          NB : economie_ir = ir_actuel − ir_simule, donc négatif si ir_simule > ir_actuel. */}
      {synth.economie_ir !== null && synth.economie_ir !== 0 && (
        <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-border/40">
          <span className="text-text-muted">
            IR projeté actuel : <strong className="text-text">{formatCurrency(synth.ir_projete_actuel ?? 0)}</strong>
          </span>
          <span className="text-text-muted">
            IR simulé : <strong className="text-text">{formatCurrency(synth.ir_projete_simule ?? 0)}</strong>
          </span>
          <span
            className={cn(
              'px-2 py-0.5 rounded-full font-semibold',
              (synth.economie_ir ?? 0) > 0
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-danger/15 text-danger',
            )}
            title={(synth.economie_ir ?? 0) > 0 ? 'Économie d\'IR' : 'Surcoût IR (BNC augmente avec la concession)'}
          >
            {(synth.economie_ir ?? 0) > 0 ? 'Économie ' : 'Surcoût '}
            {formatCurrency(Math.abs(synth.economie_ir ?? 0))}
          </span>
        </div>
      )}

      {/* Compteurs par bucket */}
      <div className="flex items-center justify-between text-[10px] text-text-muted pt-1">
        <span>
          <strong className="text-emerald-400">{synth.nb_items_maintenus}</strong> maintenus
          <span className="mx-1">·</span>
          <strong className="text-sky-400">{synth.nb_items_en_discussion}</strong> en discussion
          <span className="mx-1">·</span>
          <strong className="text-amber-400">{synth.nb_items_concedes}</strong> concédés
        </span>
      </div>
    </div>
  )
}

function KpiCell({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'neutral' | 'danger' | 'primary'
}) {
  const colors = {
    neutral: 'text-text',
    danger: 'text-danger',
    primary: 'text-primary',
  }[tone]
  return (
    <div className="rounded border border-border/50 bg-surface/50 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', colors)}>{value}</div>
    </div>
  )
}

function NegoItemCard({
  item,
  year,
  readOnly,
  liveMode,
  onLivePctChange,
}: {
  item: PlaquetteItem
  year: number
  readOnly: boolean
  liveMode: boolean
  onLivePctChange: (itemId: string, pct: number) => void
}) {
  const concession = item.concession
  const patchMutation = usePatchItemConcession(year)
  const resetMutation = useResetItemConcession(year)
  const regenMutation = useRegenerateArgumentation(year)

  // Local state pour slider (debounced pour PATCH backend)
  const [localPct, setLocalPct] = useState<number>(concession?.pct_maintenu ?? 100)
  const [localArgumentation, setLocalArgumentation] = useState<string>(
    concession?.argumentation ?? ''
  )
  const [argumentationDirty, setArgumentationDirty] = useState(false)

  // Helper qui combine setLocalPct + notification parent en mode live (instantané)
  const updateLocalPct = useCallback((newPct: number) => {
    setLocalPct(newPct)
    if (liveMode) {
      onLivePctChange(item.item_id, newPct)
    }
  }, [liveMode, onLivePctChange, item.item_id])

  // Sync local state when concession prop changes (e.g. after PATCH refresh)
  useEffect(() => {
    if (concession) {
      setLocalPct(concession.pct_maintenu)
      if (!argumentationDirty) {
        setLocalArgumentation(concession.argumentation)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concession?.pct_maintenu, concession?.argumentation, concession?.last_updated_at])

  // Debounce slider (400ms) → PATCH backend
  useEffect(() => {
    if (readOnly || !concession) return
    if (Math.abs(localPct - concession.pct_maintenu) < 0.01) return
    const t = setTimeout(() => {
      patchMutation.mutate({
        item_id: item.item_id,
        payload: { pct_maintenu: localPct },
      })
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPct, readOnly])

  if (!concession) {
    return (
      <div className="rounded-lg border border-border/50 bg-surface/30 p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-text">{item.compte_label}</div>
          <span className="text-[10px] text-text-muted italic">Concession en cours de calcul…</span>
        </div>
      </div>
    )
  }

  const toneCfg = TONE_CONFIG[concession.tone]
  const isManual = concession.source === 'manual'
  const ecartSigned = (item.ecart ?? 0)
  const ecartLabel = ecartSigned >= 0 ? `+${formatCurrency(ecartSigned)}` : `−${formatCurrency(Math.abs(ecartSigned))}`

  // Calcul live des montants côté client (cohérent avec backend _compute_montants)
  const mp = item.montant_plaquette ?? 0
  const liveMaintenu = mp + ecartSigned * localPct / 100
  const liveConcede = ecartSigned * (1 - localPct / 100)

  const handleToneChange = (newTone: ConcessionTone) => {
    if (readOnly || newTone === concession.tone) return
    patchMutation.mutate({
      item_id: item.item_id,
      payload: { tone: newTone },
    })
  }

  const handleQuickSet = (pct: number) => {
    if (readOnly) return
    updateLocalPct(pct)
  }

  const handleArgumentationBlur = () => {
    if (!argumentationDirty || readOnly) return
    patchMutation.mutate({
      item_id: item.item_id,
      payload: { argumentation: localArgumentation },
    }, {
      onSuccess: () => setArgumentationDirty(false),
    })
  }

  const handleRegenerate = () => {
    if (readOnly) return
    regenMutation.mutate(item.item_id, {
      onSuccess: () => {
        setArgumentationDirty(false)
        toast.success('Argumentation régénérée')
      },
    })
  }

  const handleReset = () => {
    if (readOnly) return
    resetMutation.mutate(item.item_id, {
      onSuccess: () => {
        setArgumentationDirty(false)
        toast.success('Repris en mode auto')
      },
    })
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-surface/30 p-3 space-y-3',
        isManual ? 'border-amber-500/40' : 'border-border/50',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-xs font-semibold text-text truncate">{item.compte_label}</div>
            {item.risque_fiscal && (
              <RisqueChip niveau={item.risque_fiscal.niveau} />
            )}
          </div>
          <div className="text-[10px] text-text-muted">
            Compte {item.compte_pcg || '—'} · écart{' '}
            <strong className={ecartSigned > 0 ? 'text-warning' : 'text-emerald-400'}>{ecartLabel}</strong>
            {item.categories_neuronx.length > 0 && (
              <> · <span>{item.categories_neuronx.slice(0, 2).join(', ')}</span></>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          {isManual && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/40">
              MANUEL
            </span>
          )}
          {!isManual && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-primary/15 text-primary border border-primary/40">
              AUTO
            </span>
          )}
        </div>
      </div>

      {/* Slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-text-muted">Position de repli</span>
          <span className="font-mono tabular-nums font-semibold text-text">{Math.round(localPct)} %</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={localPct}
          onChange={(e) => !readOnly && updateLocalPct(Number(e.target.value))}
          disabled={readOnly}
          className="w-full accent-primary disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          title={readOnly ? 'Exercice déclaré' : 'Glisse le curseur pour ajuster la position'}
        />
        <div className="flex items-center gap-1">
          {[0, 25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              onClick={() => handleQuickSet(pct)}
              disabled={readOnly}
              className={cn(
                'px-1.5 py-0.5 rounded text-[9px] tabular-nums border transition',
                Math.round(localPct) === pct
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface hover:bg-surface-hover border-border text-text-muted',
                readOnly && 'opacity-50 cursor-not-allowed',
              )}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      {/* Montants live */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-emerald-400/80">Maintenu</div>
          <div className="text-sm font-semibold tabular-nums text-emerald-400">
            {formatCurrency(Math.abs(liveMaintenu))}
          </div>
        </div>
        <div className="rounded bg-surface-hover border border-border px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-text-muted">Concédé</div>
          <div className="text-sm font-semibold tabular-nums text-text-muted">
            {formatCurrency(Math.abs(liveConcede))}
          </div>
        </div>
      </div>

      {/* Ton */}
      <div className="space-y-1">
        <div className="text-[10px] text-text-muted">Ton de l'argumentation</div>
        <div className="flex gap-1">
          {(Object.keys(TONE_CONFIG) as ConcessionTone[]).map((toneKey) => {
            const cfg = TONE_CONFIG[toneKey]
            const Icon = cfg.Icon
            const active = concession.tone === toneKey
            return (
              <button
                key={toneKey}
                onClick={() => handleToneChange(toneKey)}
                disabled={readOnly}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] border transition',
                  active
                    ? cfg.classes + ' ring-1 ring-current'
                    : 'bg-surface hover:bg-surface-hover border-border text-text-muted',
                  readOnly && 'opacity-50 cursor-not-allowed',
                )}
              >
                <Icon size={10} />
                {cfg.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Argumentation */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-text-muted">Argumentation</span>
          <div className="flex items-center gap-1">
            {!readOnly && (
              <button
                onClick={handleRegenerate}
                disabled={regenMutation.isPending}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-surface hover:bg-surface-hover border border-border text-text-muted hover:text-text disabled:opacity-50"
                title="Régénère le texte avec pct/ton actuels"
              >
                {regenMutation.isPending ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
                Régénérer
              </button>
            )}
            {isManual && !readOnly && (
              <button
                onClick={handleReset}
                disabled={resetMutation.isPending}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-surface hover:bg-surface-hover border border-border text-text-muted hover:text-text disabled:opacity-50"
                title="Repasse en mode auto + recalc complet"
              >
                {resetMutation.isPending ? <Loader2 size={9} className="animate-spin" /> : <RotateCcw size={9} />}
                Reset auto
              </button>
            )}
          </div>
        </div>
        <textarea
          value={localArgumentation}
          onChange={(e) => {
            if (readOnly) return
            setLocalArgumentation(e.target.value)
            setArgumentationDirty(true)
          }}
          onBlur={handleArgumentationBlur}
          maxLength={800}
          rows={5}
          disabled={readOnly}
          className="w-full text-[10px] font-mono leading-relaxed px-2 py-1.5 rounded border border-border bg-surface/50 text-text placeholder:text-text-muted/50 disabled:opacity-60 resize-y"
          placeholder="Argumentation auto-générée…"
        />
        <div className="flex items-center justify-between text-[9px] text-text-muted">
          <span>Force {(concession.force_score * 100).toFixed(0)} % · ton {toneCfg.label.toLowerCase()}</span>
          <span className="tabular-nums">{localArgumentation.length}/800</span>
        </div>
      </div>
    </div>
  )
}


// ─── Vue tableau compacte avec slider + contre-proposition par poste ───

function NegoItemTable({
  items,
  year,
  readOnly,
  liveMode,
  livePcts,
  onLivePctChange,
  bncInitial,
}: {
  items: PlaquetteItem[]
  year: number
  readOnly: boolean
  liveMode: boolean
  livePcts: Map<string, number>
  onLivePctChange: (itemId: string, pct: number) => void
  bncInitial: number | undefined
}) {
  // Totaux table footer (en live si liveMode actif)
  // deltaBncSigned = somme des montant_concede signés (charges : concession positive → BNC monte)
  const totals = useMemo(() => {
    let plaq = 0
    let neuronx = 0
    let contre = 0
    let deltaBncSigned = 0
    items.forEach((it) => {
      const c = it.concession
      if (!c) return
      const mp = it.montant_plaquette ?? 0
      const mn = it.montant_neuronx ?? 0
      plaq += mp
      neuronx += mn
      const livePct = liveMode ? livePcts.get(it.item_id) : undefined
      const pct = livePct !== undefined ? livePct : c.pct_maintenu
      const ecart = mn - mp
      const maintenu = mp + ecart * pct / 100
      const concedeSigned = ecart * (1 - pct / 100)
      contre += Math.abs(maintenu)
      // Pour les charges : Δ BNC = montant_concede_signed (BNC = R - charges, charges = contre_prop)
      deltaBncSigned += concedeSigned
    })
    return { plaq, neuronx, contre, deltaBncSigned }
  }, [items, livePcts, liveMode])

  const bncSimule = bncInitial !== undefined ? bncInitial + totals.deltaBncSigned : undefined

  return (
    <div className="rounded border border-border bg-surface/30 overflow-x-auto">
      <table className="w-full text-[10px] min-w-[860px]">
        <thead className="bg-surface-hover">
          <tr className="text-left">
            <th className="px-2 py-1.5 font-semibold text-text-muted">Poste comptable</th>
            <th className="px-2 py-1.5 font-semibold text-text-muted text-right">Plaquette</th>
            <th className="px-2 py-1.5 font-semibold text-text-muted text-right">NeuronX</th>
            <th className="px-2 py-1.5 font-semibold text-text-muted text-right">Écart</th>
            <th className="px-2 py-1.5 font-semibold text-text-muted text-center w-[140px]">Position de repli</th>
            <th className="px-2 py-1.5 font-semibold bg-primary/15 text-primary text-right">
              Contre-proposition
            </th>
            <th
              className="px-2 py-1.5 font-semibold bg-warning/15 text-warning text-right"
              title="Impact sur ton BNC déclaré. + = BNC monte (tu déclares moins de charges) · − = BNC baisse (tu déclares plus de charges)"
            >
              Δ BNC
            </th>
            <th className="px-2 py-1.5 font-semibold text-text-muted text-center w-[28px]"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <NegoTableRow
              key={item.item_id}
              item={item}
              year={year}
              readOnly={readOnly}
              liveMode={liveMode}
              onLivePctChange={onLivePctChange}
            />
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border bg-surface-hover/60">
          <tr>
            <td className="px-2 py-2 font-semibold text-text">TOTAL ({items.length} postes)</td>
            <td className="px-2 py-2 font-semibold text-text-muted text-right tabular-nums">
              {formatCurrency(totals.plaq)}
            </td>
            <td className="px-2 py-2 font-semibold text-text-muted text-right tabular-nums">
              {formatCurrency(totals.neuronx)}
            </td>
            <td className="px-2 py-2 font-semibold text-warning text-right tabular-nums">
              {formatCurrency(totals.neuronx - totals.plaq)}
            </td>
            <td className="px-2 py-2 text-center text-text-muted"></td>
            <td className="px-2 py-2 font-semibold bg-primary/15 text-primary text-right tabular-nums text-sm">
              {formatCurrency(totals.contre)}
            </td>
            <td className={cn(
              'px-2 py-2 font-semibold bg-warning/15 text-right tabular-nums text-sm',
              totals.deltaBncSigned > 0 ? 'text-warning' : totals.deltaBncSigned < 0 ? 'text-emerald-400' : 'text-text-muted',
            )}>
              {totals.deltaBncSigned > 0 ? '+' : ''}{formatCurrency(totals.deltaBncSigned)}
            </td>
            <td></td>
          </tr>
          {bncSimule !== undefined && bncInitial !== undefined && (
            <tr className="border-t border-border/60">
              <td colSpan={4} className="px-2 py-2 text-text-muted italic">
                BNC initial NeuronX : <strong className="not-italic text-text tabular-nums">{formatCurrency(bncInitial)}</strong>
              </td>
              <td colSpan={2} className="px-2 py-2 text-text font-semibold text-right">
                BNC simulé déclaré
              </td>
              <td className="px-2 py-2 text-right">
                <div className="inline-block px-2 py-1 rounded bg-primary/20 text-primary font-bold tabular-nums text-sm">
                  {formatCurrency(bncSimule)}
                </div>
              </td>
              <td></td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  )
}

function NegoTableRow({
  item,
  year,
  readOnly,
  liveMode,
  onLivePctChange,
}: {
  item: PlaquetteItem
  year: number
  readOnly: boolean
  liveMode: boolean
  onLivePctChange: (itemId: string, pct: number) => void
}) {
  const concession = item.concession
  const patchMutation = usePatchItemConcession(year)
  const resetMutation = useResetItemConcession(year)

  // Local state pour slider (debounced PATCH backend)
  const [localPct, setLocalPct] = useState<number>(concession?.pct_maintenu ?? 100)

  // Re-sync depuis backend
  useEffect(() => {
    if (concession) {
      setLocalPct(concession.pct_maintenu)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concession?.pct_maintenu, concession?.last_updated_at])

  // Debounce 400ms → PATCH
  useEffect(() => {
    if (readOnly || !concession) return
    if (Math.abs(localPct - concession.pct_maintenu) < 0.01) return
    const t = setTimeout(() => {
      patchMutation.mutate({
        item_id: item.item_id,
        payload: { pct_maintenu: localPct },
      })
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPct, readOnly])

  const updateLocalPct = useCallback((newPct: number) => {
    setLocalPct(newPct)
    if (liveMode) {
      onLivePctChange(item.item_id, newPct)
    }
  }, [liveMode, onLivePctChange, item.item_id])

  if (!concession) {
    return (
      <tr className="border-b border-border/50">
        <td colSpan={8} className="px-2 py-2 text-text-muted italic text-center">
          Concession en cours de calcul…
        </td>
      </tr>
    )
  }

  const mp = item.montant_plaquette ?? 0
  const mn = item.montant_neuronx ?? 0
  const ecartSigned = mn - mp
  const contreProp = mp + ecartSigned * localPct / 100
  const conced = ecartSigned * (1 - localPct / 100)
  const isManual = concession.source === 'manual'

  const handleReset = () => {
    if (readOnly) return
    resetMutation.mutate(item.item_id, {
      onSuccess: () => toast.success('Repris en mode auto'),
    })
  }

  return (
    <tr className={cn(
      'border-b border-border/30 hover:bg-surface-hover/40 transition-colors',
      isManual && 'bg-amber-500/5',
    )}>
      {/* Poste comptable */}
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] text-text-muted shrink-0">
            {item.compte_pcg || '—'}
          </span>
          <span className="text-text truncate max-w-[180px]" title={item.compte_label}>
            {item.compte_label}
          </span>
          {isManual && (
            <span className="text-[8px] px-1 py-0 rounded bg-amber-500/15 text-amber-400 border border-amber-500/40 shrink-0">
              M
            </span>
          )}
          {item.risque_fiscal && (
            <MicroRisqueChip niveau={item.risque_fiscal.niveau} />
          )}
        </div>
      </td>
      {/* Plaquette */}
      <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
        {formatCurrency(mp)}
      </td>
      {/* NeuronX */}
      <td className="px-2 py-1.5 text-right tabular-nums text-text">
        {formatCurrency(mn)}
      </td>
      {/* Écart */}
      <td className={cn(
        'px-2 py-1.5 text-right tabular-nums font-semibold',
        ecartSigned > 0 ? 'text-warning' : 'text-emerald-400',
      )}>
        {ecartSigned >= 0 ? '+' : ''}{formatCurrency(ecartSigned)}
      </td>
      {/* Slider */}
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={localPct}
            onChange={(e) => !readOnly && updateLocalPct(Number(e.target.value))}
            disabled={readOnly}
            className="flex-1 accent-primary disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed h-1"
            title={readOnly ? 'Exercice déclaré' : `Maintenir ${Math.round(localPct)} % de l'écart`}
          />
          <span className="text-[9px] tabular-nums font-mono text-text-muted w-8 text-right">
            {Math.round(localPct)}%
          </span>
        </div>
      </td>
      {/* Contre-proposition */}
      <td className="px-2 py-1.5 text-right bg-primary/5 border-l border-primary/20">
        <div className="font-semibold text-primary tabular-nums">
          {formatCurrency(contreProp)}
        </div>
      </td>
      {/* Δ BNC (signed, charges convention: concession positive → BNC monte) */}
      <td className={cn(
        'px-2 py-1.5 text-right bg-warning/5 border-l border-warning/20 tabular-nums font-semibold',
        conced > 0.01 ? 'text-warning' : conced < -0.01 ? 'text-emerald-400' : 'text-text-muted',
      )}
        title={
          conced > 0.01
            ? 'BNC monte (tu déclares moins de charges) — plus d\'IR'
            : conced < -0.01
            ? 'BNC baisse (tu déclares plus de charges) — moins d\'IR'
            : 'Pas d\'impact'
        }
      >
        {conced > 0 ? '+' : ''}{formatCurrency(conced)}
      </td>
      {/* Reset button */}
      <td className="px-1 py-1.5 text-center">
        {isManual && !readOnly && (
          <button
            onClick={handleReset}
            disabled={resetMutation.isPending}
            className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-50"
            title="Reset auto"
          >
            {resetMutation.isPending ? <Loader2 size={9} className="animate-spin" /> : <RotateCcw size={9} />}
          </button>
        )}
      </td>
    </tr>
  )
}

function MicroRisqueChip({ niveau }: { niveau: string }) {
  const colors: Record<string, string> = {
    critique: 'bg-red-500/15 text-red-400',
    eleve: 'bg-orange-500/15 text-orange-400',
    modere: 'bg-amber-500/15 text-amber-400',
    faible: 'bg-emerald-500/15 text-emerald-400',
  }
  const cls = colors[niveau] || colors.faible
  return (
    <span
      className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', cls)}
      title={`Risque ${niveau}`}
    />
  )
}


// ─── Mini pastille risque (sans tooltip pour densité) ───

function RisqueChip({ niveau }: { niveau: PlaquetteItem['risque_fiscal'] extends infer R ? R extends { niveau: infer N } ? N : never : never }) {
  const labels: Record<string, { label: string; classes: string }> = {
    critique: { label: 'Crit.', classes: 'bg-red-500/15 text-red-400 border-red-500/30' },
    eleve: { label: 'Élevé', classes: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
    modere: { label: 'Mod.', classes: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    faible: { label: 'Faible', classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  }
  const cfg = labels[niveau as string] || labels.faible
  return (
    <span className={cn('px-1 py-0.5 rounded text-[8px] font-semibold border tabular-nums uppercase tracking-wider', cfg.classes)}>
      {cfg.label}
    </span>
  )
}
