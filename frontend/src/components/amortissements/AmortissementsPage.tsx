import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Landmark, Settings2, Plus, AlertTriangle, List, Calendar, BarChart3, Sparkles, Calculator,
  Send, Loader2, Package, Pencil, Paperclip,
} from 'lucide-react'
import { cn, formatCurrency, isLibelleBrut } from '@/lib/utils'
import { api } from '@/api/client'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import PreviewSubDrawer from '@/components/ocr/PreviewSubDrawer'
import JustifPreviewLightbox from '@/components/shared/JustifPreviewLightbox'
import ImmobilisationDrawer from './ImmobilisationDrawer'
import ConfigAmortissementsDrawer from './ConfigAmortissementsDrawer'
import CessionDrawer from './CessionDrawer'
import DotationTab from './DotationTab'
import {
  useImmobilisations, useAmortissementKpis, useDotationsExercice,
  useCandidates, useIgnoreCandidate, useDotationGenere, useDotationVirtualDetail,
  usePrepareAmortissementsEnvoi, useUpdateImmobilisation,
} from '@/hooks/useAmortissements'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import type { Immobilisation, AmortissementCandidate, AmortissementKpis, DocumentRef } from '@/types'

type TabKey = 'registre' | 'tableau' | 'synthese' | 'candidates' | 'dotation'
const VALID_TABS: TabKey[] = ['registre', 'tableau', 'synthese', 'candidates', 'dotation']

