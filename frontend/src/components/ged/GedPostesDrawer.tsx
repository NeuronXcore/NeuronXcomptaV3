import { useState, useEffect } from 'react'
import { X, Trash2, Plus, Save, Loader2 } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { useGedPostes, useGedSavePostes, useGedStats } from '@/hooks/useGed'
import type { PosteComptable } from '@/types'

interface GedPostesDrawerProps {
  open: boolean
  onClose: () => void
}

export default function GedPostesDrawer({ open, onClose }: GedPostesDrawerProps) {
  const { data: postesConfig } = useGedPostes()
  const { data: stats } = useGedStats()
  const savePostesMutation = useGedSavePostes()

  const [localPostes, setLocalPostes] = useState<PosteComptable[]>([])
  const [exercice, setExercice] = useState(new Date().getFullYear())

  useEffect(() => {
    if (postesConfig) {
      setLocalPostes(postesConfig.postes.map(p => ({ ...p })))
      setExercice(postesConfig.exercice)
    }
  }, [postesConfig])

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const updatePoste = (index: number, updates: Partial<PosteComptable>) => {
    setLocalPostes(prev => prev.map((p, i) => i === index ? { ...p, ...updates } : p))
  }

  const removePoste = (index: number) => {
    setLocalPostes(prev => prev.filter((_, i) => i !== index))
  }

  const addPoste = () => {
    const id = `custom-${Date.now()}`
    setLocalPostes(prev => [...prev, {
      id,
      label: 'Nouveau poste',
      deductible_pct: 0,
      categories_associees: [],
      notes: '',
      is_system: false,
    }])
  }

  const handleSave = () => {
    savePostesMutation.mutate({
      version: 1,
      exercice,
      postes: localPostes,
    })
  }

  const statsMap = Object.fromEntries(
    (stats?.par_poste ?? []).map(s => [s.poste_id, s])
  )

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40 transition-opacity" onClick={onClose} />
      )}

      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[600px] max-w-[95vw] bg-background border-l border-border z-50 transition-transform duration-300 flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-text">Postes comptables</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-text-muted">Exercice</span>
              <select
                value={exercice}
                onChange={e => setExercice(parseInt(e.target.value))}
                className="bg-surface border border-border rounded px-2 py-0.5 text-xs text-text focus:outline-none focus:border-primary"
              >
                {[2023, 2024, 2025, 2026].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Postes list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {localPostes.map((poste, i) => {
            const posteStat = statsMap[poste.id]
            const sliderColor = poste.deductible_pct >= 100
              ? 'accent-emerald-500'
              : poste.deductible_pct >= 50
                ? 'accent-amber-500'
                : 'accent-red-500'

            return (
              <div
                key={poste.id}
                className="bg-surface border border-border rounded-lg p-4 space-y-3"
              >
                {/* Label + delete */}
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={poste.label}
                    onChange={e => updatePoste(i, { label: e.target.value })}
                    className="flex-1 bg-transparent text-sm font-medium text-text focus:outline-none border-b border-transparent focus:border-primary"
                  />
                  {!poste.is_system && (
                    <button
                      onClick={() => removePoste(i)}
                      className="p-1 text-text-muted hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {/* Slider */}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-text-muted w-6">0%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={poste.deductible_pct}
                    onChange={e => updatePoste(i, { deductible_pct: parseInt(e.target.value) })}
                    className={cn('flex-1 h-2', sliderColor)}
                  />
                  <span className="text-[10px] text-text-muted w-8">100%</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={poste.deductible_pct}
                    onChange={e => updatePoste(i, { deductible_pct: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) })}
                    className="w-14 bg-background border border-border rounded px-2 py-1 text-xs text-text text-center focus:outline-none focus:border-primary"
                  />
                  <span className="text-xs font-medium text-text w-6">%</span>
                </div>

                {/* Notes */}
                {poste.notes && (
                  <p className="text-[10px] text-text-muted">
                    {poste.notes}
                  </p>
                )}
                <input
                  type="text"
                  value={poste.notes}
                  onChange={e => updatePoste(i, { notes: e.target.value })}
                  placeholder="Notes..."
                  className="w-full bg-transparent text-[10px] text-text-muted focus:outline-none border-b border-transparent focus:border-primary/30"
                />

                {/* Categories */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-text-muted">Catégories :</span>
                  {poste.categories_associees.length > 0 ? (
                    poste.categories_associees.map(cat => (
                      <span key={cat} className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full flex items-center gap-1">
                        {cat}
                        <button
                          onClick={() => updatePoste(i, {
                            categories_associees: poste.categories_associees.filter(c => c !== cat),
                          })}
                          className="hover:text-red-400"
                        >
                          <X size={8} />
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-text-muted italic">(aucune)</span>
                  )}
                </div>

                {/* Stats */}
                {posteStat && (
                  <p className="text-[10px] text-text-muted">
                    {posteStat.nb_docs} doc{posteStat.nb_docs !== 1 ? 's' : ''}
                    {' · '}{formatCurrency(posteStat.total_brut)} brut
                    {' · '}{formatCurrency(posteStat.total_deductible)} déduit
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between shrink-0">
          <button
            onClick={addPoste}
            className="flex items-center gap-2 px-3 py-2 text-xs text-primary hover:bg-primary/10 rounded-lg transition-colors"
          >
            <Plus size={14} />
            Ajouter un poste
          </button>
          <button
            onClick={handleSave}
            disabled={savePostesMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {savePostesMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Sauvegarder
          </button>
        </div>
      </div>
    </>
  )
}
