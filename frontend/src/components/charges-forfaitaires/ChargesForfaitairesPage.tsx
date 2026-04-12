import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createElement } from 'react'
import { Receipt, Check, FileText, Settings, RefreshCw, ExternalLink, Library, X, Sparkles, Maximize2, Minimize2, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/shared/PageHeader'
import MetricCard from '@/components/shared/MetricCard'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import {
  useBaremeBlanchissage,
  useUpdateBaremeBlanchissage,
  useCalculerBlanchissage,
  useGenererOD,
  useForfaitsGeneres,
  useSupprimerForfait,
  useChargesForfaitairesConfig,
  useUpdateChargesForfaitairesConfig,
} from '@/hooks/useChargesForfaitaires'
import { useDashboard } from '@/hooks/useApi'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import { formatCurrency } from '@/lib/utils'
import type { ForfaitResult } from '@/types'

export default function ChargesForfaitairesPage() {
  const navigate = useNavigate()
  const openSendDrawer = useSendDrawerStore(s => s.open)
  const year = useFiscalYearStore(s => s.selectedYear)
  const [activeTab] = useState<'blanchissage'>('blanchissage')
  const [jours, setJours] = useState(230)
  const [honorairesLiasse, setHonorairesLiasse] = useState<string>('')
  const [showBareme, setShowBareme] = useState(false)
  const [pdfExpanded, setPdfExpanded] = useState(false)
  const [calcResult, setCalcResult] = useState<ForfaitResult | null>(null)

  const { data: dashboard } = useDashboard(year)
  const { data: bareme } = useBaremeBlanchissage(year)
  const updateBaremeMutation = useUpdateBaremeBlanchissage()
  const { data: forfaitsGeneres, isLoading: loadingGeneres } = useForfaitsGeneres(year)
  const { data: savedConfig, isSuccess: configReady } = useChargesForfaitairesConfig(year)
  const updateConfigMutation = useUpdateChargesForfaitairesConfig()
  const calculerMutation = useCalculerBlanchissage()
  const genererMutation = useGenererOD()
  const supprimerMutation = useSupprimerForfait()

  // Charger les valeurs sauvegardées quand la config arrive
  const configLoadedRef = useRef(false)
  useEffect(() => {
    if (!savedConfig || configLoadedRef.current) return
    configLoadedRef.current = true
    if (savedConfig.jours_travailles) setJours(savedConfig.jours_travailles)
    if (savedConfig.honoraires_liasse) setHonorairesLiasse(String(savedConfig.honoraires_liasse))
  }, [savedConfig])

  // Reset quand l'année change
  useEffect(() => { configLoadedRef.current = false; setJours(230); setHonorairesLiasse('') }, [year])

  const saveConfig = (updates: Record<string, number | null>) => {
    updateConfigMutation.mutate({ year, data: updates })
  }

  const blanchissageGenere = forfaitsGeneres?.find(f => f.type_forfait === 'blanchissage')

  // Calcul live debounce — use ref to avoid infinite loop from mutation identity change
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mutateRef = useRef(calculerMutation.mutate)
  mutateRef.current = calculerMutation.mutate

  useEffect(() => {
    if (blanchissageGenere || !configReady) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      mutateRef.current(
        { year, jours_travailles: jours, mode: 'domicile', honoraires_liasse: honorairesLiasse ? parseFloat(honorairesLiasse.replace(',', '.')) : undefined },
        { onSuccess: (data: ForfaitResult) => setCalcResult(data) },
      )
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [jours, year, blanchissageGenere, configReady])

  const handleGenerer = () => {
    genererMutation.mutate(
      { type_forfait: 'blanchissage', year, jours_travailles: jours, mode: 'domicile', honoraires_liasse: honorairesLiasse ? parseFloat(honorairesLiasse) : undefined },
      {
        onSuccess: (data) => {
          toast.custom((t) => createElement(
            'div',
            {
              className: `${t.visible ? 'animate-enter' : 'animate-leave'} max-w-[420px] w-full rounded-2xl p-[1px] shadow-2xl bg-gradient-to-br from-violet-500/60 via-indigo-500/40 to-violet-400/60`,
            },
            createElement('div', { className: 'rounded-2xl bg-background/95 backdrop-blur-sm px-5 py-4 flex items-start gap-4' },
              createElement('img', { src: '/logo_mark_dark.svg', alt: '', className: 'w-10 h-10 shrink-0 mt-0.5' }),
              createElement('div', { className: 'flex-1 min-w-0' },
                createElement('div', { className: 'flex items-center gap-2 mb-1' },
                  createElement(Sparkles, { className: 'w-4 h-4 text-violet-400' }),
                  createElement('span', { className: 'text-sm font-semibold text-text' }, 'Écriture générée'),
                ),
                createElement('p', { className: 'text-xs text-text-muted' },
                  `Blanchissage professionnel ${year}`
                ),
                createElement('p', { className: 'text-sm font-medium text-emerald-400 mt-1' },
                  formatCurrency(data.montant)
                ),
              ),
              createElement('button', {
                onClick: () => toast.dismiss(t.id),
                className: 'text-text-muted hover:text-text transition-colors shrink-0',
              }, createElement(X, { className: 'w-4 h-4' })),
            ),
          ), { duration: 5000 })
        },
        onError: (err) => {
          toast.error(err.message)
        },
      },
    )
  }

  const handleRegenerer = () => {
    if (!window.confirm('Supprimer le forfait existant et revenir à la saisie ?')) return
    supprimerMutation.mutate({ type_forfait: 'blanchissage', year })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Charges forfaitaires"
        description={`Exercice ${year}`}
        actions={
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'blanchissage'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text'
          }`}
        >
          Blanchissage
        </button>
        <button
          disabled
          className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-text-muted/40 cursor-not-allowed"
        >
          Véhicule
        </button>
      </div>

      {/* Contenu Blanchissage */}
      {loadingGeneres ? (
        <div className="text-text-muted text-sm">Chargement...</div>
      ) : blanchissageGenere ? (
        /* ── État 2 : Déjà généré ── */
        <div className="bg-surface border border-border rounded-lg p-6 space-y-5">
          {/* Checklist */}
          <div className="flex flex-wrap gap-6">
            {['OD créée', 'PDF généré', 'GED enregistré'].map(label => (
              <div key={label} className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-emerald-500" />
                <span className="text-text">{label}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-6">
            {/* Colonne gauche — Infos + actions */}
            <div className="space-y-4">
              {/* Bloc fichier */}
              <div className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border">
                <FileText className="w-8 h-8 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-text">
                    {blanchissageGenere.pdf_filename || `blanchissage_${year}1231_${blanchissageGenere.montant.toFixed(2).replace('.', ',')}.pdf`}
                  </p>
                  <p className="text-xs text-text-muted">
                    Blanchissage professionnel &middot; 31/12/{year}
                  </p>
                </div>
              </div>

              <div className="text-lg font-semibold text-text">
                Montant déductible : {formatCurrency(blanchissageGenere.montant)}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => navigate(`/ged?search=${encodeURIComponent(blanchissageGenere.pdf_filename || 'blanchissage')}`)}
                  className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
                >
                  <Library className="w-4 h-4" />
                  Ouvrir dans la GED
                </button>
                <button
                  onClick={handleRegenerer}
                  disabled={supprimerMutation.isPending}
                  className="px-4 py-2 text-sm bg-surface border border-border text-text rounded-lg hover:bg-background transition-colors flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${supprimerMutation.isPending ? 'animate-spin' : ''}`} />
                  Regénérer
                </button>
                <button
                  onClick={() => openSendDrawer({
                    preselected: blanchissageGenere.pdf_filename
                      ? [{ type: 'rapport' as const, filename: blanchissageGenere.pdf_filename }]
                      : [],
                    defaultSubject: `Frais de blanchissage professionnel ${year}`,
                  })}
                  className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Envoyer au comptable
                </button>
              </div>
            </div>

            {/* Colonne droite — Aperçu PDF (compact) */}
            {blanchissageGenere.pdf_filename && !pdfExpanded && (
              <div className="w-[280px] shrink-0 relative group">
                <object
                  data={`/api/reports/preview/${encodeURIComponent(blanchissageGenere.pdf_filename)}`}
                  type="application/pdf"
                  className="w-full h-[400px] rounded-lg border border-border bg-background pointer-events-none"
                >
                  <div className="flex items-center justify-center h-full text-text-muted text-sm">
                    Aperçu non disponible
                  </div>
                </object>
                <button
                  onClick={() => setPdfExpanded(true)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-background/80 border border-border text-text-muted hover:text-text opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Agrandir"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Aperçu PDF agrandi */}
          {blanchissageGenere.pdf_filename && pdfExpanded && (
            <div className="relative">
              <button
                onClick={() => setPdfExpanded(false)}
                className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-background/80 border border-border text-text-muted hover:text-text transition-colors"
                title="Réduire"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
              <object
                data={`/api/reports/preview/${encodeURIComponent(blanchissageGenere.pdf_filename)}`}
                type="application/pdf"
                className="w-full h-[700px] rounded-lg border border-border bg-background"
              >
                <div className="flex items-center justify-center h-full text-text-muted text-sm">
                  Aperçu non disponible
                </div>
              </object>
            </div>
          )}
        </div>
      ) : (
        /* ── État 1 : Pas encore généré ── */
        <div className="bg-surface border border-border rounded-lg p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text">
              Frais de blanchissage — Exercice {year}
            </h3>
            <button
              onClick={() => setShowBareme(!showBareme)}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Barème
            </button>
          </div>

          {/* Barème toggle */}
          {showBareme && bareme && (
            <div className="bg-background rounded-lg border border-border p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-text-muted text-xs">
                    <th className="text-left pb-2">Article</th>
                    <th className="text-right pb-2">Tarif pressing (€)</th>
                    <th className="text-right pb-2">Qté/jour</th>
                  </tr>
                </thead>
                <tbody>
                  {bareme.articles.map((a, idx) => (
                    <tr key={a.type} className="border-t border-border/50">
                      <td className="py-1.5 text-text">{a.type}</td>
                      <td className="py-1.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            step={0.01}
                            min={0}
                            defaultValue={a.tarif_pressing.toFixed(2)}
                            onBlur={e => {
                              const val = parseFloat(e.target.value)
                              if (isNaN(val) || val === a.tarif_pressing) return
                              const updated = { ...bareme, articles: bareme.articles.map((art, i) =>
                                i === idx ? { ...art, tarif_pressing: val } : art
                              )}
                              updateBaremeMutation.mutate({ year, data: updated })
                            }}
                            className="w-20 px-2 py-1 text-sm text-right rounded border border-border bg-surface text-text focus:outline-none focus:ring-1 focus:ring-primary/50"
                          />
                          <span className="text-xs text-text-muted">€</span>
                        </div>
                      </td>
                      <td className="py-1.5 text-right">
                        <input
                          type="number"
                          step={1}
                          min={1}
                          defaultValue={a.quantite_jour}
                          onBlur={e => {
                            const val = parseInt(e.target.value)
                            if (isNaN(val) || val === a.quantite_jour) return
                            const updated = { ...bareme, articles: bareme.articles.map((art, i) =>
                              i === idx ? { ...art, quantite_jour: val } : art
                            )}
                            updateBaremeMutation.mutate({ year, data: updated })
                          }}
                          className="w-16 px-2 py-1 text-sm text-right rounded border border-border bg-surface text-text focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-text-muted mt-2">
                Décote domicile : {bareme.decote_domicile * 100}% — Réf. {bareme.reference_legale}
              </p>
            </div>
          )}

          {/* Inputs */}
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label className="text-xs text-text-muted block mb-1">Jours travaillés</label>
              <input
                type="number"
                min={0.5}
                max={365}
                step={0.5}
                value={jours}
                onChange={e => setJours(Math.max(0.5, Math.min(365, parseFloat(e.target.value) || 0.5)))}
                onBlur={() => saveConfig({ jours_travailles: jours })}
                className="w-24 px-3 py-2 text-sm rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1">
                Honoraires liasse fiscale SCP
                <span className="text-text-muted/50 ml-1">(optionnel)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="En attente liasse..."
                  value={honorairesLiasse}
                  onChange={e => setHonorairesLiasse(e.target.value.replace(/[^0-9.,]/g, ''))}
                  onBlur={() => {
                    const val = honorairesLiasse ? parseFloat(honorairesLiasse.replace(',', '.')) : null
                    saveConfig({ honoraires_liasse: val })
                  }}
                  className="w-48 px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-text-muted/40"
                />
                {honorairesLiasse && (
                  <button
                    type="button"
                    onClick={() => { setHonorairesLiasse(''); saveConfig({ honoraires_liasse: null }) }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-3 gap-4">
            <MetricCard
              title={honorairesLiasse ? 'Honoraires (liasse fiscale)' : 'Honoraires bruts'}
              value={honorairesLiasse
                ? formatCurrency(parseFloat(honorairesLiasse.replace(',', '.')) || 0)
                : dashboard ? formatCurrency(dashboard.total_credit) : '—'
              }
            />
            <MetricCard
              title="Coût/jour (après décote)"
              value={calcResult ? formatCurrency(calcResult.cout_jour) : '—'}
            />
            <MetricCard
              title="Total déductible"
              value={calcResult ? formatCurrency(calcResult.montant_deductible) : '—'}
            />
          </div>

          {/* Détail articles */}
          {calcResult && (
            <div className="bg-background rounded-lg border border-border p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-text-muted text-xs">
                    <th className="text-left pb-2">Article</th>
                    <th className="text-right pb-2">Tarif réf.</th>
                    <th className="text-right pb-2">Montant</th>
                    <th className="text-right pb-2">Qté/j</th>
                    <th className="text-right pb-2">Jours</th>
                    <th className="text-right pb-2">Sous-total</th>
                  </tr>
                </thead>
                <tbody>
                  {calcResult.detail.map(d => (
                    <tr key={d.type} className="border-t border-border/50">
                      <td className="py-1.5 text-text">{d.type}</td>
                      <td className="py-1.5 text-right text-text">{formatCurrency(d.tarif_pressing)}</td>
                      <td className="py-1.5 text-right text-text">{formatCurrency(d.montant_unitaire)}</td>
                      <td className="py-1.5 text-right text-text">{d.quantite_jour}</td>
                      <td className="py-1.5 text-right text-text">{d.jours}</td>
                      <td className="py-1.5 text-right font-medium text-text">{formatCurrency(d.sous_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="pt-2 text-text" colSpan={5}>Total annuel déductible</td>
                    <td className="pt-2 text-right text-text">{formatCurrency(calcResult.montant_deductible)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Bouton générer */}
          <div className="flex justify-end">
            <button
              onClick={handleGenerer}
              disabled={genererMutation.isPending || !calcResult}
              className="px-6 py-2.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {genererMutation.isPending ? 'Génération en cours...' : "Générer l'écriture"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
