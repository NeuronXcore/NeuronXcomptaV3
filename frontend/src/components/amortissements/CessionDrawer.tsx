import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { useCession } from '@/hooks/useAmortissements'
import type { Immobilisation } from '@/types'

interface CessionDrawerProps {
  immobilisation: Immobilisation | null
  isOpen: boolean
  onClose: () => void
}

export default function CessionDrawer({ immobilisation, isOpen, onClose }: CessionDrawerProps) {
  const cessionMutation = useCession()
  const [dateSortie, setDateSortie] = useState('')
  const [motif, setMotif] = useState('cession')
  const [prixCession, setPrixCession] = useState(0)

  useEffect(() => {
    setDateSortie('')
    setMotif('cession')
    setPrixCession(0)
  }, [immobilisation?.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!immobilisation) return null

  const handleSubmit = () => {
    cessionMutation.mutate(
      { id: immobilisation.id, data: { date_sortie: dateSortie, motif_sortie: motif, prix_cession: motif === 'cession' ? prixCession : 0 } },
      { onSuccess: () => onClose() }
    )
  }

  const result = cessionMutation.data

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[500px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-text">Sortie d'actif — {immobilisation.designation}</h2>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Date de sortie</label>
            <input type="date" value={dateSortie} onChange={e => setDateSortie(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Motif</label>
            <select value={motif} onChange={e => setMotif(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary">
              <option value="cession">Cession (vente)</option>
              <option value="rebut">Mise au rebut</option>
              <option value="vol">Vol</option>
            </select>
          </div>
          {motif === 'cession' && (
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Prix de cession</label>
              <input type="number" step="0.01" value={prixCession || ''} onChange={e => setPrixCession(parseFloat(e.target.value) || 0)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <h4 className="text-xs font-semibold text-text">Résultat de la sortie</h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-text-muted">VNC à la sortie</p>
                  <p className="text-text font-medium">{formatCurrency(result.vnc_sortie)}</p>
                </div>
                <div>
                  <p className="text-text-muted">Durée détention</p>
                  <p className="text-text font-medium">{result.duree_detention_mois} mois</p>
                </div>
                {result.plus_value != null && (
                  <div>
                    <p className="text-text-muted">Plus-value</p>
                    <p className="text-emerald-400 font-medium">{formatCurrency(result.plus_value)}</p>
                  </div>
                )}
                {result.moins_value != null && (
                  <div>
                    <p className="text-text-muted">Moins-value</p>
                    <p className="text-red-400 font-medium">{formatCurrency(result.moins_value)}</p>
                  </div>
                )}
                <div>
                  <p className="text-text-muted">Régime</p>
                  <p className={cn('font-medium', result.regime === 'long_terme' ? 'text-emerald-400' : 'text-amber-400')}>
                    {result.regime === 'long_terme' ? 'Long terme (≥ 2 ans)' : 'Court terme (< 2 ans)'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-text">Annuler</button>
          <button onClick={handleSubmit} disabled={!dateSortie || cessionMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/80 text-white rounded-lg text-sm hover:bg-red-500 disabled:opacity-50">
            {cessionMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Confirmer la sortie
          </button>
        </div>
      </div>
    </>
  )
}