export default function AmortissementsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedYear = useFiscalYearStore((s) => s.selectedYear)

  // Tab initial depuis URL ?tab=...
  const initialTab = useMemo<TabKey>(() => {
    const param = searchParams.get('tab') as TabKey | null
    return param && VALID_TABS.includes(param) ? param : 'registre'
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [tab, setTab] = useState<TabKey>(initialTab)
  const [selectedImmo, setSelectedImmo] = useState<Immobilisation | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<AmortissementCandidate | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [cessionImmo, setCessionImmo] = useState<Immobilisation | null>(null)

  const { data: immos, isLoading } = useImmobilisations()
  const { data: kpis } = useAmortissementKpis(selectedYear)
  const { data: dotations } = useDotationsExercice(selectedYear)
  const { data: candidates } = useCandidates()
  const { data: dotationGenere } = useDotationGenere(selectedYear)
  const { data: virtualDetail } = useDotationVirtualDetail(selectedYear)
  const ignoreMutation = useIgnoreCandidate()

  // Préparation envoi comptable : auto-génère les rapports manquants puis
  // pré-coche dans le drawer global avec tous leurs justifs liés (sous-dossier
  // dédié dans le ZIP final).
  const prepareEnvoi = usePrepareAmortissementsEnvoi()
  const openSendDrawer = useSendDrawerStore((s) => s.open)

  const handleEnvoiComptable = async () => {
    const toastId = 'amort-envoi'
    try {
      // Toast loading uniquement si génération nécessaire — sinon ouverture instantanée
      toast.loading('Préparation de l\'envoi comptable…', { id: toastId })
      const { rapports, linkedJustifs, generatedCount } =
        await prepareEnvoi.mutateAsync(selectedYear)

      // doc_id est un path complet (ex. "data/reports/foo.pdf") — basename suffit
      const basenameOf = (docId: string): string => docId.split('/').pop() ?? docId
      const preselected: DocumentRef[] = [
        ...rapports
          .map((r) => ({
            type: 'rapport' as const,
            filename: basenameOf(r.doc_id) || (r.original_name ?? ''),
          }))
          .filter((d) => d.filename),
        ...linkedJustifs.map((fn) => ({ type: 'justificatif' as const, filename: fn })),
      ]

      openSendDrawer({
        preselected,
        defaultSubject: `Amortissements — Exercice ${selectedYear}`,
        defaultFilter: 'rapport',
      })

      const justifLabel = linkedJustifs.length > 0
        ? ` + ${linkedJustifs.length} justificatif${linkedJustifs.length > 1 ? 's' : ''}`
        : ''
      toast.success(
        generatedCount > 0
          ? `Drawer pré-rempli — ${generatedCount} rapport${generatedCount > 1 ? 's' : ''} généré${generatedCount > 1 ? 's' : ''}${justifLabel}`
          : `Drawer pré-rempli — ${rapports.length} rapport${rapports.length > 1 ? 's' : ''}${justifLabel}`,
        { id: toastId },
      )
    } catch (err) {
      toast.error(
        `Erreur préparation envoi : ${err instanceof Error ? err.message : 'inconnue'}`,
        { id: toastId },
      )
    }
  }

  // Scroll-to immo via ?immo_id=X (force tab=registre + smooth scroll + flash highlight)
  const scrollHandledRef = useRef<string | null>(null)
  useEffect(() => {
    const immoId = searchParams.get('immo_id')
    if (!immoId || !immos || scrollHandledRef.current === immoId) return
    scrollHandledRef.current = immoId
    setTab('registre')
    setTimeout(() => {
      const el = document.getElementById(`immo-row-${immoId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('flash-highlight')
        setTimeout(() => el.classList.remove('flash-highlight'), 2000)
      }
      // Nettoyer l'URL pour éviter ré-exécution au refresh
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('immo_id')
        return next
      }, { replace: true })
    }, 100)
  }, [searchParams, immos, setSearchParams])

  if (isLoading) return <LoadingSpinner text="Chargement..." />

  const needsDotation = !dotationGenere && (virtualDetail?.nb_immos_actives ?? 0) > 0

  const tabs: Array<{ key: TabKey; label: string; icon: any; badge?: number; badgeColor?: string }> = [
    { key: 'registre', label: 'Registre', icon: List },
    { key: 'tableau', label: 'Tableau annuel', icon: Calendar },
    { key: 'synthese', label: 'Synthèse par poste', icon: BarChart3 },
    { key: 'candidates', label: 'Candidates', icon: Sparkles, badge: candidates?.length },
    { key: 'dotation', label: 'Dotation', icon: Calculator, badge: needsDotation ? 1 : undefined, badgeColor: needsDotation ? 'amber' : undefined },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dotations aux amortissements"
        description="Registre des immobilisations et calcul des dotations"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setShowConfig(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border text-text-muted rounded-lg text-xs hover:bg-surface-hover">
              <Settings2 size={14} /> Config
            </button>
            <button
              onClick={handleEnvoiComptable}
              disabled={prepareEnvoi.isPending}
              className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border text-text-muted rounded-lg text-sm hover:bg-surface-hover disabled:opacity-50"
              title={`Pré-remplir le drawer comptable avec les rapports + justificatifs liés de l'exercice ${selectedYear}`}
            >
              {prepareEnvoi.isPending
                ? <Loader2 size={14} className="animate-spin" />
                : <Send size={14} />}
              Envoyer au comptable
            </button>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90">
              <Plus size={14} /> Nouvelle immobilisation
            </button>
          </div>
        }
      />

      {/* Alert bar for candidates */}
      {kpis && kpis.nb_candidates > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle size={16} className="text-amber-400" />
          <span className="text-sm text-amber-400">
            {kpis.nb_candidates} opération(s) dépassent le seuil et sont candidates à l'immobilisation
          </span>
          <button onClick={() => setTab('candidates')}
            className="ml-auto px-3 py-1 bg-amber-500/20 text-amber-400 rounded-lg text-xs hover:bg-amber-500/30">
            Voir
          </button>
        </div>
      )}

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Immobilisations actives" value={String(kpis.nb_actives)} icon={<Landmark size={20} />} />
          <MetricCard title={`Dotation ${selectedYear}`} value={formatCurrency(kpis.dotation_exercice)} trend="up" icon={<Landmark size={20} />} />
          <MetricCard title="VNC totale" value={formatCurrency(kpis.total_vnc)} icon={<Landmark size={20} />} />
          <MetricCard title="Candidates" value={String(kpis.nb_candidates)}
            trend={kpis.nb_candidates > 0 ? 'down' : undefined} icon={<AlertTriangle size={20} />} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map(t => {
          const Icon = t.icon
          const isActive = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors flex items-center gap-2',
                isActive ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:text-text'
              )}
            >
              <Icon size={14} />
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full font-bold',
                  t.badgeColor === 'amber'
                    ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                    : 'bg-amber-500/15 text-amber-400',
                )}>
                  {t.badgeColor === 'amber' ? '!' : t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'registre' && (
        <RegistreTab immos={immos ?? []} onSelect={setSelectedImmo} onCession={setCessionImmo} />
      )}
      {tab === 'tableau' && dotations && (
        <TableauTab dotations={dotations} year={selectedYear} />
      )}
      {tab === 'synthese' && kpis && (
        <SyntheseTab kpis={kpis} />
      )}
      {tab === 'candidates' && (
        <CandidatesTab
          candidates={candidates ?? []}
          onImmobiliser={setSelectedCandidate}
          onIgnorer={(c) => ignoreMutation.mutate({ filename: c.filename, index: c.index })}
        />
      )}
      {tab === 'dotation' && (
        <DotationTab year={selectedYear} />
      )}

      {/* Drawers */}
      <ImmobilisationDrawer
        isOpen={selectedImmo != null || showCreate || selectedCandidate != null}
        onClose={() => { setSelectedImmo(null); setShowCreate(false); setSelectedCandidate(null) }}
        immobilisation={selectedImmo}
        candidate={selectedCandidate}
      />
      <ConfigAmortissementsDrawer open={showConfig} onClose={() => setShowConfig(false)} />
      <CessionDrawer immobilisation={cessionImmo} isOpen={cessionImmo != null} onClose={() => setCessionImmo(null)} />
    </div>
  )
}

// ─── Sub-components ───

function RegistreTab({ immos, onSelect, onCession: _onCession }: {
  immos: Immobilisation[]
  onSelect: (i: Immobilisation) => void
  onCession: (i: Immobilisation) => void
}) {
  const STATUS_BADGE: Record<string, string> = {
    en_cours: 'bg-emerald-500/15 text-emerald-400',
    amorti: 'bg-blue-500/15 text-blue-400',
    sorti: 'bg-red-500/15 text-red-400',
  }

  // Édition inline `designation`
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const updateMutation = useUpdateImmobilisation()

  const startEdit = (immo: Immobilisation) => {
    setEditingId(immo.id)
    setEditValue(immo.designation || '')
  }
  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }
  const commitEdit = async (immoId: string) => {
    const value = editValue.trim()
    setEditingId(null)
    const current = immos.find((i) => i.id === immoId)?.designation ?? ''
    if (value === current) return
    try {
      await updateMutation.mutateAsync({
        id: immoId,
        data: { designation: value },
      })
    } catch (err) {
      toast.error(`Erreur : ${err instanceof Error ? err.message : 'inconnue'}`)
    }
  }

  // Preview justificatif (sub-drawer standalone + lightbox)
  const [previewJustif, setPreviewJustif] = useState<string | null>(null)
  const [lightboxFilename, setLightboxFilename] = useState<string | null>(null)

  const openSubDrawerStandalone = (filename: string) => {
    setPreviewJustif(filename)
  }
  const handleNoJustif = () => {
    toast('Aucun justificatif associé à cette immobilisation', { icon: '📎' })
  }

  return (
    <>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface border-b border-border text-text-muted text-xs">
              <th className="text-left px-3 py-2 font-medium">Date acq.</th>
              <th className="text-left px-3 py-2 font-medium">Désignation</th>
              <th className="text-left px-3 py-2 font-medium">Poste</th>
              <th className="text-left px-3 py-2 font-medium">Mode</th>
              <th className="text-right px-3 py-2 font-medium">Base</th>
              <th className="text-center px-3 py-2 font-medium">Durée</th>
              <th className="text-center px-3 py-2 font-medium">Avancement</th>
              <th className="text-right px-3 py-2 font-medium">VNC</th>
              <th className="text-center px-3 py-2 font-medium w-[60px]">Justif.</th>
              <th className="text-center px-3 py-2 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {immos.map((i) => {
              const isEditing = editingId === i.id
              const brut = isLibelleBrut(i.designation)
              return (
                <tr
                  key={i.id}
                  id={`immo-row-${i.id}`}
                  onClick={() => {
                    // On ne déclenche le drawer que si pas en train d'éditer la désignation
                    if (!isEditing) onSelect(i)
                  }}
                  className={cn(
                    'group border-b border-border hover:bg-surface-hover cursor-pointer transition-colors',
                    i.statut !== 'en_cours' && 'opacity-60',
                  )}
                >
                  <td className="px-3 py-2 text-xs text-text-muted">{i.date_acquisition}</td>
                  <td className="px-3 py-2 text-text max-w-[280px]" onClick={(e) => isEditing && e.stopPropagation()}>
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Pavé icône Package */}
                      <div className="w-[30px] h-[30px] rounded-md bg-primary/10 text-primary grid place-items-center flex-shrink-0">
                        <Package size={15} />
                      </div>
                      {/* Texte ou input édition */}
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(i.id)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                commitEdit(i.id)
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelEdit()
                              }
                            }}
                            placeholder="ex : Ordinateur portable MacBook Pro M3"
                            className="w-full bg-background border border-primary rounded-md px-2.5 py-1 text-sm outline-none ring-2 ring-primary/20"
                          />
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                startEdit(i)
                              }}
                              className={cn(
                                'truncate',
                                brut && 'italic text-text-muted',
                              )}
                              title={brut ? 'Libellé bancaire brut — double-clic pour renommer' : undefined}
                            >
                              {i.designation || 'Libellé non renseigné'}
                            </span>
                            {i.exercice_entree_neuronx != null && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700 font-medium shrink-0"
                                title={`Reprise depuis ${i.exercice_entree_neuronx} — acquisition réelle ${i.date_acquisition.slice(0, 4)}`}
                              >
                                Reprise {i.exercice_entree_neuronx}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Bouton crayon hover (sauf édition) */}
                      {!isEditing && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            startEdit(i)
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-hover text-text-muted hover:text-primary shrink-0"
                          aria-label="Annoter la désignation"
                          title="Renommer (Enter pour valider, Esc pour annuler)"
                          type="button"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">{i.poste ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{i.mode === 'lineaire' ? 'Lin.' : 'Dég.'}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(i.base_amortissable)}</td>
                  <td className="px-3 py-2 text-center text-xs">{i.duree} ans</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${Math.min(i.avancement_pct ?? 0, 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-text-muted w-8">{Math.round(i.avancement_pct ?? 0)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-bold">
                    {formatCurrency(i.vnc_actuelle ?? 0)}
                  </td>
                  {/* Cellule paperclip */}
                  <td className="px-3 py-2 text-center">
                    {i.has_justif && i.justif_filename ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openSubDrawerStandalone(i.justif_filename!)
                        }}
                        className="w-7 h-7 rounded-md bg-emerald-500/15 text-emerald-500 grid place-items-center hover:bg-emerald-500/25 hover:scale-105 transition-all mx-auto"
                        aria-label="Aperçu du justificatif"
                        title={i.justif_filename}
                        type="button"
                      >
                        <Paperclip size={14} />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleNoJustif()
                        }}
                        className="w-7 h-7 rounded-md text-text-muted/50 grid place-items-center hover:bg-surface-hover relative mx-auto"
                        aria-label="Pas de justificatif"
                        title="Aucun justificatif"
                        type="button"
                      >
                        <Paperclip size={14} />
                        <span className="absolute top-1/2 left-1 right-1 h-[1.5px] bg-text-muted/60 rotate-[-25deg] rounded pointer-events-none" />
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', STATUS_BADGE[i.statut] || '')}>
                      {i.statut}
                    </span>
                  </td>
                </tr>
              )
            })}
            {immos.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-text-muted">
                  Aucune immobilisation
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Sous-drawer preview standalone (déclenché par paperclip) */}
      <PreviewSubDrawer
        filename={previewJustif}
        mainDrawerOpen={false}
        standalone
        width={700}
        onClose={() => setPreviewJustif(null)}
        onOpenLightbox={() => previewJustif && setLightboxFilename(previewJustif)}
        onOpenNative={(name) => {
          // Pattern miroir EditorPage : POST silencieux qui demande à macOS
          // d'ouvrir le PDF dans Aperçu (via le helper backend `open -a Preview`).
          api.post(`/justificatifs/${encodeURIComponent(name)}/open-native`).catch(() => {
            // Fallback navigateur si l'open-native échoue (ex. en-attente, pas
            // sur macOS, etc.) — ouvre dans un nouvel onglet.
            window.open(`/api/justificatifs/${encodeURIComponent(name)}/preview`, '_blank')
          })
        }}
      />

      {/* Lightbox plein écran (chaînée depuis le sub-drawer) */}
      <JustifPreviewLightbox
        filename={lightboxFilename}
        onClose={() => setLightboxFilename(null)}
        onOpenExternal={() => {
          if (!lightboxFilename) return
          api.post(`/justificatifs/${encodeURIComponent(lightboxFilename)}/open-native`).catch(() => {
            window.open(`/api/justificatifs/${encodeURIComponent(lightboxFilename)}/preview`, '_blank')
          })
        }}
      />
    </>
  )
}

