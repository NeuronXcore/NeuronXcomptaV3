import { useState } from 'react'
import { FileCheck, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCategories } from '@/hooks/useApi'
import type { JustificatifExemptions } from '@/types'

interface Props {
  exemptions: JustificatifExemptions
  onChange: (exemptions: JustificatifExemptions) => void
}

const DEFAULT_EXEMPTIONS: JustificatifExemptions = {
  categories: ['Perso'],
  sous_categories: {},
}

export default function JustificatifExemptionsSection({ exemptions, onChange }: Props) {
  const { data: catData } = useCategories()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const ex = exemptions || DEFAULT_EXEMPTIONS

  const categories = catData?.categories || []

  const toggleExpand = (cat: string) => {
    const next = new Set(expanded)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    setExpanded(next)
  }

  const isCatExempt = (cat: string) => ex.categories.includes(cat)

  const isSubExempt = (cat: string, sub: string) => {
    if (isCatExempt(cat)) return true
    return (ex.sous_categories[cat] || []).includes(sub)
  }

  const toggleCategory = (cat: string) => {
    const newCats = [...ex.categories]
    const newSubs = { ...ex.sous_categories }
    if (isCatExempt(cat)) {
      // Re-cocher = retirer de la liste exemptee
      const idx = newCats.indexOf(cat)
      if (idx >= 0) newCats.splice(idx, 1)
    } else {
      // Decocher = ajouter en exemptee
      newCats.push(cat)
      // Nettoyer les sous-categories individuelles (inutiles si la categorie entiere est exemptee)
      delete newSubs[cat]
    }
    onChange({ categories: newCats, sous_categories: newSubs })
  }

  const toggleSubcategory = (cat: string, sub: string) => {
    if (isCatExempt(cat)) return // disabled si categorie entiere exemptee
    const newSubs = { ...ex.sous_categories }
    const list = [...(newSubs[cat] || [])]
    const idx = list.indexOf(sub)
    if (idx >= 0) {
      list.splice(idx, 1)
    } else {
      list.push(sub)
    }
    if (list.length === 0) {
      delete newSubs[cat]
    } else {
      newSubs[cat] = list
    }
    onChange({ categories: ex.categories, sous_categories: newSubs })
  }

  // Etat checkbox categorie : coche, decoche ou indetermine
  const getCatState = (cat: string, subs: { name: string }[]): 'checked' | 'unchecked' | 'indeterminate' => {
    if (isCatExempt(cat)) return 'unchecked'
    const exemptSubs = ex.sous_categories[cat] || []
    if (exemptSubs.length === 0) return 'checked'
    if (subs.length > 0 && exemptSubs.length >= subs.length) return 'unchecked'
    return 'indeterminate'
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <FileCheck size={16} className="text-primary" />
        <div>
          <p className="text-sm font-medium text-text">Justificatifs requis</p>
          <p className="text-[10px] text-text-muted">Decochez les categories qui ne necessitent pas de justificatif</p>
        </div>
      </div>

      <div className="bg-background rounded-lg border border-border divide-y divide-border/50">
        {categories.map((g) => {
          const isOpen = expanded.has(g.name)
          const catExempt = isCatExempt(g.name)
          const state = getCatState(g.name, g.subcategories)
          const hasSubs = g.subcategories.length > 0

          return (
            <div key={g.name}>
              {/* Category row */}
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={state === 'checked'}
                  ref={(el) => { if (el) el.indeterminate = state === 'indeterminate' }}
                  onChange={() => toggleCategory(g.name)}
                  className="accent-primary shrink-0"
                />
                {hasSubs ? (
                  <button
                    onClick={() => toggleExpand(g.name)}
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  >
                    {isOpen ? <ChevronUp size={12} className="text-text-muted" /> : <ChevronDown size={12} className="text-text-muted" />}
                    <span className={cn('text-sm text-text', catExempt && 'line-through opacity-60')}>{g.name}</span>
                  </button>
                ) : (
                  <span className={cn('text-sm text-text flex-1', catExempt && 'line-through opacity-60')}>{g.name}</span>
                )}
                {catExempt && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning font-medium">Exempte</span>
                )}
                {!catExempt && (ex.sous_categories[g.name] || []).length > 0 && (
                  <span className="text-[9px] text-text-muted">{(ex.sous_categories[g.name] || []).length} exemptee(s)</span>
                )}
              </div>

              {/* Subcategories */}
              {isOpen && hasSubs && (
                <div className="pb-2">
                  {g.subcategories.map((s) => {
                    const subExempt = isSubExempt(g.name, s.name)
                    return (
                      <div key={s.name} className="flex items-center gap-2 px-3 py-1 ml-6">
                        <input
                          type="checkbox"
                          checked={!subExempt}
                          onChange={() => toggleSubcategory(g.name, s.name)}
                          disabled={catExempt}
                          className={cn('accent-primary shrink-0', catExempt && 'opacity-30')}
                        />
                        <span className={cn('text-xs text-text-muted', subExempt && 'line-through opacity-60')}>
                          {s.name}
                        </span>
                        {subExempt && !catExempt && (
                          <span className="text-[8px] px-1 py-0.5 rounded bg-warning/15 text-warning">Exempte</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
