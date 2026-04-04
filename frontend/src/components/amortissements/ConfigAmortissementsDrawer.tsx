import { useState, useEffect } from 'react'
import { X, Save, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAmortissementConfig, useSaveAmortissementConfig } from '@/hooks/useAmortissements'
import type { AmortissementConfig } from '@/types'

interface ConfigAmortissementsDrawerProps {
  open: boolean
  onClose: () => void
}

export default function ConfigAmortissementsDrawer({ open, onClose }: ConfigAmortissementsDrawerProps) {
  const { data: config } = useAmortissementConfig()
  const saveMutation = useSaveAmortissementConfig()
  const [local, setLocal] = useState<AmortissementConfig | null>(null)

  useEffect(() => {
    if (config) setLocal({ ...config })
  }, [config])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!local) return null

  const handleSave = () => {
    saveMutation.mutate(local, { onSuccess: () => onClose() })
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}
      <div className={cn(
        'fixed top-0 right-0 h-full w-[500px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
        open ? 'translate-x-0' : 'translate-x-full'
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-text">Configuration amortissements</h2>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Seuil */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Seuil d'immobilisation (€ TTC)</label>
            <input type="number" value={local.seuil_immobilisation}
              onChange={e => setLocal({ ...local, seuil_immobilisation: parseInt(e.target.value) || 0 })}
              className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary" />
            <p className="text-[10px] text-text-muted mt-1">Médecin exonéré TVA — seuil en TTC</p>
          </div>

          {/* Durées par défaut */}
          <div>
            <label className="text-[10px] text-text-muted block mb-2">Durées par défaut (années)</label>
            <div className="space-y-2">
              {Object.entries(local.durees_par_defaut).map(([poste, duree]) => (
                <div key={poste} className="flex items-center justify-between">
                  <span className="text-xs text-text">{poste}</span>
                  <select value={duree}
                    onChange={e => setLocal({
                      ...local,
                      durees_par_defaut: { ...local.durees_par_defaut, [poste]: parseInt(e.target.value) }
                    })}
                    className="bg-surface border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-primary">
                    {[1, 3, 5, 7, 10].map(d => <option key={d} value={d}>{d} ans</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Catégories éligibles */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Catégories éligibles</label>
            <div className="flex flex-wrap gap-1.5">
              {local.categories_immobilisables.map(c => (
                <span key={c} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
                  {c}
                  <button onClick={() => setLocal({
                    ...local,
                    categories_immobilisables: local.categories_immobilisables.filter(x => x !== c)
                  })} className="hover:text-red-400"><X size={10} /></button>
                </span>
              ))}
            </div>
          </div>

          {/* Plafonds véhicules (read-only) */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Plafonds véhicules (barème fiscal)</label>
            <div className="space-y-1 text-xs text-text-muted">
              <p>Électrique (≤ 20g CO2) : 30 000 €</p>
              <p>Hybride (20-50g CO2) : 20 300 €</p>
              <p>Standard (50-130g CO2) : 18 300 €</p>
              <p>Polluant (&gt; 130g CO2) : 9 900 €</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex justify-end shrink-0">
          <button onClick={handleSave} disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50">
            {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Enregistrer
          </button>
        </div>
      </div>
    </>
  )
}
