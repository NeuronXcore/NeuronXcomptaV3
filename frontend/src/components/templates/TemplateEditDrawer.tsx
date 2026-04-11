import { useState, useEffect, useMemo } from 'react'
import { X, Pencil, Trash2, Plus, Save, Crosshair } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDrawerResize } from '@/hooks/useDrawerResize'
import { useTemplate, useUpdateTemplate, useDeleteTemplate } from '@/hooks/useTemplates'
import { useCategories } from '@/hooks/useApi'
import type { TemplateField, TemplateUpdatePayload } from '@/types'

interface Props {
  templateId: string | null
  onClose: () => void
}

const SOURCE_COLORS: Record<string, { label: string; color: string; overlayColor: string }> = {
  operation: { label: 'Opération', color: 'bg-blue-500/10 text-blue-400', overlayColor: 'rgba(59,130,246,0.3)' },
  ocr: { label: 'OCR', color: 'bg-emerald-500/10 text-emerald-400', overlayColor: 'rgba(16,185,129,0.3)' },
  manual: { label: 'Manuel', color: 'bg-amber-500/10 text-amber-400', overlayColor: 'rgba(245,158,11,0.3)' },
  computed: { label: 'Calculé', color: 'bg-violet-500/10 text-violet-400', overlayColor: 'rgba(139,92,246,0.3)' },
  fixed: { label: 'Fixe', color: 'bg-surface text-text-muted', overlayColor: 'rgba(156,163,175,0.3)' },
}

const FIELD_TYPES = ['text', 'date', 'currency', 'number', 'percent', 'select']
const FIELD_SOURCES = ['operation', 'ocr', 'manual', 'computed', 'fixed']

function isEssentialField(f: TemplateField): boolean {
  return (f.key === 'date' || f.key === 'montant_ttc') && f.source === 'operation'
}

