import { useMemo, useState, useEffect } from 'react'
import {
  X, FileText, Pencil, Wand2, Trash2, Loader2, Hash, Calendar, Plus,
} from 'lucide-react'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useDrawerResize } from '@/hooks/useDrawerResize'
import {
  useGedTemplateDetail,
  useUpdateTemplate,
  useDeleteTemplate,
  useTemplate,
} from '@/hooks/useTemplates'
import { useCategories } from '@/hooks/useApi'

interface Props {
  templateId: string
  onClose: () => void
  onOpenEditor: (templateId: string) => void
  onBatchGenerate: (templateId: string, vendor: string) => void
  onOpenJustificatif?: (filename: string) => void
}

export default function GedTemplateDetailDrawer({
  templateId,
  onClose,
  onOpenEditor,
  onBatchGenerate,
  onOpenJustificatif,
}: Props) {
  const { data: detail, isLoading } = useGedTemplateDetail(templateId)
  // On garde aussi la version complète du template pour PATCH (source_justificatif, fields…)
  const { data: fullTemplate } = useTemplate(templateId)
  const { data: catData } = useCategories()
  const updateTemplate = useUpdateTemplate()
  const deleteTemplate = useDeleteTemplate()
  const { width: drawerWidth, handleMouseDown } = useDrawerResize({
    defaultWidth: 600,
    minWidth: 450,
    maxWidth: 1100,
    storageKey: 'ged-template-detail-width',
  })

  const [editingMeta, setEditingMeta] = useState(false)
  const [draftVendor, setDraftVendor] = useState('')
  const [draftAliases, setDraftAliases] = useState<string[]>([])
  const [aliasInput, setAliasInput] = useState('')
  const [draftCategory, setDraftCategory] = useState('')
  const [draftSousCat, setDraftSousCat] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const categories = useMemo(
    () => catData?.categories?.map(c => c.name) || [],
    [catData],
  )
  const subcategoriesMap = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const g of catData?.categories || []) {
      m[g.name] = g.subcategories.map(s => s.name)
    }
    return m
  }, [catData])

  // Init draft on load / template change
  useEffect(() => {
    if (detail && !editingMeta) {
      setDraftVendor(detail.vendor)
      setDraftAliases(detail.vendor_aliases)
      setDraftCategory(detail.category || '')
      setDraftSousCat(detail.sous_categorie || '')
    }
  }, [detail, editingMeta])

  const startEdit = () => setEditingMeta(true)
  const cancelEdit = () => {
    if (!detail) return
    setDraftVendor(detail.vendor)
    setDraftAliases(detail.vendor_aliases)
    setDraftCategory(detail.category || '')
    setDraftSousCat(detail.sous_categorie || '')
    setAliasInput('')
    setEditingMeta(false)
  }

  const saveMeta = () => {
    if (!fullTemplate) return
    updateTemplate.mutate({
      id: templateId,
      data: {
        vendor: draftVendor.trim(),
        vendor_aliases: draftAliases,
        category: draftCategory,
        sous_categorie: draftSousCat,
        source_justificatif: fullTemplate.source_justificatif || undefined,
        fields: fullTemplate.fields,
      },
    }, {
      onSuccess: () => setEditingMeta(false),
    })
  }

  const addAlias = () => {
    const v = aliasInput.trim().toLowerCase()
    if (v && !draftAliases.includes(v)) {
      setDraftAliases([...draftAliases, v])
    }
    setAliasInput('')
  }

  const removeAlias = (a: string) => setDraftAliases(draftAliases.filter(x => x !== a))

  const handleDelete = () => {
    deleteTemplate.mutate(templateId, {
      onSuccess: () => {
        setConfirmDelete(false)
        onClose()
      },
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 h-full max-w-[95vw] bg-background border-l border-border z-50 flex flex-col transition-transform duration-300 translate-x-0"
        style={{ width: drawerWidth }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-xl font-semibold text-text truncate">
                {detail?.vendor || '...'}
              </p>
              {detail?.is_blank_template && (
                <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 tracking-wide">
                  VIERGE
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {detail?.category || 'Sans catégorie'}
              {detail?.sous_categorie && <> · {detail.sous_categorie}</>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {isLoading || !detail ? (
            <div className="flex items-center gap-2 text-text-muted py-8 justify-center">
              <Loader2 size={16} className="animate-spin" />
              Chargement...
            </div>
          ) : (
            <>
              {/* Preview */}
              {detail.thumbnail_url && (
                <div>
                  <p className="text-xs font-medium text-text-muted mb-2">Aperçu</p>
                  <div className="rounded-lg border border-border overflow-hidden bg-white flex items-center justify-center">
                    <img
                      src={detail.thumbnail_url}
                      alt={detail.vendor}
                      className="max-h-64 w-auto object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Informations */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-text-muted">Informations</p>
                  {!editingMeta ? (
                    <button
                      onClick={startEdit}
                      className="text-[10px] text-text-muted hover:text-primary flex items-center gap-1"
                    >
                      <Pencil size={11} /> Modifier
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={cancelEdit}
                        className="text-[10px] text-text-muted hover:text-text px-2 py-0.5"
                      >
                        Annuler
                      </button>
                      <button
                        onClick={saveMeta}
                        disabled={!draftVendor.trim() || updateTemplate.isPending}
                        className="text-[10px] px-2 py-0.5 rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
                      >
                        {updateTemplate.isPending ? '...' : 'Enregistrer'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="bg-surface rounded-lg border border-border p-3 space-y-3 text-xs">
                  <div>
                    <p className="text-[10px] text-text-muted mb-1">Nom du fournisseur</p>
                    {editingMeta ? (
                      <input
                        type="text"
                        value={draftVendor}
                        onChange={(e) => setDraftVendor(e.target.value)}
                        className="w-full px-2 py-1 bg-background border border-border rounded text-text text-xs focus:outline-none focus:border-primary"
                      />
                    ) : (
                      <p className="text-sm text-text">{detail.vendor}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-text-muted mb-1">Alias de matching</p>
                    <div className="flex flex-wrap gap-1">
                      {(editingMeta ? draftAliases : detail.vendor_aliases).map(a => (
                        <span
                          key={a}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded text-[11px]"
                        >
                          {a}
                          {editingMeta && (
                            <button onClick={() => removeAlias(a)} className="hover:text-red-400">
                              <X size={10} />
                            </button>
                          )}
                        </span>
                      ))}
                      {editingMeta && (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={aliasInput}
                            onChange={(e) => setAliasInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAlias())}
                            placeholder="Ajouter..."
                            className="px-2 py-0.5 text-[11px] bg-background border border-border rounded focus:outline-none focus:border-primary w-24"
                          />
                          <button onClick={addAlias} className="p-0.5 text-text-muted hover:text-primary">
                            <Plus size={12} />
                          </button>
                        </div>
                      )}
                      {!editingMeta && detail.vendor_aliases.length === 0 && (
                        <span className="text-text-muted/60 text-[11px]">—</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] text-text-muted mb-1">Catégorie</p>
                      {editingMeta ? (
                        <select
                          value={draftCategory}
                          onChange={(e) => {
                            setDraftCategory(e.target.value)
                            setDraftSousCat('')
                          }}
                          className="w-full px-2 py-1 bg-background border border-border rounded text-text text-xs focus:outline-none focus:border-primary"
                        >
                          <option value="">-- Aucune --</option>
                          {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <p className="text-sm text-text">{detail.category || '—'}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted mb-1">Sous-catégorie</p>
                      {editingMeta ? (
                        <select
                          value={draftSousCat}
                          onChange={(e) => setDraftSousCat(e.target.value)}
                          disabled={!draftCategory}
                          className="w-full px-2 py-1 bg-background border border-border rounded text-text text-xs focus:outline-none focus:border-primary disabled:opacity-50"
                        >
                          <option value="">-- Aucune --</option>
                          {(subcategoriesMap[draftCategory] || []).map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-sm text-text">{detail.sous_categorie || '—'}</p>
                      )}
                    </div>
                  </div>
                  {!editingMeta && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                      <div>
                        <p className="text-[10px] text-text-muted mb-1">Créé le</p>
                        <p className="text-xs text-text">{detail.created_at?.slice(0, 10) || '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-text-muted mb-1">Utilisations</p>
                        <p className="text-xs text-text">{detail.usage_count}</p>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Champs variables (readonly résumé) */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-text-muted">
                    Champs variables ({detail.fields_count})
                  </p>
                  <button
                    onClick={() => onOpenEditor(templateId)}
                    className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1"
                  >
                    <Pencil size={11} /> Ouvrir l'éditeur
                  </button>
                </div>
                {fullTemplate && fullTemplate.fields.length > 0 ? (
                  <div className="bg-surface rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-surface-hover text-text-muted">
                        <tr>
                          <th className="text-left px-2 py-1.5">Clé</th>
                          <th className="text-left px-2 py-1.5">Label</th>
                          <th className="text-left px-2 py-1.5">Type</th>
                          <th className="text-center px-2 py-1.5">Position</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fullTemplate.fields.map((f, idx) => (
                          <tr key={idx} className="border-t border-border/30">
                            <td className="px-2 py-1.5 font-mono text-[11px] text-text">{f.key}</td>
                            <td className="px-2 py-1.5 text-text">{f.label}</td>
                            <td className="px-2 py-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-surface-hover text-text-muted text-[10px]">
                                {f.type}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-center font-mono text-[10px] text-text-muted">
                              {f.coordinates
                                ? `${Math.round(f.coordinates.x)},${Math.round(f.coordinates.y)}`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[11px] text-text-muted px-2">Aucun champ défini.</p>
                )}
              </section>

              {/* Fac-similés générés */}
              <section>
                <p className="text-xs font-medium text-text-muted mb-2">
                  Fac-similés générés ({detail.facsimiles_generated})
                </p>
                {detail.facsimiles.length === 0 ? (
                  <div className="text-[11px] text-text-muted bg-surface/40 border border-border rounded-lg p-3 text-center">
                    Aucun fac-similé généré depuis ce template.
                  </div>
                ) : (
                  <div className="bg-surface rounded-lg border border-border divide-y divide-border/30 max-h-72 overflow-y-auto">
                    {detail.facsimiles.map(fs => (
                      <button
                        key={fs.filename}
                        onClick={() => onOpenJustificatif?.(fs.filename)}
                        className="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors flex items-center gap-2"
                        title={fs.filename}
                      >
                        <FileText size={12} className="text-text-muted shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-text truncate">{fs.filename}</p>
                          <p className="text-[10px] text-text-muted flex items-center gap-2">
                            {fs.best_date && (
                              <span className="flex items-center gap-0.5">
                                <Calendar size={9} /> {formatDate(fs.best_date)}
                              </span>
                            )}
                            {fs.best_amount != null && (
                              <span className="flex items-center gap-0.5">
                                <Hash size={9} /> {formatCurrency(fs.best_amount)}
                              </span>
                            )}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex flex-col gap-2">
          {confirmDelete ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text">Supprimer ce template ?</p>
                {detail && detail.facsimiles_generated > 0 && (
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Les <span className="text-emerald-400 font-medium">{detail.facsimiles_generated} fac-similé{detail.facsimiles_generated > 1 ? 's' : ''}</span> déjà généré{detail.facsimiles_generated > 1 ? 's' : ''} ser{detail.facsimiles_generated > 1 ? 'ont' : 'a'} <span className="text-text">conservé{detail.facsimiles_generated > 1 ? 's' : ''}</span>.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 text-xs text-text-muted hover:text-text border border-border rounded-lg"
                >
                  Annuler
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteTemplate.isPending}
                  className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                >
                  {deleteTemplate.isPending ? '...' : 'Supprimer'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Trash2 size={12} />
                Supprimer
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onOpenEditor(templateId)}
                  className="px-3 py-1.5 text-xs text-text border border-border rounded-lg hover:border-primary/40 hover:bg-primary/5 flex items-center gap-1.5 transition-colors"
                >
                  <Pencil size={12} />
                  Éditer
                </button>
                <button
                  onClick={() => detail && onBatchGenerate(templateId, detail.vendor)}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors',
                    'border border-orange-500/30 text-orange-400 hover:bg-orange-500/10',
                  )}
                >
                  <Wand2 size={12} />
                  Générer en batch
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
