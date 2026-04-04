import { useState, useMemo } from 'react'
import { X, Plus } from 'lucide-react'
import { useCategories } from '@/hooks/useApi'
import type { GedDocument, PosteComptable } from '@/types'

interface GedMetadataEditorProps {
  document: GedDocument
  postes: PosteComptable[]
  onChange: (updates: Record<string, unknown>) => void
}

export default function GedMetadataEditor({ document: doc, postes, onChange }: GedMetadataEditorProps) {
  const [tagInput, setTagInput] = useState('')
  const { data: categoriesData } = useCategories()
  const allCategories = categoriesData?.categories ?? []
  const subcategories = useMemo(() => {
    if (!doc.categorie) return []
    const cat = allCategories.find(c => c.name === doc.categorie)
    return cat?.subcategories?.map(s => s.name) ?? []
  }, [doc.categorie, allCategories])

  const poste = doc.poste_comptable ? postes.find(p => p.id === doc.poste_comptable) : null
  const effectivePct = doc.deductible_pct_override ?? (poste?.deductible_pct ?? 0)
  const deductibleAmount = doc.montant_brut ? doc.montant_brut * effectivePct / 100 : null
  const nonDeductible = doc.montant_brut && deductibleAmount != null ? doc.montant_brut - deductibleAmount : null

  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !doc.tags.includes(tag)) {
      onChange({ tags: [...doc.tags, tag] })
    }
    setTagInput('')
  }

  const removeTag = (tag: string) => {
    onChange({ tags: doc.tags.filter(t => t !== tag) })
  }

  return (
    <div className="space-y-4">
      {/* Classement comptable */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-text-muted block mb-1">Catégorie</label>
          <select
            value={doc.categorie || ''}
            onChange={e => { onChange({ categorie: e.target.value || null, sous_categorie: null }) }}
            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
          >
            <option value="">Aucune</option>
            {allCategories.map(c => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-text-muted block mb-1">Sous-catégorie</label>
          <select
            value={doc.sous_categorie || ''}
            onChange={e => onChange({ sous_categorie: e.target.value || null })}
            disabled={!doc.categorie || subcategories.length === 0}
            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary disabled:opacity-50"
          >
            <option value="">Aucune</option>
            {subcategories.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Fiscalité */}
      <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
        <h4 className="text-xs font-semibold text-text uppercase tracking-wide">Fiscalité</h4>

        {/* Poste comptable */}
        <div>
          <label className="text-[10px] text-text-muted block mb-1">Poste comptable</label>
          <select
            value={doc.poste_comptable || ''}
            onChange={e => onChange({ poste_comptable: e.target.value || null })}
            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
          >
            <option value="">Aucun</option>
            {postes.map(p => (
              <option key={p.id} value={p.id}>{p.label} ({p.deductible_pct}%)</option>
            ))}
          </select>
        </div>

        {/* Montant brut */}
        <div>
          <label className="text-[10px] text-text-muted block mb-1">Montant brut</label>
          <input
            type="number"
            step="0.01"
            value={doc.montant_brut ?? ''}
            onChange={e => onChange({ montant_brut: e.target.value ? parseFloat(e.target.value) : null })}
            placeholder="0.00"
            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
          />
        </div>

        {/* Déductible display */}
        {doc.montant_brut != null && doc.poste_comptable && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-[10px] text-text-muted">% déductible</p>
              <p className="text-text font-medium">{effectivePct}%</p>
            </div>
            <div>
              <p className="text-[10px] text-text-muted">D��ductible</p>
              <p className="text-emerald-400 font-medium">
                {deductibleAmount != null ? `${deductibleAmount.toFixed(2)} €` : '-'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-text-muted">Non déductible</p>
              <p className="text-red-400 font-medium">
                {nonDeductible != null ? `${nonDeductible.toFixed(2)} €` : '-'}
              </p>
            </div>
          </div>
        )}

        {/* Override checkbox */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="pct-override"
            checked={doc.deductible_pct_override != null}
            onChange={e => {
              if (e.target.checked) {
                onChange({ deductible_pct_override: poste?.deductible_pct ?? 0 })
              } else {
                onChange({ deductible_pct_override: null })
              }
            }}
            className="rounded border-border"
          />
          <label htmlFor="pct-override" className="text-xs text-text-muted">
            Surcharger le % pour ce document
          </label>
        </div>

        {doc.deductible_pct_override != null && (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={doc.deductible_pct_override}
              onChange={e => onChange({ deductible_pct_override: parseInt(e.target.value) })}
              className="flex-1 accent-primary"
            />
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={doc.deductible_pct_override}
              onChange={e => onChange({ deductible_pct_override: parseInt(e.target.value) || 0 })}
              className="w-16 bg-background border border-border rounded px-2 py-1 text-xs text-text text-center focus:outline-none focus:border-primary"
            />
            <span className="text-xs text-text-muted">%</span>
          </div>
        )}
      </div>

      {/* Tags */}
      <div>
        <label className="text-[10px] text-text-muted block mb-1">Tags</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {doc.tags.map(tag => (
            <span key={tag} className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full">
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-red-400">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
            placeholder="Ajouter un tag..."
            className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
          />
          <button
            onClick={addTag}
            disabled={!tagInput.trim()}
            className="px-2 py-1.5 bg-primary/15 text-primary rounded-lg hover:bg-primary/25 disabled:opacity-50"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="text-[10px] text-text-muted block mb-1">Notes</label>
        <textarea
          value={doc.notes || ''}
          onChange={e => onChange({ notes: e.target.value })}
          rows={3}
          placeholder="Notes..."
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-text focus:outline-none focus:border-primary resize-none"
        />
      </div>
    </div>
  )
}
