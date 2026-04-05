import { useState } from 'react'
import { X, Loader2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLinkEcheance } from '@/hooks/usePrevisionnel'
import { useJustificatifs } from '@/hooks/useJustificatifs'

interface Props {
  open: boolean
  onClose: () => void
  echeanceId: string
}

export default function LinkDocumentDrawer({ open, onClose, echeanceId }: Props) {
  const [selected, setSelected] = useState('')
  const [source, setSource] = useState<'justificatif' | 'ged'>('justificatif')
  const [montant, setMontant] = useState('')

  const linkMut = useLinkEcheance()
  const { data: justificatifs } = useJustificatifs({ status: 'all', search: '', sort_by: 'date', sort_order: 'desc' })

  const handleLink = () => {
    if (!selected) return
    linkMut.mutate({
      id: echeanceId,
      body: {
        document_ref: selected,
        document_source: source,
        montant_reel: montant ? parseFloat(montant) : undefined,
      },
    }, { onSuccess: onClose })
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[600px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
        open ? 'translate-x-0' : 'translate-x-full',
      )}>
        <div className="px-5 py-4 border-b border-border shrink-0 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            Associer un document
          </h2>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="text-[10px] text-text-muted mb-1 block">Source</label>
            <div className="flex gap-2">
              {(['justificatif', 'ged'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSource(s)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs transition-colors',
                    source === s ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text',
                  )}
                >
                  {s === 'justificatif' ? 'Justificatifs' : 'GED'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] text-text-muted mb-1 block">Document</label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text"
            >
              <option value="">Sélectionner...</option>
              {source === 'justificatif' && justificatifs?.map((j) => (
                <option key={j.filename} value={j.filename}>{j.original_name} ({j.date})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-text-muted mb-1 block">Montant réel (optionnel)</label>
            <input
              type="number"
              step="0.01"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              className="w-full bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border shrink-0 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg text-text-muted hover:text-text">Annuler</button>
          <button
            onClick={handleLink}
            disabled={!selected || linkMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {linkMut.isPending && <Loader2 size={14} className="animate-spin" />}
            Associer
          </button>
        </div>
      </div>
    </>
  )
}
