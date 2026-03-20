import { useState, useMemo, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Tags, Plus, Trash2, Palette, FolderTree, Bot, Pencil,
  Check, X, ChevronDown, ChevronRight, AlertCircle, Search,
  Loader2, Layers, Sparkles,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { useCategories } from '@/hooks/useApi'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'
import type { CategoryGroup } from '@/types'

type Tab = 'manage' | 'create' | 'subcategory' | 'labels'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'manage', label: 'Gestion', icon: Layers },
  { id: 'create', label: 'Nouvelle catégorie', icon: Plus },
  { id: 'subcategory', label: 'Sous-catégorie', icon: FolderTree },
  { id: 'labels', label: 'Labels IA', icon: Bot },
]

// Default color palette
const COLOR_PRESETS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
  '#1b12de', '#5fd8ea', '#c9de40', '#e8b93f', '#95A5A6',
]

export default function CategoriesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('manage')
  const { data: categoriesData, isLoading } = useCategories()
  const queryClient = useQueryClient()

  if (isLoading) return <LoadingSpinner text="Chargement des catégories..." />

  const categories = categoriesData?.categories || []

  return (
    <div>
      <PageHeader
        title="Catégories"
        description="Gérer vos catégories, sous-catégories et labels d'entraînement IA"
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface rounded-xl border border-border p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm rounded-lg transition-all flex-1 justify-center',
              activeTab === id
                ? 'bg-primary text-white shadow-md'
                : 'text-text-muted hover:text-text hover:bg-surface-hover'
            )}
          >
            <Icon size={16} />
            <span className="hidden md:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'manage' && <ManageTab categories={categories} />}
      {activeTab === 'create' && <CreateTab />}
      {activeTab === 'subcategory' && <SubcategoryTab categories={categories} />}
      {activeTab === 'labels' && <LabelsTab categories={categories} />}
    </div>
  )
}

// ─── Tab 1: Gestion des catégories ──────────────────────────────────

