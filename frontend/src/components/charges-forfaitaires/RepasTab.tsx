import { useState, useEffect, useRef, useMemo, createElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, FileText, RefreshCw, Library, X, Sparkles, Send, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import MetricCard from '@/components/shared/MetricCard'
import {
  useBaremeRepas,
  useGenererOD,
  useForfaitsGeneres,
  useSupprimerRepas,
  useChargesForfaitairesConfig,
  useUpdateChargesForfaitairesConfig,
} from '@/hooks/useChargesForfaitaires'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import { formatCurrency } from '@/lib/utils'
import PdfPreviewDrawer from './PdfPreviewDrawer'
import PdfThumbnail from '@/components/shared/PdfThumbnail'

interface RepasTabProps {
  year: number
}

export default function RepasTab({ year }: RepasTabProps) {
  const navigate = useNavigate()
  const openSendDrawer = useSendDrawerStore(s => s.open)
  const [jours, setJours] = useState(230)
  const [pdfDrawerOpen, setPdfDrawerOpen] = useState(false)

  const { data: bareme } = useBaremeRepas(year)
  const { data: forfaitsGeneres, isLoading: loadingGeneres } = useForfaitsGeneres(year)
  const { data: savedConfig, isSuccess: configLoaded } = useChargesForfaitairesConfig(year)
  const updateConfigMutation = useUpdateChargesForfaitairesConfig()
  const genererMutation = useGenererOD()
  const supprimerMutation = useSupprimerRepas()

  // Config seed pattern (cf. BlanchissageTab — configLoadedRef)
  const configLoadedRef = useRef(false)
  useEffect(() => {
    if (!configLoaded || configLoadedRef.current) return
    configLoadedRef.current = true
    if (savedConfig?.jours_travailles) setJours(savedConfig.jours_travailles)
  }, [configLoaded, savedConfig])

  // Reset quand l'année change
  useEffect(() => { configLoadedRef.current = false; setJours(230) }, [year])

  const configReady = configLoaded

  const repasGenere = forfaitsGeneres?.find((f: any) => f.type_forfait === 'repas')

  // Calcul live côté client
  const forfaitJour = useMemo(() => {
    if (!bareme) return 0
    return Math.round((bareme.plafond_repas_restaurant - bareme.seuil_repas_maison) * 100) / 100
  }, [bareme])

  const totalDeductible = useMemo(() => {
    return Math.round(forfaitJour * jours * 100) / 100
  }, [forfaitJour, jours])

  const saveConfig = (updates: Record<string, number | null>) => {
    updateConfigMutation.mutate({ year, data: updates })
  }

  const handleGenerer = () => {
    genererMutation.mutate(
      { type_forfait: 'repas', year, jours_travailles: jours, mode: 'domicile' },
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
                  `Forfait repas ${year}`
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
    supprimerMutation.mutate({ year })
  }

  if (loadingGeneres) {
    return <div className="text-text-muted text-sm">Chargement...</div>
  }

  // ── État 2 : Déjà généré ──
  if (repasGenere) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6 space-y-5">
        <div className="flex flex-wrap gap-6">
          {['OD créée', 'PDF généré', 'GED enregistré'].map(label => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="text-text">{label}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border">
              <FileText className="w-8 h-8 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text">
                  {repasGenere.pdf_filename || `repas_${year}1231.pdf`}
                </p>
                <p className="text-xs text-text-muted">
                  Forfait repas professionnels &middot; 31/12/{year}
                </p>
              </div>
            </div>

            <div className="text-lg font-semibold text-text">
              Montant déductible : {formatCurrency(repasGenere.montant)}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate(`/ged?search=${encodeURIComponent(repasGenere.pdf_filename || 'repas')}`)}
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
                  preselected: repasGenere.pdf_filename
                    ? [{ type: 'rapport' as const, filename: repasGenere.pdf_filename }]
                    : [],
                  defaultSubject: `Forfait repas professionnels ${year}`,
                })}
                className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Envoyer au comptable
              </button>
            </div>
          </div>

          {repasGenere.pdf_filename && repasGenere.ged_doc_id && (
            <PdfThumbnail
              docId={repasGenere.ged_doc_id}
              onClick={() => setPdfDrawerOpen(true)}
              className="w-[200px] h-[280px] shrink-0 rounded-lg hover:ring-2 hover:ring-primary/40 transition-all"
              iconSize={48}
              lazy={false}
            />
          )}
        </div>

        <PdfPreviewDrawer
          open={pdfDrawerOpen}
          onClose={() => setPdfDrawerOpen(false)}
          filename={repasGenere.pdf_filename || ''}
          title="Forfait repas professionnels"
          subtitle={`Exercice ${year} — ${formatCurrency(repasGenere.montant)}`}
        />
      </div>
    )
  }

  // ── État 1 : Saisie ──
  return (
    <div className="space-y-6">
      {/* InfoBox référence légale */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-violet-500/10 border border-violet-500/20">
        <Info className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-violet-300">BOI-BNC-BASE-40-60</p>
          <p className="text-xs text-text-muted mt-1">
            Les frais de repas pris sur le lieu de travail sont déductibles pour la part excédant le seuil
            de repas pris au domicile et n'excédant pas le plafond de dépenses de repas.
          </p>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-lg p-6 space-y-6">
        <h3 className="text-lg font-semibold text-text">
          Forfait repas — Exercice {year}
        </h3>

        {/* Input jours */}
        <div>
          <label className="text-xs text-text-muted block mb-1">Jours travaillés</label>
          <div className="flex items-center gap-2">
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
            <span className="text-xs text-text-muted/60">
              partagé avec Blanchissage
            </span>
          </div>
        </div>

        {/* Metric cards */}
        {bareme && (
          <div className="grid grid-cols-3 gap-4">
            <MetricCard
              title={`Seuil repas maison`}
              value={formatCurrency(bareme.seuil_repas_maison)}
              icon={<span className="text-xs text-text-muted">URSSAF {year}</span>}
            />
            <MetricCard
              title="Plafond restaurant"
              value={formatCurrency(bareme.plafond_repas_restaurant)}
              icon={<span className="text-xs text-text-muted">URSSAF {year}</span>}
            />
            <MetricCard
              title="Forfait / jour"
              value={configReady ? formatCurrency(forfaitJour) : '—'}
              className="ring-1 ring-violet-500/30"
            />
          </div>
        )}

        {/* Tableau barème */}
        {bareme && configReady && (
          <div className="bg-background rounded-lg border border-border p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-muted text-xs">
                  <th className="text-left pb-2">Paramètre</th>
                  <th className="text-right pb-2">Valeur</th>
                  <th className="text-right pb-2">Source</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/50">
                  <td className="py-2 text-text">Seuil repas pris au domicile</td>
                  <td className="py-2 text-right text-text">{formatCurrency(bareme.seuil_repas_maison)}</td>
                  <td className="py-2 text-right text-text-muted text-xs">URSSAF</td>
                </tr>
                <tr className="border-t border-border/50">
                  <td className="py-2 text-text">Plafond repas au restaurant</td>
                  <td className="py-2 text-right text-text">{formatCurrency(bareme.plafond_repas_restaurant)}</td>
                  <td className="py-2 text-right text-text-muted text-xs">URSSAF</td>
                </tr>
                <tr className="border-t border-border/50">
                  <td className="py-2 text-violet-400 font-medium">Forfait déductible / jour</td>
                  <td className="py-2 text-right text-violet-400 font-medium">{formatCurrency(forfaitJour)}</td>
                  <td className="py-2 text-right text-text-muted text-xs">Calculé</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="pt-3 text-violet-400">Total déductible ({jours} j.)</td>
                  <td className="pt-3 text-right text-violet-400 text-lg">{formatCurrency(totalDeductible)}</td>
                  <td className="pt-3 text-right text-text-muted text-xs">= {formatCurrency(forfaitJour)} x {jours}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted px-2 py-1 rounded bg-violet-500/10 text-violet-400">
            {bareme?.reference_legale || 'BOI-BNC-BASE-40-60'}
          </span>
          <button
            onClick={handleGenerer}
            disabled={genererMutation.isPending || !configReady || jours <= 0}
            className="px-6 py-2.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {genererMutation.isPending ? 'Génération en cours...' : "Générer l'écriture"}
          </button>
        </div>
      </div>
    </div>
  )
}