function TableauTab({ dotations, year }: { dotations: { year: number; total_dotations_brutes: number; total_dotations_deductibles: number; detail: Array<{ immo_id: string; designation: string; poste: string; dotation_brute: number; dotation_deductible: number; vnc: number }> }; year: number }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Exercice {year}</h3>
        <span className="text-lg font-bold text-emerald-400">{formatCurrency(dotations.total_dotations_deductibles)}</span>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface border-b border-border text-text-muted text-xs">
              <th className="text-left px-3 py-2">Bien</th>
              <th className="text-left px-3 py-2">Poste</th>
              <th className="text-right px-3 py-2">Dot. brute</th>
              <th className="text-right px-3 py-2">Dot. déductible</th>
              <th className="text-right px-3 py-2">VNC</th>
            </tr>
          </thead>
          <tbody>
            {dotations.detail.map(d => (
              <tr key={d.immo_id} className="border-b border-border">
                <td className="px-3 py-2 text-text">{d.designation}</td>
                <td className="px-3 py-2 text-xs text-text-muted">{d.poste}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(d.dotation_brute)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-emerald-400">{formatCurrency(d.dotation_deductible)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(d.vnc)}</td>
              </tr>
            ))}
            {dotations.detail.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-text-muted">Aucune dotation pour cet exercice</td></tr>
            )}
          </tbody>
          {dotations.detail.length > 0 && (
            <tfoot>
              <tr className="bg-surface border-t-2 border-primary font-bold">
                <td colSpan={2} className="px-3 py-2 text-text">TOTAL</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(dotations.total_dotations_brutes)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-emerald-400">{formatCurrency(dotations.total_dotations_deductibles)}</td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function SyntheseTab({ kpis }: { kpis: AmortissementKpis }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {kpis.postes.map(p => (
          <div key={p.poste} className="bg-surface border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text">{p.poste}</span>
              <span className="text-xs text-text-muted">{p.nb} bien{p.nb > 1 ? 's' : ''}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-text-muted">VNC</p>
                <p className="text-text font-medium">{formatCurrency(p.vnc)}</p>
              </div>
              <div>
                <p className="text-text-muted">Dotation</p>
                <p className="text-emerald-400 font-medium">{formatCurrency(p.dotation)}</p>
              </div>
            </div>
          </div>
        ))}
        {kpis.postes.length === 0 && (
          <p className="text-text-muted col-span-2 text-center py-8">Aucune immobilisation active</p>
        )}
      </div>
    </div>
  )
}

