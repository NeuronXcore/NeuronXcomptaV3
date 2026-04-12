import { useState, useEffect, useRef, useMemo, createElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car, Check, FileText, RefreshCw, Library, X, Sparkles, Send, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import MetricCard from '@/components/shared/MetricCard'
import {
  useChargesForfaitairesConfig,
  useUpdateChargesForfaitairesConfig,
  useAppliquerVehicule,
  useVehiculeGenere,
  useSupprimerVehicule,
  useRegenerPdfVehicule,
} from '@/hooks/useChargesForfaitaires'
import { useCategoryDetail } from '@/hooks/useApi'
import { useGedPostes } from '@/hooks/useGed'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import PdfPreviewDrawer from './PdfPreviewDrawer'
import PdfThumbnail from '@/components/shared/PdfThumbnail'
import { formatCurrency } from '@/lib/utils'
import type { VehiculeResult } from '@/types'

export default function VehiculeTab({ year }: { year: number }) {
  const navigate = useNavigate()
  const openSendDrawer = useSendDrawerStore(s => s.open)

  const [distance, setDistance] = useState(0)
  const [jours, setJours] = useState(230)
  const [kmSup, setKmSup] = useState(0)
  const [kmTotaux, setKmTotaux] = useState(1)
  const [honorairesLiasse, setHonorairesLiasse] = useState<string>('')
  const [pdfDrawerOpen, setPdfDrawerOpen] = useState(false)

  const { data: savedConfig, isSuccess: configLoaded } = useChargesForfaitairesConfig(year)
  const updateConfigMutation = useUpdateChargesForfaitairesConfig()
  const { data: genere, isLoading: loadingGenere } = useVehiculeGenere(year)
  const appliquerMutation = useAppliquerVehicule()
  const supprimerMutation = useSupprimerVehicule()
  const regenerPdf = useRegenerPdfVehicule()
  const { data: postesConfig } = useGedPostes()

  // Lire le % actuel du poste véhicule depuis ged_postes
  const ancienRatio = useMemo(() => {
    const postes = postesConfig?.postes ?? []
    const vehicule = postes.find((p: { id: string }) => p.id === 'vehicule')
    return vehicule?.deductible_pct ?? null
  }, [postesConfig])

  // Détail dépenses véhicule par sous-catégorie
  const { data: vehiculeDetail } = useCategoryDetail('Véhicule', year)
  const { data: transportDetail } = useCategoryDetail('Transport', year)

  // Fusionner les sous-catégories Véhicule + Transport
  const expenseRows = useMemo(() => {
    const rows: { name: string; brut: number; count: number }[] = []
    for (const detail of [vehiculeDetail, transportDetail]) {
      if (!detail) continue
      for (const sc of detail.subcategories) {
        // Sous-catégorie vide → "Non classé (Catégorie)"
        const label = sc.name || `Non classé (${detail.category})`
        const existing = rows.find(r => r.name === label)
        if (existing) {
          existing.brut += sc.debit
          existing.count += sc.count
        } else {
          rows.push({ name: label, brut: sc.debit, count: sc.count })
        }
      }
    }
    return rows.filter(r => r.brut > 0).sort((a, b) => b.brut - a.brut)
  }, [vehiculeDetail, transportDetail])

  const totalBrut = useMemo(() => expenseRows.reduce((s, r) => s + r.brut, 0), [expenseRows])

  // Config loading gate — seed local state once when config arrives
  const configSeedYearRef = useRef<number | null>(null)
  useEffect(() => {
    if (!configLoaded || configSeedYearRef.current === year) return
    configSeedYearRef.current = year
    if (savedConfig) {
      setDistance(savedConfig.vehicule_distance_km ?? 0)
      setJours(savedConfig.jours_travailles ?? 230)
      setKmSup(savedConfig.vehicule_km_supplementaires ?? 0)
      setKmTotaux(savedConfig.vehicule_km_totaux_compteur ?? 1)
      setHonorairesLiasse(savedConfig.honoraires_liasse ? String(savedConfig.honoraires_liasse) : '')
    } else {
      setDistance(0)
      setJours(230)
      setKmSup(0)
      setKmTotaux(1)
      setHonorairesLiasse('')
    }
    setPdfDrawerOpen(false)
  }, [configLoaded, savedConfig, year])

  const configReady = configLoaded && configSeedYearRef.current === year

  // Calcul live instantané côté client (pas d'appel API)
  const calcResult = useMemo<VehiculeResult | null>(() => {
    if (!configReady || genere || kmTotaux <= 0) return null
    const kmTrajet = Math.round(jours * distance * 2 * 10) / 10
    const kmPro = Math.round((kmTrajet + kmSup) * 10) / 10
    const ratioPro = Math.round(Math.min((kmPro / kmTotaux) * 100, 100) * 10) / 10
    const ratioPerso = Math.round((100 - ratioPro) * 10) / 10
    const delta = ancienRatio != null ? Math.round((ratioPro - ancienRatio) * 10) / 10 : null
    return {
      type_forfait: 'vehicule' as const,
      year,
      distance_domicile_clinique_km: distance,
      jours_travailles: jours,
      km_trajet_habituel: kmTrajet,
      km_supplementaires: kmSup,
      km_pro_total: kmPro,
      km_totaux_compteur: kmTotaux,
      ratio_pro: ratioPro,
      ratio_perso: ratioPerso,
      ancien_ratio: ancienRatio,
      delta_ratio: delta,
    }
  }, [distance, jours, kmSup, kmTotaux, year, configReady, genere, ancienRatio])

  // Persist config on blur
  const handleBlur = () => {
    updateConfigMutation.mutate({
      year,
      data: {
        vehicule_distance_km: distance,
        vehicule_km_supplementaires: kmSup,
        vehicule_km_totaux_compteur: kmTotaux,
        jours_travailles: jours,
      },
    })
  }

  const handleAppliquer = () => {
    appliquerMutation.mutate(
      {
        year,
        distance_domicile_clinique_km: distance,
        jours_travailles: jours,
        km_supplementaires: kmSup,
        km_totaux_compteur: kmTotaux,
      },
      {
        onSuccess: (res) => {
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
                  createElement('span', { className: 'text-sm font-semibold text-text' }, 'Quote-part véhicule appliquée'),
                ),
                createElement('p', { className: 'text-xs text-text-muted' },
                  `Poste Véhicule mis à jour — Exercice ${year}`
                ),
                createElement('p', { className: 'text-sm font-medium text-emerald-400 mt-1' },
                  `${res.ratio_pro}%`
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
          toast.error(`Erreur : ${err.message}`)
        },
      },
    )
  }

  const handleRegenerer = () => {
    if (!window.confirm('Supprimer la quote-part existante et revenir à la saisie ?')) return
    supprimerMutation.mutate({ year })
  }

  // Auto-regénération PDF silencieuse quand l'onglet est visité (met à jour les dépenses)
  const regenYearRef = useRef<number | null>(null)
  useEffect(() => {
    if (!genere || regenYearRef.current === year) return
    regenYearRef.current = year
    regenerPdf.mutate({ year })
  }, [genere, year]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rendu ──
  if (loadingGenere) {
    return <div className="text-text-muted text-sm">Chargement...</div>
  }

  if (genere) {
    return (
      <>
      <div className="bg-surface border border-border rounded-lg p-6 space-y-5">
        {/* Checklist */}
        <div className="flex flex-wrap gap-6">
          {['Poste Véhicule mis à jour', 'PDF rapport généré', 'GED enregistré'].map(label => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="text-text">{label}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-6">
          {/* Colonne gauche */}
          <div className="space-y-4">
            {/* Bloc fichier */}
            <div className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border">
              <FileText className="w-8 h-8 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text">
                  {genere.pdf_filename}
                </p>
                <p className="text-xs text-text-muted">
                  Quote-part pro véhicule &middot; {new Date(genere.date_application).toLocaleDateString('fr-FR')} &middot; {genere.ratio_pro}%
                </p>
              </div>
            </div>

            <div className="text-lg font-semibold text-text">
              Quote-part professionnelle : {genere.ratio_pro}%
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate(`/ged?type=rapport&search=${encodeURIComponent('quote_part_vehicule')}`)}
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
                  preselected: genere.pdf_filename
                    ? [{ type: 'rapport' as const, filename: genere.pdf_filename }]
                    : [],
                  defaultSubject: `Quote-part véhicule ${year} — ${genere.ratio_pro}%`,
                })}
                className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Envoyer au comptable
              </button>
            </div>
          </div>

          {/* Colonne droite — Thumbnail PDF cliquable (PNG via PdfThumbnail) */}
          {genere.pdf_filename && (
            <PdfThumbnail
              docId={genere.ged_doc_id}
              onClick={() => setPdfDrawerOpen(true)}
              className="w-[200px] h-[280px] shrink-0 rounded-lg hover:ring-2 hover:ring-primary/40 transition-all"
              iconSize={48}
              lazy={false}
            />
          )}
        </div>

        {/* Détail dépenses véhicule */}
        <VehiculeExpenseTable rows={expenseRows} totalBrut={totalBrut} ratioPro={genere.ratio_pro} />

      </div>

      {/* Drawer PDF — rendu hors du container pour éviter les problèmes de stacking context */}
      <PdfPreviewDrawer
        open={pdfDrawerOpen}
        onClose={() => setPdfDrawerOpen(false)}
        filename={genere.pdf_filename || ''}
        title="Quote-part professionnelle véhicule"
        subtitle={`Exercice ${year} — ${genere.ratio_pro}%`}
      />
      </>
    )
  }

  // ── État 1 : Saisie ──
  const ratio = calcResult?.ratio_pro ?? 0
  const ratioPerso = calcResult?.ratio_perso ?? 100
  const kmTrajet = calcResult?.km_trajet_habituel ?? 0
  const kmPro = calcResult?.km_pro_total ?? 0
  const deltaRatio = calcResult?.delta_ratio ?? null

  const canApply = configReady && distance > 0 && kmTotaux > 0 && calcResult != null

  return (
    <div className="bg-surface border border-border rounded-lg p-6 space-y-6">
      <h3 className="text-lg font-semibold text-text flex items-center gap-2">
        <Car className="w-5 h-5 text-secondary" />
        Quote-part professionnelle véhicule — Exercice {year}
      </h3>

      {/* Inputs 2x2 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Distance domicile → clinique (km, aller simple)
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={distance}
            onChange={e => setDistance(parseFloat(e.target.value) || 0)}
            onBlur={handleBlur}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-text text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Jours travaillés
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={jours}
            onChange={e => setJours(parseFloat(e.target.value) || 0)}
            onBlur={handleBlur}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-text text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Km supplémentaires (gardes, formations)
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={kmSup}
            onChange={e => setKmSup(parseFloat(e.target.value) || 0)}
            onBlur={handleBlur}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-text text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">
            Km totaux compteur (relevé annuel)
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={kmTotaux}
            onChange={e => setKmTotaux(parseFloat(e.target.value) || 1)}
            onBlur={handleBlur}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-text text-sm"
          />
        </div>
      </div>

      {/* Honoraires liasse fiscale SCP */}
      <div>
        <label className="text-xs font-medium text-text-muted block mb-1">
          Honoraires liasse fiscale SCP
          <span className="text-text-muted/50 ml-1">(optionnel)</span>
        </label>
        <div className="relative w-56">
          <input
            type="text"
            inputMode="decimal"
            placeholder="En attente liasse..."
            value={honorairesLiasse}
            onChange={e => setHonorairesLiasse(e.target.value.replace(/[^0-9.,]/g, ''))}
            onBlur={() => {
              const val = honorairesLiasse ? parseFloat(honorairesLiasse.replace(',', '.')) : null
              updateConfigMutation.mutate({ year, data: { honoraires_liasse: val } })
            }}
            className="w-full px-3 py-2 pr-8 text-sm rounded-lg border border-border bg-background text-text placeholder:text-text-muted/40"
          />
          {honorairesLiasse && (
            <button
              type="button"
              onClick={() => {
                setHonorairesLiasse('')
                updateConfigMutation.mutate({ year, data: { honoraires_liasse: null } })
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Formule + MetricCards */}
      {configReady && (
        <div className="bg-background rounded-lg border border-border p-4 space-y-4">
          <p className="text-xs text-text-muted font-mono">
            ({jours} × {distance} × 2 + {kmSup.toLocaleString('fr-FR')}) / {kmTotaux.toLocaleString('fr-FR')}
          </p>
          <div className="grid grid-cols-3 gap-4">
            <MetricCard
              title="Km trajet habituel"
              value={kmTrajet.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}
            />
            <MetricCard
              title="Km professionnels"
              value={kmPro.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}
            />
            <MetricCard
              title="% déductible"
              value={`${ratio}%`}
              className={ratio > 0 ? 'ring-1 ring-emerald-500/20' : ''}
            />
          </div>
        </div>
      )}

      {/* Barre pro/perso */}
      {configReady && calcResult && (
        <div className="space-y-2">
          <div className="w-full h-4 rounded-full overflow-hidden bg-border flex">
            <div
              className="h-full bg-red-400/60 transition-all"
              style={{ width: `${ratioPerso}%` }}
            />
            <div
              className="h-full bg-emerald-500/60 transition-all"
              style={{ width: `${ratio}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-text-muted">
            <span>{ratioPerso}% perso</span>
            <span>{ratio}% pro</span>
          </div>
        </div>
      )}

      {/* Encadré poste actuel */}
      {configReady && ancienRatio != null && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-background border border-border">
          <Info className="w-4 h-4 text-secondary shrink-0" />
          <span className="text-sm text-text">
            Poste comptable actuel : <strong>Véhicule — déductible à {ancienRatio}%</strong>
          </span>
          {deltaRatio != null && deltaRatio !== 0 && (
            <span className={`ml-auto text-sm font-medium ${deltaRatio > 0 ? 'text-emerald-500' : 'text-warning'}`}>
              {deltaRatio > 0 ? '+' : ''}{deltaRatio} pts
            </span>
          )}
          {deltaRatio === 0 && (
            <span className="ml-auto text-sm text-text-muted">= inchangé</span>
          )}
        </div>
      )}

      {/* Détail dépenses véhicule */}
      <VehiculeExpenseTable rows={expenseRows} totalBrut={totalBrut} ratioPro={ratio} />

      {/* Bouton Appliquer */}
      <div className="flex justify-end">
        <button
          onClick={handleAppliquer}
          disabled={!canApply || appliquerMutation.isPending}
          className="px-6 py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          <Car className="w-4 h-4" />
          {appliquerMutation.isPending ? 'Application...' : `Appliquer ${ratio}% au poste Véhicule`}
        </button>
      </div>
    </div>
  )
}

// ── Tableau détail dépenses véhicule par sous-catégorie ──

function VehiculeExpenseTable({
  rows,
  totalBrut,
  ratioPro,
}: {
  rows: { name: string; brut: number; count: number }[]
  totalBrut: number
  ratioPro: number
}) {
  if (rows.length === 0) return null

  const pct = ratioPro / 100

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-text-muted">
        Dépenses véhicule de l'exercice
      </h4>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-background text-text-muted text-xs">
              <th className="text-left px-3 py-2 font-medium">Sous-catégorie</th>
              <th className="text-right px-3 py-2 font-medium">Ops</th>
              <th className="text-right px-3 py-2 font-medium">Montant brut</th>
              <th className="text-right px-3 py-2 font-medium">% déduc.</th>
              <th className="text-right px-3 py-2 font-medium">Montant déductible</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => (
              <tr key={r.name} className="text-text">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-right text-text-muted">{r.count}</td>
                <td className="px-3 py-2 text-right font-mono">{formatCurrency(r.brut)}</td>
                <td className="px-3 py-2 text-right text-text-muted">{ratioPro}%</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-500">
                  {formatCurrency(r.brut * pct)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-background font-medium text-text border-t border-border">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right text-text-muted">
                {rows.reduce((s, r) => s + r.count, 0)}
              </td>
              <td className="px-3 py-2 text-right font-mono">{formatCurrency(totalBrut)}</td>
              <td className="px-3 py-2 text-right text-text-muted">{ratioPro}%</td>
              <td className="px-3 py-2 text-right font-mono text-emerald-500">
                {formatCurrency(totalBrut * pct)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