export default function TemplateEditDrawer({ templateId, onClose }: Props) {
  const { data: template } = useTemplate(templateId)
  const { data: catData } = useCategories()
  const updateTemplate = useUpdateTemplate()
  const deleteTemplate = useDeleteTemplate()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<TemplateUpdatePayload | null>(null)
  const [aliasInput, setAliasInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { width: drawerWidth, handleMouseDown } = useDrawerResize({ defaultWidth: 700, minWidth: 450, maxWidth: 1100, storageKey: 'template-edit-width' })

  const categories = useMemo(
    () => catData?.categories?.map((c) => c.name) || [],
    [catData],
  )

  const subcategoriesMap = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const g of catData?.categories || []) {
      m[g.name] = g.subcategories.map((s) => s.name)
    }
    return m
  }, [catData])

  // Init draft from template
  useEffect(() => {
    if (template && editing && !draft) {
      setDraft({
        vendor: template.vendor,
        vendor_aliases: [...template.vendor_aliases],
        category: template.category || '',
        sous_categorie: template.sous_categorie || '',
        fields: template.fields.map((f) => ({ ...f })),
      })
    }
  }, [template, editing, draft])

  if (!templateId) return null

  const tpl = template
  const open = !!templateId

  const handleStartEdit = () => {
    if (!tpl) return
    setDraft({
      vendor: tpl.vendor,
      vendor_aliases: [...tpl.vendor_aliases],
      category: tpl.category || '',
      sous_categorie: tpl.sous_categorie || '',
      source_justificatif: tpl.source_justificatif || null,
      fields: tpl.fields.map((f) => ({ ...f, coordinates: f.coordinates ? { ...f.coordinates } : undefined })),
    })
    setEditing(true)
  }

  const handleCancel = () => {
    setEditing(false)
    setDraft(null)
    setAliasInput('')
  }

  const handleSave = () => {
    if (!draft || !templateId) return
    updateTemplate.mutate({ id: templateId, data: draft }, {
      onSuccess: () => {
        setEditing(false)
        setDraft(null)
      },
    })
  }

  const handleDelete = () => {
    if (!templateId) return
    deleteTemplate.mutate(templateId, {
      onSuccess: () => onClose(),
    })
  }

  const handleAddAlias = () => {
    if (!draft) return
    const v = aliasInput.trim().toLowerCase()
    if (v && !draft.vendor_aliases.includes(v)) {
      setDraft({ ...draft, vendor_aliases: [...draft.vendor_aliases, v] })
    }
    setAliasInput('')
  }

  const handleRemoveAlias = (alias: string) => {
    if (!draft) return
    setDraft({ ...draft, vendor_aliases: draft.vendor_aliases.filter((a) => a !== alias) })
  }

  const handleFieldChange = (idx: number, key: string, value: string) => {
    if (!draft) return
    const fields = [...draft.fields]
    fields[idx] = { ...fields[idx], [key]: value }
    setDraft({ ...draft, fields })
  }

  const handleAddField = () => {
    if (!draft) return
    const newField: TemplateField = {
      key: '',
      label: '',
      type: 'text',
      source: 'manual',
      required: false,
    }
    setDraft({ ...draft, fields: [...draft.fields, newField] })
  }

  const handleRemoveField = (idx: number) => {
    if (!draft) return
    setDraft({ ...draft, fields: draft.fields.filter((_, i) => i !== idx) })
  }

  const canSave = draft
    && draft.vendor.trim()
    && draft.vendor_aliases.length > 0
    && draft.fields.some((f) => f.key === 'date' && f.source === 'operation')
    && draft.fields.some((f) => f.key === 'montant_ttc' && f.source === 'operation')

  const displayFields = editing ? (draft?.fields || []) : (tpl?.fields || [])
  const displayVendor = editing ? (draft?.vendor || '') : (tpl?.vendor || '')
  const displayAliases = editing ? (draft?.vendor_aliases || []) : (tpl?.vendor_aliases || [])
  const displayCategory = editing ? (draft?.category || '') : (tpl?.category || '')
  const displaySousCategorie = editing ? (draft?.sous_categorie || '') : (tpl?.sous_categorie || '')

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full max-w-[95vw] bg-background border-l border-border z-50 flex flex-col transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ width: drawerWidth }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            {editing ? (
              <input
                type="text"
                value={draft?.vendor || ''}
                onChange={(e) => draft && setDraft({ ...draft, vendor: e.target.value })}
                className="text-xl font-semibold text-text bg-transparent border-b border-border focus:border-primary focus:outline-none w-full"
                placeholder="Nom fournisseur"
              />
            ) : (
              <p className="text-xl font-semibold text-text">{displayVendor}</p>
            )}
            <p className="text-xs text-text-muted mt-0.5">{displayCategory || 'Sans categorie'}</p>
          </div>
          <div className="flex items-center gap-2">
            {!editing && (
              <button
                onClick={handleStartEdit}
                className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface transition-colors"
                title="Modifier"
              >
                <Pencil size={16} />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Aliases */}
          <div>
            <p className="text-xs font-medium text-text-muted mb-2">Alias de matching</p>
            <div className="flex flex-wrap gap-1.5">
              {displayAliases.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded text-xs">
                  {a}
                  {editing && (
                    <button onClick={() => handleRemoveAlias(a)} className="hover:text-red-400">
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
              {editing && (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
                    placeholder="Ajouter..."
                    className="px-2 py-0.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-primary w-24"
                  />
                  <button onClick={handleAddAlias} className="p-0.5 text-text-muted hover:text-primary">
                    <Plus size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Categorie / Sous-categorie */}
          {editing ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium text-text-muted mb-1">Categorie</p>
                <select
                  value={draft?.category || ''}
                  onChange={(e) => {
                    if (!draft) return
                    setDraft({ ...draft, category: e.target.value, sous_categorie: '' })
                  }}
                  className="w-full px-2 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-primary text-text"
                >
                  <option value="">-- Aucune --</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <p className="text-xs font-medium text-text-muted mb-1">Sous-categorie</p>
                <select
                  value={draft?.sous_categorie || ''}
                  onChange={(e) => draft && setDraft({ ...draft, sous_categorie: e.target.value })}
                  className="w-full px-2 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-primary text-text"
                >
                  <option value="">-- Aucune --</option>
                  {(subcategoriesMap[draft?.category || ''] || []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface rounded-lg border border-border p-3">
                <p className="text-[10px] text-text-muted mb-1">Categorie</p>
                <p className="text-sm text-text">{displayCategory || '—'}</p>
              </div>
              <div className="bg-surface rounded-lg border border-border p-3">
                <p className="text-[10px] text-text-muted mb-1">Sous-categorie</p>
                <p className="text-sm text-text">{displaySousCategorie || '—'}</p>
              </div>
            </div>
          )}

          {/* Stats (lecture seule) */}
          {!editing && tpl && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface rounded-lg border border-border p-3">
                <p className="text-[10px] text-text-muted mb-1">Utilisations</p>
                <p className="text-sm text-text">{tpl.usage_count}</p>
              </div>
              <div className="bg-surface rounded-lg border border-border p-3">
                <p className="text-[10px] text-text-muted mb-1">Cree le</p>
                <p className="text-sm text-text">{tpl.created_at?.slice(0, 10) || '—'}</p>
              </div>
            </div>
          )}

          {/* Table champs */}
          <div>
            <p className="text-xs font-medium text-text-muted mb-2">
              Champs ({displayFields.length})
            </p>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-hover text-text-muted">
                    <th className="text-left px-2 py-1.5">Cle</th>
                    <th className="text-left px-2 py-1.5">Label</th>
                    <th className="text-left px-2 py-1.5">Type</th>
                    <th className="text-left px-2 py-1.5">Source</th>
                    {editing && <th className="text-left px-2 py-1.5">Defaut</th>}
                    {!editing && <th className="text-center px-2 py-1.5 w-10">Pos.</th>}
                    {editing && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {displayFields.map((f, idx) => {
                    const essential = isEssentialField(f)
                    return (
                      <tr key={idx} className="border-t border-border/30">
                        <td className="px-2 py-1.5">
                          {editing ? (
                            <input
                              value={f.key}
                              onChange={(e) => handleFieldChange(idx, 'key', e.target.value.replace(/\s/g, '_').toLowerCase())}
                              className="w-full px-1 py-0.5 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:border-primary"
                              placeholder="key"
                            />
                          ) : (
                            <span className="text-text font-medium">
                              {f.key}
                              {essential && <span className="ml-1 text-[9px] px-1 py-0.5 bg-blue-500/10 text-blue-400 rounded">AUTO</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {editing ? (
                            <input
                              value={f.label}
                              onChange={(e) => handleFieldChange(idx, 'label', e.target.value)}
                              className="w-full px-1 py-0.5 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:border-primary"
                              placeholder="Label"
                            />
                          ) : (
                            <span className="text-text">{f.label}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {editing ? (
                            <select
                              value={f.type}
                              onChange={(e) => handleFieldChange(idx, 'type', e.target.value)}
                              className="px-1 py-0.5 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:border-primary"
                            >
                              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-surface text-text-muted text-[10px]">{f.type}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {editing ? (
                            <select
                              value={f.source}
                              onChange={(e) => handleFieldChange(idx, 'source', e.target.value)}
                              className="px-1 py-0.5 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:border-primary"
                            >
                              {FIELD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : (
                            <span className={cn('px-1.5 py-0.5 rounded text-[10px]', SOURCE_COLORS[f.source]?.color || 'bg-surface text-text-muted')}>
                              {SOURCE_COLORS[f.source]?.label || f.source}
                            </span>
                          )}
                        </td>
                        {editing && (
                          <td className="px-2 py-1.5">
                            {(f.source === 'fixed' || f.source === 'computed') && (
                              <input
                                value={f.source === 'computed' ? (f.formula || '') : String(f.default ?? '')}
                                onChange={(e) => handleFieldChange(
                                  idx,
                                  f.source === 'computed' ? 'formula' : 'default',
                                  e.target.value,
                                )}
                                className="w-full px-1 py-0.5 bg-surface border border-border rounded text-text text-xs font-mono focus:outline-none focus:border-primary"
                                placeholder={f.source === 'computed' ? 'formule' : 'valeur'}
                              />
                            )}
                          </td>
                        )}
                        {!editing && (
                          <td className="px-2 py-1.5 text-center">
                            {f.coordinates ? (
                              <Crosshair size={11} className="text-emerald-400 mx-auto" />
                            ) : (
                              <span className="text-text-muted/30">—</span>
                            )}
                          </td>
                        )}
                        {editing && (
                          <td className="px-1 py-1.5 text-center">
                            {!essential && (
                              <button
                                onClick={() => handleRemoveField(idx)}
                                className="p-0.5 text-text-muted/30 hover:text-red-400"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {editing && (
              <button
                onClick={handleAddField}
                className="mt-2 flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <Plus size={12} /> Ajouter un champ
              </button>
            )}
          </div>

          {/* Preview PDF source */}
          {tpl?.source_justificatif && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-2">PDF source</p>
              <div className="relative rounded-lg border border-border overflow-hidden bg-white">
                <img
                  src={`/api/justificatifs/${encodeURIComponent(tpl.source_justificatif)}/thumbnail`}
                  alt={tpl.vendor}
                  className="w-full h-auto object-contain"
                />
              </div>
              {/* Legende couleurs */}
              <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-blue-500/30" /> Opération (auto)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-amber-500/30" /> Manuel
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-violet-500/30" /> Calculé
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between">
          {editing ? (
            <>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-text border border-border rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave || updateTemplate.isPending}
                className={cn(
                  'px-4 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors',
                  canSave ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-surface text-text-muted cursor-not-allowed',
                )}
              >
                <Save size={13} />
                {updateTemplate.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleStartEdit}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-text border border-border rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Pencil size={12} /> Modifier
              </button>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">Confirmer ?</span>
                  <button
                    onClick={handleDelete}
                    className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                  >
                    Supprimer
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 text-xs text-text-muted hover:text-text border border-border rounded-lg transition-colors"
                  >
                    Non
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 size={12} /> Supprimer
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