function ManageTab({ categories }: { categories: CategoryGroup[] }) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [searchText, setSearchText] = useState('')
  const [editingCat, setEditingCat] = useState<string | null>(null)
  const [editColor, setEditColor] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ name: string; sub?: string } | null>(null)
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: ({ name, sub }: { name: string; sub?: string }) => {
      const params = sub ? `?sous_categorie=${encodeURIComponent(sub)}` : ''
      return api.delete(`/categories/${encodeURIComponent(name)}${params}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setConfirmDelete(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) =>
      api.put(`/categories/${encodeURIComponent(name)}`, { color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setEditingCat(null)
    },
  })

  const toggleExpand = (name: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const filteredCategories = useMemo(() => {
    if (!searchText) return categories
    const s = searchText.toLowerCase()
    return categories.filter(c =>
      c.name.toLowerCase().includes(s) ||
      c.subcategories.some(sc => sc.name.toLowerCase().includes(s))
    )
  }, [categories, searchText])

  const totalSubs = categories.reduce((s, c) => s + c.subcategories.length, 0)

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface rounded-xl border border-border p-4 text-center">
          <p className="text-2xl font-bold text-primary">{categories.length}</p>
          <p className="text-xs text-text-muted mt-1">Catégories</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4 text-center">
          <p className="text-2xl font-bold text-text">{totalSubs}</p>
          <p className="text-xs text-text-muted mt-1">Sous-catégories</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-4 text-center">
          <p className="text-2xl font-bold text-success">{categories.length + totalSubs}</p>
          <p className="text-xs text-text-muted mt-1">Total</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Rechercher une catégorie..."
          className="w-full bg-surface border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-text outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Category list */}
      <div className="space-y-2">
        {filteredCategories.map(cat => {
          const isExpanded = expandedCats.has(cat.name)
          const isEditing = editingCat === cat.name

          return (
            <div key={cat.name} className="bg-surface rounded-xl border border-border overflow-hidden">
              {/* Category header */}
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors">
                {/* Expand toggle */}
                <button
                  onClick={() => toggleExpand(cat.name)}
                  className="text-text-muted hover:text-text transition-colors"
                >
                  {cat.subcategories.length > 0 ? (
                    isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                  ) : (
                    <div className="w-4" />
                  )}
                </button>

                {/* Color indicator */}
                {isEditing ? (
                  <input
                    type="color"
                    value={editColor}
                    onChange={e => setEditColor(e.target.value)}
                    className="w-7 h-7 rounded-lg border border-border cursor-pointer bg-transparent"
                  />
                ) : (
                  <div
                    className="w-4 h-4 rounded-full border border-white/20 flex-shrink-0 cursor-pointer hover:scale-125 transition-transform"
                    style={{ backgroundColor: cat.color }}
                    onClick={() => {
                      setEditingCat(cat.name)
                      setEditColor(cat.color)
                    }}
                    title="Modifier la couleur"
                  />
                )}

                {/* Category name */}
                <span
                  className="font-medium text-text flex-1 cursor-pointer"
                  onClick={() => toggleExpand(cat.name)}
                >
                  {cat.name}
                </span>

                {/* Subcategory count badge */}
                {cat.subcategories.length > 0 && (
                  <span className="text-xs text-text-muted bg-background px-2 py-0.5 rounded-full">
                    {cat.subcategories.length} sous-cat.
                  </span>
                )}

                {/* Edit actions */}
                {isEditing ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => updateMutation.mutate({ name: cat.name, color: editColor })}
                      className="p-1.5 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                    <button
                      onClick={() => setEditingCat(null)}
                      className="p-1.5 rounded-lg bg-surface-hover text-text-muted hover:text-text transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setEditingCat(cat.name)
                        setEditColor(cat.color)
                      }}
                      className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Modifier"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setConfirmDelete({ name: cat.name })}
                      className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Subcategories */}
              {isExpanded && cat.subcategories.length > 0 && (
                <div className="border-t border-border/50">
                  {cat.subcategories.map(sub => (
                    <div
                      key={sub.name}
                      className="flex items-center gap-3 px-4 py-2 pl-12 hover:bg-surface-hover transition-colors text-sm"
                    >
                      <div
                        className="w-3 h-3 rounded-full border border-white/20 flex-shrink-0"
                        style={{ backgroundColor: sub.color }}
                      />
                      <span className="flex-1 text-text-muted">{sub.name}</span>
                      <button
                        onClick={() => setConfirmDelete({ name: cat.name, sub: sub.name })}
                        className="p-1 rounded text-text-muted/50 hover:text-danger hover:bg-danger/10 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {filteredCategories.length === 0 && (
        <div className="bg-surface rounded-xl border border-border p-12 text-center text-text-muted">
          <Tags size={40} className="mx-auto mb-3 opacity-30" />
          <p>Aucune catégorie trouvée</p>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmDelete(null)}>
          <div className="bg-surface rounded-2xl border border-border p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center">
                <AlertCircle size={20} className="text-danger" />
              </div>
              <div>
                <h3 className="font-semibold text-text">Confirmer la suppression</h3>
                <p className="text-sm text-text-muted mt-1">
                  {confirmDelete.sub
                    ? <>Supprimer la sous-catégorie <strong>{confirmDelete.sub}</strong> de <strong>{confirmDelete.name}</strong> ?</>
                    : <>Supprimer la catégorie <strong>{confirmDelete.name}</strong> et toutes ses sous-catégories ?</>
                  }
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm bg-surface-hover rounded-lg hover:bg-border transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => deleteMutation.mutate({ name: confirmDelete.name, sub: confirmDelete.sub })}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-danger text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab 2: Créer une catégorie ──────────────────────────────────────

function CreateTab() {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#3b82f6')
  const [success, setSuccess] = useState(false)
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: () => api.post('/categories', { name, color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setSuccess(true)
      const savedName = name
      setName('')
      setTimeout(() => setSuccess(false), 3000)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    createMutation.mutate()
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-surface rounded-2xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Plus size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-text">Nouvelle catégorie</h2>
            <p className="text-xs text-text-muted">Ajoutez une catégorie principale pour classer vos opérations</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div>
            <label className="text-sm font-medium text-text mb-2 block">
              Nom de la catégorie
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Fournitures, Transport, Loisirs..."
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-text outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              autoFocus
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="text-sm font-medium text-text mb-2 block">
              Couleur
            </label>
            <div className="flex items-center gap-3 mb-3">
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-12 h-10 rounded-lg border border-border cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-text font-mono w-28 outline-none focus:ring-1 focus:ring-primary"
              />
              <div
                className="flex-1 h-10 rounded-lg border border-border flex items-center justify-center text-sm font-medium"
                style={{ backgroundColor: color + '20', color: color, borderColor: color + '40' }}
              >
                {name || 'Apercu'}
              </div>
            </div>
            {/* Presets */}
            <div className="flex flex-wrap gap-1.5">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-7 h-7 rounded-lg border-2 transition-all hover:scale-110',
                    color === c ? 'border-white scale-110' : 'border-transparent'
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Error */}
          {createMutation.isError && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger flex items-center gap-2">
              <AlertCircle size={16} />
              {createMutation.error.message}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-sm text-success flex items-center gap-2">
              <Check size={16} />
              Catégorie créée avec succes !
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary-dark disabled:opacity-50 transition-colors font-medium"
          >
            {createMutation.isPending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Plus size={18} />
            )}
            Créer la catégorie
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Tab 3: Ajouter une sous-catégorie ───────────────────────────────

function SubcategoryTab({ categories }: { categories: CategoryGroup[] }) {
  const [selectedCategory, setSelectedCategory] = useState('')
  const [subName, setSubName] = useState('')
  const [subColor, setSubColor] = useState('#95A5A6')
  const [success, setSuccess] = useState(false)
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: () => api.post('/categories/subcategory', {
      category: selectedCategory,
      name: subName,
      color: subColor,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setSuccess(true)
      setSubName('')
      setTimeout(() => setSuccess(false), 3000)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCategory || !subName.trim()) return
    createMutation.mutate()
  }

  // Auto-set color from parent
  const handleCategorySelect = (catName: string) => {
    setSelectedCategory(catName)
    const cat = categories.find(c => c.name === catName)
    if (cat) setSubColor(cat.color)
  }

  const selectedCat = categories.find(c => c.name === selectedCategory)

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-surface rounded-2xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-info/10 flex items-center justify-center">
            <FolderTree size={20} className="text-info" />
          </div>
          <div>
            <h2 className="font-semibold text-text">Nouvelle sous-catégorie</h2>
            <p className="text-xs text-text-muted">Ajoutez une sous-catégorie a une catégorie existante</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Parent category */}
          <div>
            <label className="text-sm font-medium text-text mb-2 block">
              Catégorie parente
            </label>
            <select
              value={selectedCategory}
              onChange={e => handleCategorySelect(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-text outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            >
              <option value="">Sélectionner une catégorie...</option>
              {categories.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Show existing subcategories */}
          {selectedCat && selectedCat.subcategories.length > 0 && (
            <div className="bg-background rounded-xl p-3">
              <p className="text-xs text-text-muted mb-2 font-medium">
                Sous-catégories existantes ({selectedCat.subcategories.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selectedCat.subcategories.map(sub => (
                  <span
                    key={sub.name}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                    style={{ backgroundColor: sub.color + '20', color: sub.color }}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sub.color }} />
                    {sub.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Subcategory name */}
          <div>
            <label className="text-sm font-medium text-text mb-2 block">
              Nom de la sous-catégorie
            </label>
            <input
              type="text"
              value={subName}
              onChange={e => setSubName(e.target.value)}
              placeholder="Ex: Essence, Informatique, Bloc..."
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-text outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              disabled={!selectedCategory}
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="text-sm font-medium text-text mb-2 block">
              Couleur
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={subColor}
                onChange={e => setSubColor(e.target.value)}
                className="w-12 h-10 rounded-lg border border-border cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={subColor}
                onChange={e => setSubColor(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-text font-mono w-28 outline-none focus:ring-1 focus:ring-primary"
              />
              {subName && (
                <div
                  className="flex-1 h-10 rounded-lg border flex items-center justify-center text-xs font-medium"
                  style={{ backgroundColor: subColor + '20', color: subColor, borderColor: subColor + '40' }}
                >
                  {selectedCategory} / {subName}
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {createMutation.isError && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger flex items-center gap-2">
              <AlertCircle size={16} />
              {createMutation.error.message}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-sm text-success flex items-center gap-2">
              <Check size={16} />
              Sous-catégorie ajoutée avec succes !
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!selectedCategory || !subName.trim() || createMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-info text-white rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors font-medium"
          >
            {createMutation.isPending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <FolderTree size={18} />
            )}
            Ajouter la sous-catégorie
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Tab 4: Labels IA ────────────────────────────────────────────────

function LabelsTab({ categories }: { categories: CategoryGroup[] }) {
  const [libelle, setLibelle] = useState('')
  const [categorie, setCategorie] = useState('')
  const [sousCategorie, setSousCategorie] = useState('')
  const [ruleType, setRuleType] = useState<'rule' | 'training'>('rule')
  const [success, setSuccess] = useState<string | null>(null)
  const [testLibelle, setTestLibelle] = useState('')
  const [prediction, setPrediction] = useState<{
    best_prediction: string | null
    rules_prediction: string | null
    sklearn_prediction: string | null
    rules_subcategory: string | null
    confidence: number
  } | null>(null)

  const queryClient = useQueryClient()

  // Get subcategories for selected category
  const subcategories = useMemo(() => {
    const cat = categories.find(c => c.name === categorie)
    return cat?.subcategories || []
  }, [categories, categorie])

  // Add rule mutation
  const addRuleMutation = useMutation({
    mutationFn: () => {
      if (ruleType === 'rule') {
        return api.post('/ml/rules', {
          libelle,
          categorie,
          sous_categorie: sousCategorie || null,
        })
      } else {
        return api.post('/ml/training-data', {
          libelle,
          categorie,
          sous_categorie: sousCategorie || '',
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ml-model'] })
      setSuccess(ruleType === 'rule' ? 'Regle exacte ajoutée !' : 'Exemple d\'entraînement ajouté !')
      setLibelle('')
      setTimeout(() => setSuccess(null), 3000)
    },
  })

  // Predict mutation
  const predictMutation = useMutation({
    mutationFn: () => api.post<{
      best_prediction: string | null
      rules_prediction: string | null
      sklearn_prediction: string | null
      rules_subcategory: string | null
      confidence: number
    }>('/ml/predict', { libelle: testLibelle }),
    onSuccess: (data) => setPrediction(data),
  })

  const handleAddLabel = (e: React.FormEvent) => {
    e.preventDefault()
    if (!libelle.trim() || !categorie) return
    addRuleMutation.mutate()
  }

  const handleTest = (e: React.FormEvent) => {
    e.preventDefault()
    if (!testLibelle.trim()) return
    predictMutation.mutate()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Add rule/training example */}
      <div className="bg-surface rounded-2xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
            <Sparkles size={20} className="text-warning" />
          </div>
          <div>
            <h2 className="font-semibold text-text">Ajouter un label</h2>
            <p className="text-xs text-text-muted">Enseignez au modele IA comment catégoriser</p>
          </div>
        </div>

        {/* Rule type toggle */}
        <div className="flex gap-1 mb-5 bg-background rounded-lg p-1">
          <button
            type="button"
            onClick={() => setRuleType('rule')}
            className={cn(
              'flex-1 px-3 py-2 text-sm rounded-md transition-all',
              ruleType === 'rule'
                ? 'bg-warning/20 text-warning font-medium'
                : 'text-text-muted hover:text-text'
            )}
          >
            Regle exacte
          </button>
          <button
            type="button"
            onClick={() => setRuleType('training')}
            className={cn(
              'flex-1 px-3 py-2 text-sm rounded-md transition-all',
              ruleType === 'training'
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-text-muted hover:text-text'
            )}
          >
            Exemple ML
          </button>
        </div>

        <p className="text-xs text-text-muted mb-4 bg-background rounded-lg p-3">
          {ruleType === 'rule'
            ? 'Une regle exacte associe directement un libellé a une catégorie. Si le libellé correspond exactement, la catégorie est appliquée.'
            : 'Un exemple d\'entraînement enrichit le modele ML (scikit-learn). Le modele apprend a généraliser a partir de plusieurs exemples similaires.'
          }
        </p>

        <form onSubmit={handleAddLabel} className="space-y-4">
          {/* Libellé */}
          <div>
            <label className="text-sm font-medium text-text mb-1.5 block">Libellé</label>
            <input
              type="text"
              value={libelle}
              onChange={e => setLibelle(e.target.value)}
              placeholder="Ex: CARTE CARREFOUR MONTAUBAN"
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-sm font-medium text-text mb-1.5 block">Catégorie</label>
            <select
              value={categorie}
              onChange={e => {
                setCategorie(e.target.value)
                setSousCategorie('')
              }}
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Sélectionner...</option>
              {categories.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Subcategory */}
          {subcategories.length > 0 && (
            <div>
              <label className="text-sm font-medium text-text mb-1.5 block">Sous-catégorie (optionnel)</label>
              <select
                value={sousCategorie}
                onChange={e => setSousCategorie(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Aucune</option>
                {subcategories.map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Error/Success */}
          {addRuleMutation.isError && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger flex items-center gap-2">
              <AlertCircle size={16} />
              {addRuleMutation.error.message}
            </div>
          )}
          {success && (
            <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-sm text-success flex items-center gap-2">
              <Check size={16} />
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={!libelle.trim() || !categorie || addRuleMutation.isPending}
            className={cn(
              'w-full flex items-center justify-center gap-2 px-4 py-3 text-white rounded-xl font-medium disabled:opacity-50 transition-colors',
              ruleType === 'rule'
                ? 'bg-warning hover:bg-amber-600'
                : 'bg-primary hover:bg-primary-dark'
            )}
          >
            {addRuleMutation.isPending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : ruleType === 'rule' ? (
              <Tags size={18} />
            ) : (
              <Bot size={18} />
            )}
            {ruleType === 'rule' ? 'Ajouter la regle' : 'Ajouter l\'exemple'}
          </button>
        </form>
      </div>

      {/* Test prediction */}
      <div className="bg-surface rounded-2xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bot size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-text">Tester la prédiction</h2>
            <p className="text-xs text-text-muted">Vérifiez comment l'IA catégorise un libellé</p>
          </div>
        </div>

        <form onSubmit={handleTest} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text mb-1.5 block">Libellé a tester</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={testLibelle}
                onChange={e => setTestLibelle(e.target.value)}
                placeholder="Entrez un libellé bancaire..."
                className="flex-1 bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="submit"
                disabled={!testLibelle.trim() || predictMutation.isPending}
                className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {predictMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              </button>
            </div>
          </div>
        </form>

        {/* Prediction result */}
        {prediction && (
          <div className="mt-5 space-y-3">
            <div className="bg-background rounded-xl p-4 space-y-3">
              {/* Best prediction */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Prédiction finale</span>
                {prediction.best_prediction ? (
                  <span className="px-3 py-1 bg-primary/15 text-primary rounded-full text-sm font-semibold">
                    {prediction.best_prediction}
                  </span>
                ) : (
                  <span className="text-sm text-danger italic">Aucune prédiction</span>
                )}
              </div>

              {/* Confidence */}
              <div>
                <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                  <span>Confiance</span>
                  <span className={cn(
                    'font-mono font-medium',
                    prediction.confidence >= 0.7 ? 'text-success' :
                    prediction.confidence >= 0.4 ? 'text-warning' : 'text-danger'
                  )}>
                    {Math.round(prediction.confidence * 100)}%
                  </span>
                </div>
                <div className="w-full bg-surface rounded-full h-2 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      prediction.confidence >= 0.7 ? 'bg-success' :
                      prediction.confidence >= 0.4 ? 'bg-warning' : 'bg-danger'
                    )}
                    style={{ width: `${prediction.confidence * 100}%` }}
                  />
                </div>
              </div>

              {/* Details */}
              <div className="border-t border-border/50 pt-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Regles</span>
                  <span className="text-text font-mono">{prediction.rules_prediction || '—'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Sklearn</span>
                  <span className="text-text font-mono">{prediction.sklearn_prediction || '—'}</span>
                </div>
                {prediction.rules_subcategory && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Sous-catégorie</span>
                    <span className="text-text font-mono">{prediction.rules_subcategory}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick add from test */}
            {prediction.best_prediction && (
              <button
                onClick={() => {
                  setLibelle(testLibelle)
                  setCategorie(prediction.best_prediction!)
                  if (prediction.rules_subcategory) setSousCategorie(prediction.rules_subcategory)
                }}
                className="w-full text-xs text-text-muted hover:text-primary transition-colors py-2"
              >
                Utiliser ce résultat pour ajouter un label →
              </button>
            )}
          </div>
        )}

        {predictMutation.isError && (
          <div className="mt-4 bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger flex items-center gap-2">
            <AlertCircle size={16} />
            {predictMutation.error.message}
          </div>
        )}
      </div>
    </div>
  )
}
