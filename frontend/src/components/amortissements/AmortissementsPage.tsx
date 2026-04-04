import { useState } from 'react'
import { Landmark, Settings2, Plus, AlertTriangle } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import ImmobilisationDrawer from './ImmobilisationDrawer'
import ConfigAmortissementsDrawer from './ConfigAmortissementsDrawer'
import CessionDrawer from './CessionDrawer'
import {
  useImmobilisations, useAmortissementKpis, useDotationsExercice,
  useCandidates, useIgnoreCandidate,
} from '@/hooks/useAmortissements'
import type { Immobilisation, AmortissementCandidate } from '@/types'

type TabKey = 'registre' | 'tableau' | 'synthese' | 'candidates'

export default function AmortissementsPage() {
  const [tab, setTab] = useState<TabKey>('registre')
  const [selectedYear] = useState(new Date().getFullYear())
  const [selectedImmo, setSelectedImmo] = useState<Immobilisation | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<AmortissementCandidate | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [cessionImmo, setCessionImmo] = useState<Immobilisation | null>(null)

  const { data: immos, isLoading } = useImmobilisations()
  const { data: kpis } = useAmortissementKpis(selectedYear)
  const { data: dotations } = useDotationsExercice(selectedYear)
  const { data: candidates } = useCandidates()
  const ignoreMutation = useIgnoreCandidate()

  if (isLoading) return <LoadingSpinner text="Chargement..." />

  const tabs: Array<{ key: TabKey; label: string; badge?: number }> = [
    { key: 'registre', label: 'Registre' },
    { key: 'tableau', label: 'Tableau annuel' },
    { key: 'synthese', label: 'Synthèse par poste' },
    { key: 'candidates', label: 'Candidates', badge: candidates?.length },
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
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors flex items-center gap-2',
              tab === t.key ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:text-text'
            )}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="text-[10px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full font-bold">
                {t.badge}
              </span>
            )}
          </button>
        ))}
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

function RegistreTab({ immos, onSelect, onCession }: {
  immos: Immobilisation[]
  onSelect: (i: Immobilisation) => void
  onCession: (i: Immobilisation) => void
}) {
  const STATUS_BADGE: Record<string, string> = {
    en_cours: 'bg-emerald-500/15 text-emerald-400',
    amorti: 'bg-blue-500/15 text-blue-400',
    sorti: 'bg-red-500/15 text-red-400',
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface border-b border-border text-text-muted text-xs">
            <th className="text-left px-3 py-2 font-medium">Date acq.</th>
            <th className="text-left px-3 py-2 font-medium">Libellé</th>
            <th className="text-left px-3 py-2 font-medium">Poste</th>
            <th className="text-left px-3 py-2 font-medium">Méthode</th>
            <th className="text-right px-3 py-2 font-medium">Valeur</th>
            <th className="text-center px-3 py-2 font-medium">Durée</th>
            <th className="text-center px-3 py-2 font-medium">Avancement</th>
            <th className="text-right px-3 py-2 font-medium">VNC</th>
            <th className="text-center px-3 py-2 font-medium">Statut</th>
          </tr>
        </thead>
        <tbody>
          {immos.map(i => (
            <tr
              key={i.id}
              onClick={() => onSelect(i)}
              className={cn(
                'border-b border-border hover:bg-surface-hover cursor-pointer transition-colors',
                i.statut !== 'en_cours' && 'opacity-60'
              )}
            >
              <td className="px-3 py-2 text-xs text-text-muted">{i.date_acquisition}</td>
              <td className="px-3 py-2 text-text truncate max-w-[200px]">{i.libelle}</td>
              <td className="px-3 py-2 text-xs text-text-muted">{i.poste_comptable}</td>
              <td className="px-3 py-2 text-xs">{i.methode === 'lineaire' ? 'Lin.' : 'Dég.'}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(i.valeur_origine)}</td>
              <td className="px-3 py-2 text-center text-xs">{i.duree_amortissement} ans</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(i.avancement_pct ?? 0, 100)}%` }} />
                  </div>
                  <span className="text-[10px] text-text-muted w-8">{Math.round(i.avancement_pct ?? 0)}%</span>
                </div>
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs font-bold">{formatCurrency(i.vnc_actuelle ?? 0)}</td>
              <td className="px-3 py-2 text-center">
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', STATUS_BADGE[i.statut] || '')}>
                  {i.statut}
                </span>
              </td>
            </tr>
          ))}
          {immos.length === 0 && (
            <tr><td colSpan={9} className="px-3 py-8 text-center text-text-muted">Aucune immobilisation</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function TableauTab({ dotations, year }: { dotations: { year: number; total_dotations_brutes: number; total_dotations_deductibles: number; detail: Array<{ immo_id: string; libelle: string; poste_comptable: string; dotation_brute: number; dotation_deductible: number; vnc: number }> }; year: number }) {
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
                <td className="px-3 py-2 text-text">{d.libelle}</td>
                <td className="px-3 py-2 text-xs text-text-muted">{d.poste_comptable}</td>
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
