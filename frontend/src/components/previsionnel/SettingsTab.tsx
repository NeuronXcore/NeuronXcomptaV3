import { useState, useEffect, useMemo } from 'react'
import { Save, Loader2, Check, X, Eye, EyeOff } from 'lucide-react'
import { MOIS_FR, cn, formatCurrency } from '@/lib/utils'
import { usePrevSettings, useUpdatePrevSettings, useTimeline } from '@/hooks/usePrevisionnel'
import { useCategories } from '@/hooks/useApi'
import type { PrevSettings } from '@/types'

export default function SettingsTab() {
  const { data: settings, isLoading } = usePrevSettings()
  const { data: catData } = useCategories()
  const updateMut = useUpdatePrevSettings()

  const [seuil, setSeuil] = useState(200)
  const [exclues, setExclues] = useState<string[]>([])
  const [recettes, setRecettes] = useState<string[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})

  useEffect(() => {
    if (settings) {
      setSeuil(settings.seuil_montant)
      setExclues(settings.categories_exclues)
      setRecettes(settings.categories_recettes)
      const ov: Record<string, string> = {}
      for (const [k, v] of Object.entries(settings.overrides_mensuels)) {
        ov[k] = String(v)
      }
      setOverrides(ov)
    }
  }, [settings])

  const allCategories = useMemo(() => catData?.categories?.map((c) => c.name) || [], [catData])

  const toggleExclue = (cat: string) => {
    setExclues((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    )
  }

  const toggleRecette = (cat: string) => {
    setRecettes((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    )
  }

  const handleSave = () => {
    const ovNum: Record<string, number> = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (v) ovNum[k] = parseFloat(v) || 0
    }
    updateMut.mutate({
      seuil_montant: seuil,
      categories_exclues: exclues,
      categories_recettes: recettes,
      annees_reference: settings?.annees_reference || [],
      overrides_mensuels: ovNum,
    })
  }

  if (isLoading) return <div className="text-center py-12 text-text-muted">Chargement...</div>

  return (
    <div className="max-w-3xl space-y-8">
      {/* ── Seuil ── */}
      <div>
        <label className="text-xs font-medium text-text mb-1 block">
          Seuil montant minimum : <span className="text-primary font-mono">{seuil} EUR</span>
        </label>
        <input
          type="range"
          min={0}
          max={1000}
          step={50}
          value={seuil}
          onChange={(e) => setSeuil(parseInt(e.target.value))}
          className="w-full accent-primary"
        />
        <p className="text-[10px] text-text-muted mt-0.5">
          Les catégories sous ce seuil mensuel moyen n'apparaissent pas dans la timeline.
        </p>
      </div>

      {/* ── Catégories à inclure dans le prévisionnel ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-medium text-text">Catégories à inclure dans le prévisionnel</h3>
            <p className="text-[10px] text-text-muted mt-0.5">
              Cochez les catégories qui doivent apparaître dans la timeline. Les catégories décochées sont exclues.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExclues([])}
              className="text-[10px] text-primary hover:text-primary-light transition-colors"
            >
              Tout inclure
            </button>
            <span className="text-text-muted text-[10px]">|</span>
            <button
              onClick={() => setExclues([...allCategories])}
              className="text-[10px] text-text-muted hover:text-text transition-colors"
            >
              Tout exclure
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
          {allCategories.map((cat) => {
            const isIncluded = !exclues.includes(cat)
            const isRecette = recettes.includes(cat)
            return (
              <button
                key={cat}
                onClick={() => toggleExclue(cat)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs transition-all',
                  isIncluded
                    ? 'bg-surface border-primary/30 text-text'
                    : 'bg-background border-border/50 text-text-muted/50 line-through',
                )}
              >
                <div className={cn(
                  'w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors',
                  isIncluded ? 'bg-primary text-white' : 'bg-surface-hover',
                )}>
                  {isIncluded && <Check size={10} />}
                </div>
                <span className="flex-1 truncate">{cat}</span>
                {isRecette && (
                  <span className="px-1 py-0.5 bg-emerald-500/15 text-emerald-400 rounded text-[8px] shrink-0">
                    Recette
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <p className="text-[10px] text-text-muted mt-2">
          {allCategories.length - exclues.length} / {allCategories.length} catégories incluses
        </p>
      </div>

      {/* ── Catégories recettes ── */}
      <div>
        <div className="mb-3">
          <h3 className="text-xs font-medium text-text">Catégories recettes</h3>
          <p className="text-[10px] text-text-muted mt-0.5">
            Sélectionnez les catégories qui représentent des recettes (honoraires, revenus...). Laisser vide pour auto-détection (crédit {'>'} débit).
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {allCategories.filter((c) => !exclues.includes(c)).map((cat) => {
            const isRecette = recettes.includes(cat)
            return (
              <button
                key={cat}
                onClick={() => toggleRecette(cat)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] border transition-all',
                  isRecette
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                    : 'bg-surface border-border text-text-muted hover:text-text hover:border-border/80',
                )}
              >
                {isRecette ? <Check size={10} /> : <span className="w-2.5" />}
                {cat}
              </button>
            )
          })}
        </div>

        {recettes.length === 0 && (
          <p className="text-[10px] text-amber-400 mt-1.5 flex items-center gap-1">
            <Eye size={10} /> Auto-détection active (catégories où crédit {'>'} débit)
          </p>
        )}
      </div>

      {/* ── Overrides mensuels ── */}
      <div>
        <h3 className="text-xs font-medium text-text mb-1">Overrides mensuels recettes (EUR)</h3>
        <p className="text-[10px] text-text-muted mb-3">
          Forcez un montant de recettes pour un mois donné. Vide = projection automatique.
        </p>
        <div className="grid grid-cols-4 gap-2">
          {MOIS_FR.map((m, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-muted w-8 shrink-0">{m.slice(0, 3)}</span>
              <input
                type="number"
                step="100"
                value={overrides[`recettes-${i + 1}`] || ''}
                onChange={(e) => setOverrides({ ...overrides, [`recettes-${i + 1}`]: e.target.value })}
                placeholder="auto"
                className="w-full bg-surface border border-border rounded-md px-2 py-1 text-xs text-text font-mono placeholder:text-text-muted/30"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Save ── */}
      <div className="pt-2">
        <button
          onClick={handleSave}
          disabled={updateMut.isPending}
          className="flex items-center gap-1.5 px-5 py-2.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {updateMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Enregistrer les paramètres
        </button>
      </div>
    </div>
  )
}
