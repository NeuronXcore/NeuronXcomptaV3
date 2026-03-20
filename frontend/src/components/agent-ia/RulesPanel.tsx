import { useState, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'
import { Search, Plus, Trash2, Loader2, BookOpen, XCircle } from 'lucide-react'

interface RulesPanelProps {
  exactMatches: Record<string, string>
  subcategories: Record<string, string>
}

export default function RulesPanel({ exactMatches, subcategories }: RulesPanelProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [newLibelle, setNewLibelle] = useState('')
  const [newCategorie, setNewCategorie] = useState('')
  const [newSousCategorie, setNewSousCategorie] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const rules = useMemo(() => {
    const entries = Object.entries(exactMatches).map(([libelle, categorie]) => ({
      libelle,
      categorie,
      sousCategorie: subcategories[libelle] || null,
    }))

    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(
      (r) =>
        r.libelle.toLowerCase().includes(q) ||
        r.categorie.toLowerCase().includes(q) ||
        (r.sousCategorie && r.sousCategorie.toLowerCase().includes(q))
    )
  }, [exactMatches, subcategories, search])

  const addMutation = useMutation({
    mutationFn: (data: { libelle: string; categorie: string; sous_categorie?: string }) =>
      api.post('/ml/rules', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ml-model-full'] })
      queryClient.invalidateQueries({ queryKey: ['ml-model'] })
      setNewLibelle('')
      setNewCategorie('')
      setNewSousCategorie('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (libelle: string) => api.delete(`/ml/rules/${encodeURIComponent(libelle)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ml-model-full'] })
      queryClient.invalidateQueries({ queryKey: ['ml-model'] })
      setDeleteConfirm(null)
    },
  })

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newLibelle.trim() || !newCategorie.trim()) return
    addMutation.mutate({
      libelle: newLibelle.trim(),
      categorie: newCategorie.trim(),
      ...(newSousCategorie.trim() && { sous_categorie: newSousCategorie.trim() }),
    })
  }

  const totalRules = Object.keys(exactMatches).length

  return (
    <div className="bg-surface rounded-xl border border-border p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text flex items-center gap-2">
          <BookOpen size={16} className="text-primary" />
          Règles & Patterns
        </h3>
        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-medium">
          {totalRules} règles
        </span>
      </div>

      {/* Formulaire ajout */}
      <form onSubmit={handleAdd} className="space-y-2 mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={newLibelle}
            onChange={(e) => setNewLibelle(e.target.value)}
            placeholder="Libellé (ex: LIDL)"
            className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
          />
          <input
            type="text"
            value={newCategorie}
            onChange={(e) => setNewCategorie(e.target.value)}
            placeholder="Catégorie"
            className="w-32 bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newSousCategorie}
            onChange={(e) => setNewSousCategorie(e.target.value)}
            placeholder="Sous-catégorie (optionnel)"
            className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={addMutation.isPending || !newLibelle.trim() || !newCategorie.trim()}
            className="bg-primary text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-primary/80 disabled:opacity-50 flex items-center gap-1"
          >
            {addMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Ajouter
          </button>
        </div>
        {addMutation.isError && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <XCircle size={12} /> {addMutation.error.message}
          </p>
        )}
      </form>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted/50" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filtrer les règles..."
          className="w-full bg-background border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
        />
      </div>

      {/* Rules list */}
      <div className="flex-1 overflow-y-auto max-h-[350px] space-y-1 pr-1 scrollbar-thin">
        {rules.length === 0 ? (
          <p className="text-xs text-text-muted/60 text-center py-4">
            {search ? 'Aucune règle trouvée' : 'Aucune règle'}
          </p>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.libelle}
              className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-background group text-xs"
            >
              <span className="flex-1 text-text truncate font-mono text-[11px]">{rule.libelle}</span>
              <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap">
                {rule.categorie}
              </span>
              {rule.sousCategorie && (
                <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap">
                  {rule.sousCategorie}
                </span>
              )}
              {deleteConfirm === rule.libelle ? (
                <div className="flex gap-1">
                  <button
                    onClick={() => deleteMutation.mutate(rule.libelle)}
                    disabled={deleteMutation.isPending}
                    className="text-red-400 hover:text-red-300 text-[10px] font-medium"
                  >
                    {deleteMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : 'Oui'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="text-text-muted hover:text-text text-[10px]"
                  >
                    Non
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirm(rule.libelle)}
                  className={cn(
                    'text-text-muted/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity'
                  )}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {search && rules.length > 0 && (
        <p className="text-[10px] text-text-muted/50 mt-2 text-center">
          {rules.length} / {totalRules} règle(s) affichée(s)
        </p>
      )}
    </div>
  )
}
