import { useState, createElement } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check, FileText, RefreshCw, Library, Send, Info, TrendingDown, Sparkles, X,
  Trash2, ExternalLink, AlertTriangle, Calculator,
} from 'lucide-react'
import toast from 'react-hot-toast'
import MetricCard from '@/components/shared/MetricCard'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import PdfThumbnail from '@/components/shared/PdfThumbnail'
import PdfPreviewDrawer from '@/components/charges-forfaitaires/PdfPreviewDrawer'
import {
  useDotationVirtualDetail,
  useDotationGenere,
  useGenererDotation,
  useSupprimerDotation,
  useRegenererPdfDotation,
} from '@/hooks/useAmortissements'
import { useSendDrawerStore } from '@/stores/sendDrawerStore'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import type { AmortissementVirtualDetail, DotationGenere, DotationImmoRow } from '@/types'

interface Props {
  year: number
}

export default function DotationTab({ year }: Props) {
  const { data: detail, isLoading: loadingDetail } = useDotationVirtualDetail(year)
  const { data: dotationGenere, isLoading: loadingGenere } = useDotationGenere(year)

  if (loadingDetail || loadingGenere) {
    return <LoadingSpinner text="Chargement..." />
  }

  if (!detail || detail.nb_immos_actives === 0) {
    return <EmptyState year={year} />
  }

  if (dotationGenere) {
    return <DotationGenereeState year={year} detail={detail} dotationGenere={dotationGenere} />
  }

  return <DotationSaisieState year={year} detail={detail} />
}

// ─── État 1 — saisie / pas encore générée ───

