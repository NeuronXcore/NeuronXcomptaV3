import { useState, useCallback } from 'react'
import {
  useTemplates, useExtractFields, useCreateTemplate,
  useDeleteTemplate, useGenerateReconstitue, useTemplateSuggestion,
} from '@/hooks/useTemplates'
import { useCategories } from '@/hooks/useApi'
import { useJustificatifs } from '@/hooks/useJustificatifs'
import { cn, formatCurrency } from '@/lib/utils'
import {
  Search, Plus, Trash2, FileText, Loader2, X, ScanLine,
  CheckCircle, Tag, Hash, Calendar, DollarSign,
} from 'lucide-react'
import type { TemplateField, ExtractedFields } from '@/types'

interface Props {
  preFile?: string | null
  preIndex?: string | null
  preTemplate?: string | null
}

export default function TemplatesTab({ preFile, preIndex, preTemplate }: Props) {
  return (
    <div className="space-y-8">
      <CreateSection />
      <LibrarySection />
      <GenerateSection preFile={preFile} preIndex={preIndex} preTemplate={preTemplate} />
    </div>
  )
}


// ──── Section Créer ────

function CreateSection() {
  const [selectedFile, setSelectedFile] = useState('')
  const [extracted, setExtracted] = useState<ExtractedFields | null>(null)
  const [vendor, setVendor] = useState('')
  const [aliases, setAliases] = useState<string[]>([])
  const [aliasInput, setAliasInput] = useState('')
  const [category, setCategory] = useState('')
  const [sousCategorie, setSousCategorie] = useState('')
  const [includedFields, setIncludedFields] = useState<Record<string, boolean>>({})
  const [fieldSources, setFieldSources] = useState<Record<string, string>>({})

  const { data: justificatifs } = useJustificatifs({
    status: 'all', search: '', sort_by: 'date', sort_order: 'desc',
  })
  const { data: catData } = useCategories()
  const extractFields = useExtractFields()
  const createTemplate = useCreateTemplate()

  const handleAnalyse = () => {
    if (!selectedFile) return
    extractFields.mutate(selectedFile, {
      onSuccess: (data) => {
        setExtracted(data)
        setVendor(data.vendor)
        setAliases(data.suggested_aliases)
        const inc: Record<string, boolean> = {}
        const src: Record<string, string> = {}
        for (const f of data.detected_fields) {
          inc[f.key] = true
          src[f.key] = f.suggested_source
        }
        setIncludedFields(inc)
        setFieldSources(src)
      },
    })
  }

  const handleAddAlias = () => {
    const a = aliasInput.trim().toLowerCase()
    if (a && !aliases.includes(a)) {
      setAliases([...aliases, a])
    }
    setAliasInput('')
  }

  const handleSave = () => {
    if (!vendor || !extracted) return
    const fields: TemplateField[] = extracted.detected_fields
      .filter((f) => includedFields[f.key])
      .map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as TemplateField['type'],
        source: (fieldSources[f.key] || f.suggested_source) as TemplateField['source'],
        required: f.suggested_source === 'operation',
        ocr_confidence: f.confidence,
      }))

    createTemplate.mutate(
      {
        vendor,
        vendor_aliases: aliases,
        category: category || undefined,
        sous_categorie: sousCategorie || undefined,
        source_justificatif: selectedFile || undefined,
        fields,
      },
      {
        onSuccess: () => {
          setExtracted(null)
          setSelectedFile('')
          setVendor('')
          setAliases([])
        },
      },
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
        <ScanLine size={16} className="text-violet-400" />
        Créer un template depuis un justificatif
      </h3>

      {/* Sélection justificatif */}
      <div className="flex gap-3 mb-4">
        <select
          value={selectedFile}
          onChange={(e) => { setSelectedFile(e.target.value); setExtracted(null) }}
          className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
        >
          <option value="">Sélectionner un justificatif existant...</option>
          {justificatifs?.map((j) => (
            <option key={j.filename} value={j.filename}>
              {j.original_name} ({j.date})
            </option>
          ))}
        </select>
        <button
          onClick={handleAnalyse}
          disabled={!selectedFile || extractFields.isPending}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition-colors disabled:opacity-50"
        >
          {extractFields.isPending ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
          Analyser
        </button>
      </div>

      {/* Résultat extraction */}
      {extracted && (
        <div className="space-y-4 border-t border-border pt-4">
          {/* Vendor + category */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Fournisseur</label>
              <input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Catégorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              >
                <option value="">—</option>
                {catData?.categories?.map((g) => (
                  <optgroup key={g.name} label={g.name}>
                    {g.subcategories?.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </optgroup>
                )) ?? catData?.raw?.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Sous-catégorie</label>
              <input
                value={sousCategorie}
                onChange={(e) => setSousCategorie(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                placeholder="optionnel"
              />
            </div>
          </div>

          {/* Aliases */}
          <div>
            <label className="text-[10px] text-text-muted mb-1 block">Alias de matching</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {aliases.map((a) => (
                <span key={a} className="flex items-center gap-1 px-2 py-0.5 bg-violet-500/15 text-violet-400 rounded-full text-[10px]">
                  {a}
                  <button onClick={() => setAliases(aliases.filter((x) => x !== a))}>
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
                placeholder="Ajouter un alias..."
                className="flex-1 bg-background border border-border rounded-md px-2.5 py-1 text-xs text-text focus:outline-none focus:border-primary"
              />
              <button onClick={handleAddAlias} className="px-2 py-1 text-xs text-violet-400 hover:text-violet-300">
                <Plus size={12} />
              </button>
            </div>
          </div>

          {/* Table des champs */}
          <div>
            <label className="text-[10px] text-text-muted mb-1.5 block">Champs détectés</label>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-hover text-text-muted">
                    <th className="text-left px-3 py-2 w-8"></th>
                    <th className="text-left px-3 py-2">Label</th>
                    <th className="text-left px-3 py-2">Valeur</th>
                    <th className="text-left px-3 py-2">Source</th>
                    <th className="text-center px-3 py-2">Confiance</th>
                  </tr>
                </thead>
                <tbody>
                  {extracted.detected_fields.map((f) => (
                    <tr key={f.key} className="border-t border-border/30">
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={includedFields[f.key] || false}
                          onChange={(e) => setIncludedFields({ ...includedFields, [f.key]: e.target.checked })}
                          className="accent-violet-500"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-text">{f.label}</td>
                      <td className="px-3 py-1.5 text-text-muted truncate max-w-[120px]">{f.value}</td>
                      <td className="px-3 py-1.5">
                        <select
                          value={fieldSources[f.key] || f.suggested_source}
                          onChange={(e) => setFieldSources({ ...fieldSources, [f.key]: e.target.value })}
                          className="bg-background border border-border rounded px-1.5 py-0.5 text-[10px] text-text"
                        >
                          <option value="operation">operation</option>
                          <option value="ocr">ocr</option>
                          <option value="manual">manual</option>
                          <option value="computed">computed</option>
                          <option value="fixed">fixed</option>
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <div className="w-8 h-1.5 bg-background rounded-full overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                f.confidence >= 0.8 ? 'bg-emerald-500' :
                                f.confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-400',
                              )}
                              style={{ width: `${Math.round(f.confidence * 100)}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-text-muted">{Math.round(f.confidence * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => { setExtracted(null); setSelectedFile('') }}
              className="px-4 py-2 text-sm border border-border rounded-lg text-text-muted hover:text-text transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!vendor || createTemplate.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition-colors disabled:opacity-50"
            >
              {createTemplate.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              Sauvegarder le template
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ──── Section Bibliothèque ────

function LibrarySection() {
  const { data: templates, isLoading } = useTemplates()
  const deleteTemplate = useDeleteTemplate()

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-text-muted py-6 justify-center">
        <Loader2 size={16} className="animate-spin" />
        Chargement...
      </div>
    )
  }

  if (!templates?.length) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <FileText size={32} className="mx-auto text-text-muted/20 mb-2" />
        <p className="text-sm text-text-muted">Aucun template créé</p>
        <p className="text-xs text-text-muted/60 mt-1">Analysez un justificatif existant pour en créer un</p>
      </div>
    )
  }

  // Couleurs avatar selon la première lettre
  const colors = [
    'bg-violet-500/20 text-violet-400',
    'bg-emerald-500/20 text-emerald-400',
    'bg-amber-500/20 text-amber-400',
    'bg-blue-500/20 text-blue-400',
    'bg-rose-500/20 text-rose-400',
    'bg-cyan-500/20 text-cyan-400',
  ]

  return (
    <div>
      <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
        <Tag size={16} className="text-violet-400" />
        Bibliothèque ({templates.length})
      </h3>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {templates.map((tpl, i) => {
          const initials = tpl.vendor.slice(0, 2).toUpperCase()
          const colorClass = colors[i % colors.length]
          return (
            <div
              key={tpl.id}
              className="bg-surface rounded-xl border border-border p-4 hover:border-violet-500/40 transition-colors group"
            >
              {/* Avatar + vendor */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold', colorClass)}>
                    {initials}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text">{tpl.vendor}</p>
                    {tpl.category && (
                      <p className="text-[10px] text-text-muted">{tpl.category}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteTemplate.mutate(tpl.id)}
                  className="p-1 text-text-muted/30 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {/* Aliases */}
              <div className="flex flex-wrap gap-1 mb-2">
                {tpl.vendor_aliases.slice(0, 3).map((a) => (
                  <span key={a} className="px-1.5 py-0.5 bg-violet-500/10 text-violet-400 rounded text-[9px]">{a}</span>
                ))}
                {tpl.vendor_aliases.length > 3 && (
                  <span className="text-[9px] text-text-muted">+{tpl.vendor_aliases.length - 3}</span>
                )}
              </div>

              {/* Badges */}
              <div className="flex items-center gap-3 text-[10px] text-text-muted">
                <span className="flex items-center gap-0.5">
                  <Hash size={9} />
                  {tpl.fields.length} champs
                </span>
                <span className="flex items-center gap-0.5">
                  <FileText size={9} />
                  {tpl.usage_count} utilisé{tpl.usage_count !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ──── Section Générer ────

function GenerateSection({ preFile, preIndex, preTemplate }: Props) {
  const [operationFile, setOperationFile] = useState(preFile || '')
  const [operationIndex, setOperationIndex] = useState(preIndex ? parseInt(preIndex) : 0)
  const [templateId, setTemplateId] = useState(preTemplate || '')
  const [fieldValues, setFieldValues] = useState<Record<string, string | number>>({})

  const { data: suggestions } = useTemplateSuggestion(
    operationFile || null,
    operationFile ? operationIndex : undefined,
  )
  const { data: templates } = useTemplates()
  const generate = useGenerateReconstitue()

  // Auto-select si suggestion
  const effectiveTemplateId = templateId || (suggestions?.[0]?.template_id ?? '')
  const selectedTemplate = templates?.find((t) => t.id === effectiveTemplateId)

  const handleGenerate = (autoAssociate: boolean) => {
    if (!effectiveTemplateId || !operationFile) return
    generate.mutate({
      template_id: effectiveTemplateId,
      operation_file: operationFile,
      operation_index: operationIndex,
      field_values: fieldValues,
      auto_associate: autoAssociate,
    })
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
        <FileText size={16} className="text-violet-400" />
        Générer un justificatif reconstitué
      </h3>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-[10px] text-text-muted mb-1 block">Fichier opération</label>
          <input
            value={operationFile}
            onChange={(e) => setOperationFile(e.target.value)}
            placeholder="operations_20260320_xxx.json"
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="text-[10px] text-text-muted mb-1 block">Index opération</label>
          <input
            type="number"
            value={operationIndex}
            onChange={(e) => setOperationIndex(parseInt(e.target.value) || 0)}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Template sélection */}
      <div className="mb-4">
        <label className="text-[10px] text-text-muted mb-1 block">Template</label>
        <select
          value={effectiveTemplateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
        >
          <option value="">Sélectionner...</option>
          {suggestions?.map((s) => (
            <option key={s.template_id} value={s.template_id}>
              {s.vendor} — match {Math.round(s.match_score * 100)}%
            </option>
          ))}
          {templates?.filter((t) => !suggestions?.some((s) => s.template_id === t.id)).map((t) => (
            <option key={t.id} value={t.id}>{t.vendor}</option>
          ))}
        </select>
      </div>

      {/* Champs manuels */}
      {selectedTemplate && (
        <div className="space-y-3 mb-4">
          <p className="text-[10px] text-text-muted uppercase tracking-wide">Champs manuels</p>
          <div className="grid grid-cols-2 gap-3">
            {selectedTemplate.fields
              .filter((f) => f.source === 'manual' || f.source === 'fixed')
              .map((f) => (
                <div key={f.key}>
                  <label className="text-[10px] text-text-muted mb-0.5 block">{f.label}</label>
                  {f.type === 'select' && f.options ? (
                    <select
                      value={String(fieldValues[f.key] ?? '')}
                      onChange={(e) => setFieldValues({ ...fieldValues, [f.key]: e.target.value })}
                      className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                    >
                      <option value="">—</option>
                      {f.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type === 'currency' || f.type === 'number' || f.type === 'percent' ? 'number' : 'text'}
                      step={f.type === 'currency' ? '0.01' : undefined}
                      value={fieldValues[f.key] ?? (f.default ?? '')}
                      onChange={(e) => setFieldValues({
                        ...fieldValues,
                        [f.key]: f.type === 'currency' || f.type === 'number' || f.type === 'percent'
                          ? parseFloat(e.target.value) || 0
                          : e.target.value,
                      })}
                      className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                    />
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => handleGenerate(false)}
          disabled={!effectiveTemplateId || !operationFile || generate.isPending}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition-colors disabled:opacity-50"
        >
          {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          Générer PDF
        </button>
        <button
          onClick={() => handleGenerate(true)}
          disabled={!effectiveTemplateId || !operationFile || generate.isPending}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
        >
          <CheckCircle size={14} />
          Générer + associer
        </button>
      </div>

      {/* Résultat */}
      {generate.isSuccess && generate.data && (
        <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm">
          <CheckCircle size={14} />
          {generate.data.filename}
          {generate.data.associated && ' — associé'}
        </div>
      )}
    </div>
  )
}
