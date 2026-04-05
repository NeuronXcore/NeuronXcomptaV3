import { useState, useEffect } from 'react'
import { X, Loader2, Copy } from 'lucide-react'
import { cn, MOIS_FR } from '@/lib/utils'
import { useSetPrelevements, useScanPrelevements } from '@/hooks/usePrevisionnel'
import type { PrevPrelevement, PrelevementLine } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  echeanceId: string
  prelevements: PrevPrelevement[]
}

export default function PrelevementsDrawer({ open, onClose, echeanceId, prelevements }: Props) {
  const [lines, setLines] = useState<{ mois: number; montant: string; jour: string }[]>([])
  const [applyAll, setApplyAll] = useState('')

  const setMut = useSetPrelevements()
  const scanMut = useScanPrelevements()

  useEffect(() => {
    if (open) {
      setLines(Array.from({ length: 12 }, (_, i) => {
        const existing = prelevements.find((p) => p.mois === i + 1)
        return {
          mois: i + 1,
          montant: existing ? String(existing.montant_attendu) : '',
          jour: existing?.date_prevue ? existing.date_prevue.split('-')[2] : '15',
        }
      }))
    }
  }, [open, prelevements])

  const handleApplyAll = () => {
    if (!applyAll) return
    setLines(lines.map((l) => ({ ...l, montant: applyAll })))
    setApplyAll('')
  }

  const handleSave = () => {
    const data: PrelevementLine[] = lines
      .filter((l) => l.montant)
      .map((l) => ({
        mois: l.mois,
        montant: parseFloat(l.montant) || 0,
        jour: parseInt(l.jour) || undefined,
      }))
    setMut.mutate({ id: echeanceId, prelevements: data }, {
      onSuccess: () => {
        scanMut.mutate(echeanceId)
        onClose()
      },
    })
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[600px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
        open ? 'translate-x-0' : 'translate-x-full',
      )}>
        <div className="px-5 py-4 border-b border-border shrink-0 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Montants mensuels</h2>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Apply all */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              value={applyAll}
              onChange={(e) => setApplyAll(e.target.value)}
              placeholder="Appliquer à tous..."
              className="flex-1 bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text"
            />
            <button onClick={handleApplyAll} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-muted hover:text-text">
              <Copy size={12} /> Appliquer
            </button>
          </div>

          {/* 12 lines */}
          <div className="space-y-2">
            {lines.map((l, i) => {
              const existing = prelevements.find((p) => p.mois === l.mois)
              const isOcr = existing?.source === 'ocr'
              return (
                <div key={l.mois} className={cn('flex items-center gap-3 p-2 rounded-lg', isOcr && 'bg-blue-500/5 border border-blue-500/20')}>
                  <span className="w-20 text-xs text-text-muted">{MOIS_FR[i]}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={l.montant}
                    onChange={(e) => {
                      const next = [...lines]
                      next[i] = { ...next[i], montant: e.target.value }
                      setLines(next)
                    }}
                    placeholder="0,00"
                    className="flex-1 bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text font-mono"
                  />
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={l.jour}
                    onChange={(e) => {
                      const next = [...lines]
                      next[i] = { ...next[i], jour: e.target.value }
                      setLines(next)
                    }}
                    className="w-14 bg-surface border border-border rounded-md px-2 py-1.5 text-xs text-text-muted text-center"
                    title="Jour"
                  />
                  {isOcr && existing?.ocr_confidence != null && (
                    <span className={cn('text-[9px] px-1 rounded', existing.ocr_confidence >= 0.8 ? 'text-emerald-400' : 'text-amber-400')}>
                      {Math.round(existing.ocr_confidence * 100)}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border shrink-0 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg text-text-muted hover:text-text">Annuler</button>
          <button
            onClick={handleSave}
            disabled={setMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {setMut.isPending && <Loader2 size={14} className="animate-spin" />}
            Enregistrer + scanner
          </button>
        </div>
      </div>
    </>
  )
}