function DotationSaisieState({ year, detail }: { year: number; detail: AmortissementVirtualDetail }) {
  const generer = useGenererDotation()

  const handleGenerer = () => {
    generer.mutate(year, {
      onSuccess: (data: any) => {
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
                createElement('span', { className: 'text-sm font-semibold text-text' }, `Dotation ${year} générée`),
              ),
              createElement('p', { className: 'text-xs text-text-muted' },
                `${data?.nb_immos ?? detail.nb_immos_actives} immobilisation(s) · OD verrouillée au 31/12`,
              ),
              createElement('p', { className: 'text-sm font-medium text-emerald-400 mt-1' },
                formatCurrency(data?.montant_deductible ?? detail.total_deductible),
              ),
            ),
            createElement('button', {
              onClick: () => toast.dismiss(t.id),
              className: 'text-text-muted hover:text-text transition-colors shrink-0',
            }, createElement(X, { className: 'w-4 h-4' })),
          ),
        ), { duration: 6000 })
      },
      onError: (err) => toast.error(err.message || 'Erreur lors de la génération'),
    })
  }

  return (
    <div className="space-y-6">
      {/* InfoBox référence légale */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-violet-500/10 border border-violet-500/20">
        <Info className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-violet-300">Article 39-1-2° CGI · PCG 214-13</p>
          <p className="text-xs text-text-muted mt-1">
            Les dotations aux amortissements sont déductibles du résultat fiscal au prorata de l'usage
            professionnel. L'écriture est passée en OD au 31/12 et accompagnée d'un état détaillé.
          </p>
        </div>
      </div>

      {/* 3 MetricCards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MetricCard
          title="Dotation brute"
          value={formatCurrency(detail.total_brute)}
          icon={<TrendingDown size={18} className="text-text-muted" />}
        />
        <MetricCard
          title="Déductible"
          value={formatCurrency(detail.total_deductible)}
          icon={<TrendingDown size={18} className="text-violet-400" />}
          className="ring-1 ring-violet-500/30"
        />
        <MetricCard
          title="Immos actives"
          value={String(detail.nb_immos_actives)}
          icon={<Calculator size={18} className="text-text-muted" />}
        />
      </div>

      {/* Bandeau info verrouillage */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3 flex gap-2.5">
        <Info size={14} className="shrink-0 mt-0.5 text-blue-400" />
        <p className="text-xs text-blue-400 leading-relaxed">
          La dotation sera comptabilisée en OD au 31/12/{year} dans le fichier de décembre,
          avec un PDF rapport enregistré dans la GED. Opération verrouillée (
          <code className="text-[11px] bg-background/40 px-1 rounded">locked: true</code>).
        </p>
      </div>

      {/* Tableau récap immos contributives */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-background/40">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
            Immobilisations contributives
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface border-b border-border text-text-muted text-xs">
              <th className="text-left px-3 py-2 font-medium">Désignation</th>
              <th className="text-right px-3 py-2 font-medium">VNC début</th>
              <th className="text-right px-3 py-2 font-medium">Dot. brute</th>
              <th className="text-center px-3 py-2 font-medium">Quote-part</th>
              <th className="text-right px-3 py-2 font-medium">Déductible</th>
              <th className="text-right px-3 py-2 font-medium">VNC fin</th>
            </tr>
          </thead>
          <tbody>
            {detail.immos.map((immo: DotationImmoRow) => (
              <tr key={immo.immobilisation_id} className="border-b border-border/50">
                <td className="px-3 py-2 text-text">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="truncate max-w-[280px]">{immo.designation}</span>
                    {immo.is_reprise && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-medium">
                        Reprise {immo.exercice_entree_neuronx}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(immo.vnc_debut)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(immo.dotation_brute)}</td>
                <td className="px-3 py-2 text-center text-xs">{immo.quote_part_pro.toFixed(0)} %</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-violet-400 font-medium">
                  {formatCurrency(immo.dotation_deductible)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(immo.vnc_fin)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-violet-500/5 border-t-2 border-violet-500/30 font-bold">
              <td className="px-3 py-2 text-violet-400">TOTAL</td>
              <td className="px-3 py-2 text-right font-mono text-xs">—</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(detail.total_brute)}</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right font-mono text-xs text-violet-400">
                {formatCurrency(detail.total_deductible)}
              </td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Bouton Générer */}
      <button
        onClick={handleGenerer}
        disabled={generer.isPending}
        className="w-full py-3 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
      >
        <TrendingDown size={16} />
        {generer.isPending ? 'Génération en cours…' : `Générer la dotation ${year}`}
      </button>
    </div>
  )
}

// ─── État 2 — déjà générée ───

function DotationGenereeState({ year, detail, dotationGenere }: {
  year: number
  detail: AmortissementVirtualDetail
  dotationGenere: DotationGenere
}) {
  const navigate = useNavigate()
  const openSendDrawer = useSendDrawerStore((s) => s.open)
  const supprimer = useSupprimerDotation()
  const regenerer = useRegenererPdfDotation()
  const [pdfDrawerOpen, setPdfDrawerOpen] = useState(false)

  const handleRegenerer = () => {
    regenerer.mutate(year, {
      onSuccess: () => toast.success('PDF regénéré'),
      onError: (err) => toast.error(err.message || 'Erreur lors de la régénération'),
    })
  }

  const handleSupprimer = () => {
    if (!window.confirm(`Supprimer la dotation ${year} ?\nL'OD au 31/12 et le PDF seront retirés.`)) return
    supprimer.mutate(year, {
      onSuccess: () => toast.success(`Dotation ${year} supprimée`),
      onError: (err) => toast.error(err.message || 'Erreur lors de la suppression'),
    })
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-6 space-y-5">
      {/* Checklist 3✓ */}
      <div className="flex flex-wrap gap-6">
        {[
          'OD créée au 31/12',
          'PDF rapport généré',
          'Enregistré dans la GED',
        ].map((label) => (
          <div key={label} className="flex items-center gap-2 text-sm">
            <Check className="w-4 h-4 text-emerald-500" />
            <span className="text-text">{label}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-6">
        <div className="space-y-4">
          {/* Carte info OD */}
          <div className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border">
            <FileText className="w-8 h-8 text-red-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-text truncate">
                {dotationGenere.pdf_filename || `amortissements_${year}1231.pdf`}
              </p>
              <p className="text-xs text-text-muted">
                Dotation aux amortissements · 31/12/{year} · {detail.nb_immos_actives} immo(s)
              </p>
            </div>
          </div>

          <div className="text-lg font-semibold text-text">
            Montant déductible : <span className="text-violet-400">{formatCurrency(dotationGenere.montant)}</span>
          </div>

          {/* Boutons d'action */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => navigate(`/ged?type=rapport&search=${encodeURIComponent(dotationGenere.pdf_filename ?? `amortissements_${year}`)}`)}
              className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <Library className="w-4 h-4" />
              Ouvrir dans GED
            </button>
            <button
              onClick={() => navigate(`/editor?file=${encodeURIComponent(dotationGenere.filename)}&highlight=${dotationGenere.index}&from=amortissements`)}
              className="px-4 py-2 text-sm bg-surface border border-border text-text rounded-lg hover:bg-background transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Ouvrir dans l'éditeur
            </button>
            <button
              onClick={handleRegenerer}
              disabled={regenerer.isPending}
              className="px-4 py-2 text-sm bg-surface border border-border text-text rounded-lg hover:bg-background transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={cn('w-4 h-4', regenerer.isPending && 'animate-spin')} />
              Regénérer PDF
            </button>
            <button
              onClick={() => openSendDrawer({
                preselected: dotationGenere.pdf_filename
                  ? [{ type: 'rapport' as const, filename: dotationGenere.pdf_filename }]
                  : [],
                defaultSubject: `Dotation aux amortissements ${year}`,
              })}
              className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              Envoyer au comptable
            </button>
            <button
              onClick={handleSupprimer}
              disabled={supprimer.isPending}
              className="col-span-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              Supprimer la dotation {year}
            </button>
          </div>
        </div>

        {/* Thumbnail PDF cliquable */}
        {dotationGenere.pdf_filename && dotationGenere.ged_doc_id && (
          <PdfThumbnail
            docId={dotationGenere.ged_doc_id}
            onClick={() => setPdfDrawerOpen(true)}
            className="w-[200px] h-[280px] shrink-0 rounded-lg hover:ring-2 hover:ring-primary/40 transition-all cursor-pointer"
            iconSize={48}
            lazy={false}
          />
        )}
      </div>

      {/* Métadonnées */}
      <div className="text-xs text-text-muted border-t border-border pt-4">
        Référence : <code className="text-[11px] bg-background/40 px-1 rounded">{dotationGenere.filename}</code>
        {' · ligne '}<code className="text-[11px] bg-background/40 px-1 rounded">{dotationGenere.index}</code>
        {dotationGenere.date && <> · date {formatDate(dotationGenere.date)}</>}
      </div>

      {dotationGenere.pdf_filename && (
        <PdfPreviewDrawer
          open={pdfDrawerOpen}
          onClose={() => setPdfDrawerOpen(false)}
          filename={dotationGenere.pdf_filename}
          title="Dotation aux amortissements"
          subtitle={`Exercice ${year} — ${formatCurrency(dotationGenere.montant)}`}
        />
      )}
    </div>
  )
}

// ─── Empty state ───

function EmptyState({ year }: { year: number }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-10 text-center">
      <div className="w-12 h-12 rounded-full bg-background flex items-center justify-center mx-auto mb-3">
        <AlertTriangle size={20} className="text-text-muted" />
      </div>
      <p className="text-sm font-medium text-text mb-1">Aucune immobilisation active pour {year}</p>
      <p className="text-xs text-text-muted max-w-sm mx-auto">
        Aucune immobilisation active n'est éligible à une dotation cette année. Importez ou créez une
        immobilisation depuis l'onglet Registre ou Candidates.
      </p>
    </div>
  )
}
