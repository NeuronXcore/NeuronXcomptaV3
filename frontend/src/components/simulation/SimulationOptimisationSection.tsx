import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, TrendingDown, Info, ChevronDown, ChevronUp, Car } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import MetricCard from '@/components/shared/MetricCard'
import { useBaremes } from '@/hooks/useSimulation'
import { useDashboard } from '@/hooks/useApi'
import { useDotationsExercice, useProjections } from '@/hooks/useAmortissements'
import {
  simulateAll, calculateTauxMarginalReel,
  getMadelinPlafonds, getPERPlafond,
} from '@/lib/fiscal-engine'
import { useForfaitsGeneres, useVehiculeGenere } from '@/hooks/useChargesForfaitaires'
import { formatCurrency } from '@/lib/utils'
import type { SimulationLeviers } from '@/types'

const CARMF_CLASSES = ['M', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']

const DEPENSES_PRO_CATEGORIES = [
  { key: 'vehicule', label: 'Véhicule (loyer, essence, péage, parking, entretien, assurance)', max: 15000, step: 200 },
  { key: 'fournitures', label: 'Fournitures', max: 10000, step: 100 },
  { key: 'abonnements', label: 'Abonnements', max: 5000, step: 50 },
  { key: 'telephone_internet', label: 'Téléphone / Internet', max: 5000, step: 50 },
  { key: 'logiciel', label: 'Logiciel', max: 5000, step: 50 },
  { key: 'comptable', label: 'Comptable', max: 5000, step: 100 },
  { key: 'frais_bancaires', label: 'Frais bancaires', max: 2000, step: 50 },
  { key: 'repas', label: 'Repas', max: 5000, step: 50 },
  { key: 'poste', label: 'Poste / Courrier', max: 1000, step: 50 },
  { key: 'autres', label: 'Autres', max: 10000, step: 100 },
]

interface Props {
  year: number
}

export default function SimulationOptimisationSection({ year }: Props) {
  const [leviers, setLeviers] = useState<SimulationLeviers>({
    madelin: 0, per: 0, carmf_classe: 'M',
    investissement: 0, investissement_duree: 5,
    investissement_prorata_mois: 6,
    formation_dpc: 0, remplacement: 0, depense_pro: 0,
    depenses_detail: {},
  })
  const [parts, setParts] = useState(1.75)
  const [depensesOpen, setDepensesOpen] = useState(false)
  const [forfaitExclus, setForfaitExclus] = useState<Record<string, boolean>>({})

  const { data: baremes } = useBaremes(year)
  const { data: forfaitsGeneres } = useForfaitsGeneres(year)
  const { data: vehiculeGenere } = useVehiculeGenere(year)
  const { data: dotations } = useDotationsExercice(year)
  const { data: dashboard } = useDashboard(year)
  const { data: projections } = useProjections(5)

  const bncActuel = useMemo(() => {
    if (!dashboard) return 0
    return (dashboard.total_credit ?? 0) - (dashboard.total_debit ?? 0)
  }, [dashboard])

  const dotationsExistantes = dotations?.total_dotations_deductibles ?? 0

  const result = useMemo(() => {
    if (!baremes || bncActuel <= 0) return null
    return simulateAll(bncActuel, leviers, baremes, parts, dotationsExistantes)
  }, [bncActuel, leviers, baremes, parts, dotationsExistantes])

  const tauxMarginal = useMemo(() => {
    if (!baremes || !result) return null
    return calculateTauxMarginalReel(result.bnc_social, baremes, parts)
  }, [baremes, result, parts])

  const madelinPlafonds = useMemo(() => {
    if (!baremes || !result) return null
    return getMadelinPlafonds(result.bnc_social, baremes.ir, baremes.urssaf?.pass ?? 46368)
  }, [baremes, result])

  const perPlafond = useMemo(() => {
    if (!baremes || !result) return null
    return getPERPlafond(result.bnc_social, baremes.ir)
  }, [baremes, result])

  const updateLevier = (key: keyof SimulationLeviers, value: number | string) => {
    setLeviers((prev) => ({ ...prev, [key]: value }))
  }

  if (!baremes) return null

  const chargeLines = result ? [
    { label: 'URSSAF', color: '#3b82f6', actuel: result.urssaf_actuel, simule: result.urssaf_simule, delta: result.urssaf_delta },
    { label: 'CARMF', color: '#8b5cf6', actuel: result.carmf_actuel, simule: result.carmf_simule, delta: result.carmf_delta },
    { label: 'ODM', color: '#f59e0b', actuel: result.odm, simule: result.odm, delta: 0 },
    { label: 'Impôt sur le revenu', color: '#ef4444', actuel: result.ir_actuel, simule: result.ir_simule, delta: result.ir_delta },
  ] : []

  const carmfClasses = baremes.carmf?.complementaire?.classes ?? {}

  // Projection chart data
  const projectionData = (projections ?? []).map((p: any) => ({
    year: p.year,
    dotations_existantes: p.total_dotations_deductibles ?? 0,
  }))

  return (
    <div className="space-y-6">
      {/* Hero KPI */}
      {result && (
        <div className="grid grid-cols-3 gap-4">
          <MetricCard
            title="BNC actuel"
            value={formatCurrency(result.bnc_actuel)}
          />
          <MetricCard
            title="BNC simulé (social)"
            value={formatCurrency(result.bnc_social)}
            trend={result.bnc_social < result.bnc_actuel ? 'down' : undefined}
          />
          <MetricCard
            title="Revenu net réel"
            value={formatCurrency(result.revenu_net_simule)}
            trend={result.revenu_net_delta > 0 ? 'up' : result.revenu_net_delta < 0 ? 'down' : undefined}
          />
        </div>
      )}

      {/* 2 colonnes */}
      <div className="grid grid-cols-2 gap-6">
        {/* Colonne gauche — Leviers */}
        <div className="bg-surface rounded-xl border border-border p-6 space-y-5">
          <h3 className="font-semibold text-lg">Leviers de déduction</h3>

          {/* Parts fiscales */}
          <div>
            <label className="text-sm text-text-muted">Parts fiscales</label>
            <select
              value={parts}
              onChange={(e) => setParts(Number(e.target.value))}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            >
              {[1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4].map((p) => (
                <option key={p} value={p}>{p} part{p > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>

          {/* Dotations existantes */}
          <div className="bg-background rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-muted">Dotations existantes (registre)</span>
              <span className="font-bold text-green-500 font-mono">{formatCurrency(dotationsExistantes)}</span>
            </div>
            {dotations?.detail && dotations.detail.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {dotations.detail.map((d: any, i: number) => (
                  <span key={i} className="text-xs bg-surface border border-border rounded-full px-2 py-0.5">
                    {d.libelle} ({formatCurrency(d.dotation_deductible)})
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-text-muted mt-2">Calculé depuis le registre des immobilisations</p>
          </div>

          {/* Nouvel investissement */}
          <SliderField
            label="Nouvel investissement matériel"
            value={leviers.investissement}
            onChange={(v) => updateLevier('investissement', v)}
            min={0} max={50000} step={500}
          />
          {leviers.investissement > 0 && result && (
            <div className="bg-background rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-text-muted">Traitement</span>
                <span className={result.investissement_traitement === 'immobilisation' ? 'text-amber-500' : 'text-green-500'}>
                  {result.investissement_traitement === 'immobilisation' ? 'Immobilisation' : 'Charge immédiate'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Déduction BNC an 1</span>
                <span className="font-mono">{formatCurrency(result.dotation_nouvel_invest)}</span>
              </div>
              {result.investissement_traitement === 'immobilisation' && (
                <div className="flex items-start gap-2 mt-2 p-2 bg-amber-500/10 rounded text-amber-600 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Vous investissez {formatCurrency(leviers.investissement)} mais seuls {formatCurrency(result.dotation_nouvel_invest)} sont déductibles cette année
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="border-t border-border my-4" />

          {/* Madelin */}
          <SliderField
            label="Madelin"
            value={leviers.madelin}
            onChange={(v) => updateLevier('madelin', v)}
            min={0} max={madelinPlafonds?.total ?? 20000} step={100}
            note={madelinPlafonds ? `Plafond Madelin disponible : ${formatCurrency(madelinPlafonds.total)}` : undefined}
          />

          {/* PER */}
          <SliderField
            label="PER"
            value={leviers.per}
            onChange={(v) => updateLevier('per', v)}
            min={0} max={perPlafond ?? 35000} step={100}
            warning="Réduit l'IR uniquement — pas les cotisations sociales (URSSAF/CARMF inchangés)"
          />

          {/* Classe CARMF */}
          <div>
            <label className="text-sm text-text-muted">Classe CARMF complémentaire</label>
            <select
              value={leviers.carmf_classe}
              onChange={(e) => updateLevier('carmf_classe', e.target.value)}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            >
              {CARMF_CLASSES.map((c) => (
                <option key={c} value={c}>
                  Classe {c} — {formatCurrency(carmfClasses[c] ?? 0)}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-muted mt-1">Monter de classe augmente les droits retraite</p>
          </div>

          {/* Remplacement */}
          <SliderField
            label="Remplacement"
            value={leviers.remplacement}
            onChange={(v) => updateLevier('remplacement', v)}
            min={0} max={100000} step={1000}
            note="Honoraires rétrocédés à un remplaçant"
          />

          {/* Formation DPC */}
          <SliderField
            label="Formation DPC"
            value={leviers.formation_dpc}
            onChange={(v) => updateLevier('formation_dpc', v)}
            min={0} max={5000} step={100}
          />

          <div className="border-t border-border my-4" />

          {/* Autres dépenses professionnelles — Expander */}
          <div>
            <button
              onClick={() => setDepensesOpen(!depensesOpen)}
              className="w-full flex items-center justify-between py-2 text-sm font-medium hover:text-primary transition-colors"
            >
              <span>Autres dépenses professionnelles</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-text-muted">
                  {formatCurrency(
                    Object.values(leviers.depenses_detail ?? {}).reduce((s, v) => s + v, 0)
                  )}
                </span>
                {depensesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>
            {depensesOpen && (
              <div className="space-y-3 mt-2 pl-2 border-l-2 border-border">
                {DEPENSES_PRO_CATEGORIES.map((cat) => (
                  <SliderField
                    key={cat.key}
                    label={cat.label}
                    value={leviers.depenses_detail?.[cat.key] ?? 0}
                    onChange={(v) => {
                      setLeviers((prev) => ({
                        ...prev,
                        depenses_detail: { ...prev.depenses_detail, [cat.key]: v },
                      }))
                    }}
                    min={0}
                    max={cat.max}
                    step={cat.step}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Charges forfaitaires */}
          <div>
            <div className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2 mt-4">Charges forfaitaires</div>
            {forfaitsGeneres?.map(f => (
              <div key={f.type_forfait} className="flex items-center gap-3 py-1.5">
                <input
                  type="checkbox"
                  checked={!forfaitExclus[f.type_forfait]}
                  onChange={() => setForfaitExclus(prev => ({
                    ...prev,
                    [f.type_forfait]: !prev[f.type_forfait],
                  }))}
                  className="rounded border-border"
                />
                <span className="text-sm text-text">
                  {f.type_forfait === 'blanchissage' ? 'Blanchissage professionnel' : f.type_forfait}
                </span>
                <span className="ml-auto text-sm font-medium text-text font-mono">
                  -{formatCurrency(f.montant)}
                </span>
              </div>
            ))}
            {!forfaitsGeneres?.find(f => f.type_forfait === 'blanchissage') && (
              <div className="flex items-center gap-3 py-1.5 opacity-40">
                <input type="checkbox" disabled className="rounded border-border" />
                <span className="text-sm text-text">Blanchissage professionnel</span>
                <Link to="/charges-forfaitaires" className="ml-auto text-xs text-primary hover:underline">
                  Configurer →
                </Link>
              </div>
            )}
            {vehiculeGenere && (
              <div className="flex items-center gap-3 py-1.5 opacity-70">
                <Car className="w-4 h-4 text-secondary" />
                <span className="text-sm text-text">Quote-part véhicule</span>
                <span className="ml-auto text-sm font-medium text-text">{vehiculeGenere.ratio_pro}%</span>
              </div>
            )}
            {!vehiculeGenere && (
              <div className="flex items-center gap-3 py-1.5 opacity-40">
                <Car className="w-4 h-4" />
                <span className="text-sm text-text">Quote-part véhicule</span>
                <Link to="/charges-forfaitaires" className="ml-auto text-xs text-primary hover:underline">
                  Configurer →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Colonne droite — Impact charges */}
        <div className="bg-surface rounded-xl border border-border p-6 space-y-4">
          <h3 className="font-semibold text-lg">Impact sur les charges</h3>

          {/* Lignes de charges */}
          {chargeLines.map((line) => (
            <div key={line.label} className="flex justify-between items-center py-2 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: line.color }} />
                <span className="text-sm">{line.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="line-through text-text-muted text-sm font-mono">{formatCurrency(line.actuel)}</span>
                <span className="font-mono font-medium">{formatCurrency(line.simule)}</span>
                {line.delta !== 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded ${line.delta < 0 ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                    {line.delta > 0 ? '+' : ''}{formatCurrency(line.delta)}
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Total */}
          {result && (
            <div className="flex justify-between items-center py-3 border-t-2 border-border">
              <span className="font-semibold">Total charges</span>
              <div className="flex items-center gap-3">
                <span className="line-through text-text-muted font-mono">{formatCurrency(result.total_actuel)}</span>
                <span className="font-mono font-bold text-lg">{formatCurrency(result.total_simule)}</span>
                {result.total_delta !== 0 && (
                  <span className={`text-sm px-3 py-1 rounded-full font-medium ${result.total_delta < 0 ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                    {result.total_delta > 0 ? '+' : ''}{formatCurrency(result.total_delta)}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="border-t border-border my-2" />

          {/* Taux marginal réel */}
          {tauxMarginal && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-text-muted">Taux marginal réel</h4>
              <div className="text-3xl font-bold">
                {(tauxMarginal.total * 100).toFixed(1)}%
              </div>
              {/* Barre segmentée */}
              <div className="flex h-3 rounded-full overflow-hidden">
                {tauxMarginal.ir > 0 && (
                  <div className="bg-red-500" style={{ width: `${(tauxMarginal.ir / tauxMarginal.total) * 100}%` }} title={`IR: ${(tauxMarginal.ir * 100).toFixed(1)}%`} />
                )}
                {tauxMarginal.urssaf > 0 && (
                  <div className="bg-blue-500" style={{ width: `${(tauxMarginal.urssaf / tauxMarginal.total) * 100}%` }} title={`URSSAF: ${(tauxMarginal.urssaf * 100).toFixed(1)}%`} />
                )}
                {tauxMarginal.carmf > 0 && (
                  <div className="bg-purple-500" style={{ width: `${(tauxMarginal.carmf / tauxMarginal.total) * 100}%` }} title={`CARMF: ${(tauxMarginal.carmf * 100).toFixed(1)}%`} />
                )}
              </div>
              <div className="flex gap-4 text-xs text-text-muted">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />IR {(tauxMarginal.ir * 100).toFixed(1)}%</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />URSSAF {(tauxMarginal.urssaf * 100).toFixed(1)}%</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" />CARMF {(tauxMarginal.carmf * 100).toFixed(1)}%</span>
              </div>
            </div>
          )}

          {/* Comparatif charge immédiate vs immobilisation */}
          {leviers.investissement > 0 && result && (
            <>
              <div className="border-t border-border my-2" />
              <h4 className="text-sm font-medium text-text-muted">Coût réel de l'investissement</h4>
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="bg-background rounded-lg p-3">
                  <div className="text-text-muted text-xs mb-1">Montant investi</div>
                  <div className="font-mono font-medium">{formatCurrency(result.invest_montant)}</div>
                </div>
                <div className="bg-background rounded-lg p-3">
                  <div className="text-text-muted text-xs mb-1">Déduction an 1</div>
                  <div className="font-mono font-medium text-green-500">{formatCurrency(result.invest_deduction_an1)}</div>
                </div>
                <div className="bg-background rounded-lg p-3">
                  <div className="text-text-muted text-xs mb-1">Coût réel net</div>
                  <div className="font-mono font-bold text-primary">{formatCurrency(result.invest_cout_reel_an1)}</div>
                </div>
              </div>
              <p className="text-xs text-text-muted flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Le coût réel tient compte de l'économie de charges générée par la déduction
              </p>
            </>
          )}
        </div>
      </div>

      {/* Projection amortissements */}
      {projectionData.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-6">
          <h3 className="font-semibold mb-4">Projection des dotations sur 5 ans</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={projectionData}>
              <XAxis dataKey="year" />
              <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Legend />
              <Bar dataKey="dotations_existantes" name="Dotations existantes" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-sm text-amber-700">
          <strong>Simulation indicative.</strong> Les cotisations URSSAF/CARMF sont en réalité calculées sur le BNC N-2 avec régularisation.
          Ce simulateur utilise le BNC courant estimé. Les barèmes sont approximatifs et modifiables via les paramètres.
          Consultez votre expert-comptable pour des calculs définitifs.
        </div>
      </div>
    </div>
  )
}

// ─── Composant Slider réutilisable ───

function SliderField({
  label, value, onChange, min, max, step, note, warning,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  note?: string
  warning?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm text-text-muted">{label}</label>
        <span className="text-sm font-mono font-medium">{formatCurrency(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      {note && <p className="text-xs text-text-muted mt-1">{note}</p>}
      {warning && (
        <div className="flex items-start gap-1.5 mt-1 text-xs text-amber-600">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{warning}</span>
        </div>
      )}
    </div>
  )
}
