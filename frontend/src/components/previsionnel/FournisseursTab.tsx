import { useState } from 'react'
import { Plus, Pencil, Trash2, Search, RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { useProviders, useDeleteProvider, useEcheances, useScanPrelevements, useAutoPopulateOcr } from '@/hooks/usePrevisionnel'
import StatusBadge from './StatusBadge'
import ProviderDrawer from './ProviderDrawer'
import PrelevementsGrid from './PrelevementsGrid'
import PrelevementsDrawer from './PrelevementsDrawer'
import LinkDocumentDrawer from './LinkDocumentDrawer'
import type { PrevProvider, PrevEcheance } from '@/types'

interface Props {
  year: number
}

export default function FournisseursTab({ year }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editProvider, setEditProvider] = useState<PrevProvider | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [prevDrawerEch, setPrevDrawerEch] = useState<PrevEcheance | null>(null)
  const [linkDrawerEch, setLinkDrawerEch] = useState<string | null>(null)

  const { data: providers, isLoading } = useProviders()
  const { data: echeances } = useEcheances(year)
  const deleteMut = useDeleteProvider()
  const scanPrev = useScanPrelevements()
  const autoOcr = useAutoPopulateOcr()

  const getProviderEcheances = (providerId: string) =>
    echeances?.filter((e) => e.provider_id === providerId) || []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{providers?.length || 0} fournisseur(s) configuré(s)</p>
        <button
          onClick={() => { setEditProvider(null); setDrawerOpen(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90"
        >
          <Plus size={14} /> Ajouter
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 size={20} className="animate-spin mr-2" /> Chargement...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {providers?.map((prov) => {
            const provEchs = getProviderEcheances(prov.id)
            const isExpanded = expandedId === prov.id
            return (
              <div key={prov.id} className={cn('bg-surface rounded-xl border border-border overflow-hidden', !prov.actif && 'opacity-50')}>
                {/* Header */}
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-text">{prov.fournisseur}</p>
                      <p className="text-[10px] text-text-muted">{prov.label}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] font-medium',
                        prov.mode === 'echeancier' ? 'bg-blue-500/15 text-blue-400' : 'bg-violet-500/15 text-violet-400',
                      )}>
                        {prov.mode === 'echeancier' ? 'Échéancier' : 'Facture'}
                      </span>
                      <span className="px-1.5 py-0.5 bg-surface-hover rounded text-[9px] text-text-muted">{prov.periodicite}</span>
                    </div>
                  </div>

                  {/* Keywords */}
                  {prov.keywords_ocr.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {prov.keywords_ocr.map((k) => (
                        <span key={k} className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[9px]">{k}</span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-[10px] text-text-muted">
                    {prov.categorie && <span>{prov.categorie}</span>}
                    {prov.montant_estime != null && <span>{formatCurrency(prov.montant_estime)}</span>}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => { setEditProvider(prov); setDrawerOpen(true) }} className="p-1 text-text-muted hover:text-primary"><Pencil size={13} /></button>
                    <button onClick={() => deleteMut.mutate(prov.id)} className="p-1 text-text-muted hover:text-red-400"><Trash2 size={13} /></button>
                    <div className="flex-1" />
                    {prov.mode === 'echeancier' && provEchs.length > 0 && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : prov.id)}
                        className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text"
                      >
                        Prélèvements {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded echeancier section */}
                {isExpanded && prov.mode === 'echeancier' && provEchs.map((ech) => (
                  <div key={ech.id} className="border-t border-border p-4 bg-background/50">
                    <div className="flex items-center gap-2 mb-3">
                      <StatusBadge statut={ech.statut} size="md" />
                      <span className="text-xs text-text-muted">{ech.periode_label}</span>
                      {ech.document_ref && <span className="text-[9px] text-emerald-400 truncate max-w-[120px]">{ech.document_ref}</span>}
                    </div>

                    {ech.prelevements.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-[10px] text-text-muted">
                            {ech.nb_prelevements_verifies}/{ech.nb_prelevements_total} vérifiés
                          </p>
                          <div className="flex-1 h-1 bg-background rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${ech.nb_prelevements_total ? (ech.nb_prelevements_verifies / ech.nb_prelevements_total) * 100 : 0}%` }} />
                          </div>
                        </div>
                        <PrelevementsGrid prelevements={ech.prelevements} />
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => scanPrev.mutate(ech.id)}
                        disabled={scanPrev.isPending}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface border border-border rounded text-text-muted hover:text-text"
                      >
                        <Search size={10} /> Scanner
                      </button>
                      <button
                        onClick={() => setPrevDrawerEch(ech)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface border border-border rounded text-text-muted hover:text-text"
                      >
                        <Pencil size={10} /> Corriger
                      </button>
                      {ech.document_ref && (
                        <button
                          onClick={() => autoOcr.mutate(ech.id)}
                          disabled={autoOcr.isPending}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface border border-border rounded text-text-muted hover:text-text"
                        >
                          <RefreshCw size={10} /> Re-OCR
                        </button>
                      )}
                      {!ech.document_ref && (
                        <button
                          onClick={() => setLinkDrawerEch(ech.id)}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-primary/15 text-primary rounded"
                        >
                          Associer doc
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      <ProviderDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} provider={editProvider} />

      {prevDrawerEch && (
        <PrelevementsDrawer
          open={!!prevDrawerEch}
          onClose={() => setPrevDrawerEch(null)}
          echeanceId={prevDrawerEch.id}
          prelevements={prevDrawerEch.prelevements}
        />
      )}

      {linkDrawerEch && (
        <LinkDocumentDrawer
          open={!!linkDrawerEch}
          onClose={() => setLinkDrawerEch(null)}
          echeanceId={linkDrawerEch}
        />
      )}
    </div>
  )
}