function CandidatesTab({ candidates, onImmobiliser, onIgnorer }: {
  candidates: AmortissementCandidate[]
  onImmobiliser: (c: AmortissementCandidate) => void
  onIgnorer: (c: AmortissementCandidate) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">
        Opérations détectées automatiquement : montant &gt; seuil, catégorie éligible, pas encore immobilisées.
      </p>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface border-b border-border text-text-muted text-xs">
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Libellé</th>
              <th className="text-left px-3 py-2">Catégorie</th>
              <th className="text-right px-3 py-2">Montant</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => (
              <tr key={`${c.filename}-${c.index}`} className="border-b border-border">
                <td className="px-3 py-2 text-xs text-text-muted">{c.date}</td>
                <td className="px-3 py-2 text-text truncate max-w-[200px]">{c.libelle}</td>
                <td className="px-3 py-2 text-xs text-text-muted">{c.categorie}</td>
                <td className="px-3 py-2 text-right font-mono font-bold">{formatCurrency(c.debit)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex gap-1.5 justify-end">
                    <button onClick={() => onImmobiliser(c)}
                      className="px-2 py-1 bg-primary/15 text-primary text-[10px] rounded hover:bg-primary/25">
                      Immobiliser
                    </button>
                    <button onClick={() => onIgnorer(c)}
                      className="px-2 py-1 bg-surface-hover text-text-muted text-[10px] rounded hover:text-text">
                      Ignorer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {candidates.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-text-muted">Aucune candidate détectée</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
