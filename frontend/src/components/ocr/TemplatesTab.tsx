import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  useTemplates, useExtractFields, useCreateTemplate,
  useDeleteTemplate, useGenerateReconstitue, useTemplateSuggestion,
} from '@/hooks/useTemplates'
import { useCategories } from '@/hooks/useApi'
import { useJustificatifs } from '@/hooks/useJustificatifs'
import { useOperationFiles, useOperations } from '@/hooks/useOperations'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { cn, formatCurrency, formatFileTitle, MOIS_FR } from '@/lib/utils'
import {
  Search, Plus, Trash2, FileText, Loader2, X, ScanLine,
  CheckCircle, Tag, Hash, Calendar, DollarSign, Crosshair, Eye, Image,
  Pencil, Layers,
} from 'lucide-react'
import type { TemplateField, ExtractedFields, JustificatifTemplate } from '@/types'
import TemplateEditDrawer from '@/components/templates/TemplateEditDrawer'
import BatchGenerateDrawer from '@/components/templates/BatchGenerateDrawer'

interface Props {
  preFile?: string | null
  preIndex?: string | null
  preTemplate?: string | null
  preCreateFile?: string | null
}

export default function TemplatesTab({ preFile, preIndex, preTemplate, preCreateFile }: Props) {
  return (
    <div className="space-y-8">
      <CreateSection preCreateFile={preCreateFile} />
      <LibrarySection />
      <GenerateSection preFile={preFile} preIndex={preIndex} preTemplate={preTemplate} />
    </div>
  )
}


// ──── Section Créer ────

function CreateSection({ preCreateFile }: { preCreateFile?: string | null }) {
  const [selectedFile, setSelectedFile] = useState('')
  const [extracted, setExtracted] = useState<ExtractedFields | null>(null)
  const [vendor, setVendor] = useState('')
  const [aliases, setAliases] = useState<string[]>([])
  const [aliasInput, setAliasInput] = useState('')
  const [category, setCategory] = useState('')
  const [sousCategorie, setSousCategorie] = useState('')
  const [includedFields, setIncludedFields] = useState<Record<string, boolean>>({})
  const [fieldSources, setFieldSources] = useState<Record<string, string>>({})
  const preCreateHandled = useRef('')

  const [createSearch, setCreateSearch] = useState('')
  const [createMonth, setCreateMonth] = useState<string>('')  // format "YYYY-MM"
  const [previewOpen, setPreviewOpen] = useState(false)

  const { data: justificatifs } = useJustificatifs({
    status: 'en_attente', search: '', sort_by: 'date', sort_order: 'desc',
  })

  // Mois disponibles (année-mois) extraits des dates OCR des justificatifs
  const availableMonths = useMemo(() => {
    if (!justificatifs?.length) return []
    const set = new Set<string>()
    justificatifs.forEach(j => {
      const d = j.ocr_date || j.date
      if (d && d.length >= 7) set.add(d.slice(0, 7))  // "YYYY-MM"
    })
    return [...set].sort().reverse()  // plus récent en premier
  }, [justificatifs])

  // Filtrer les justificatifs pour le sélecteur
  const filteredJustificatifs = useMemo(() => {
    if (!justificatifs?.length) return []
    let items = justificatifs
    if (createMonth) {
      items = items.filter(j => (j.ocr_date || j.date).startsWith(createMonth))
    }
    if (createSearch) {
      const q = createSearch.toLowerCase()
      items = items.filter(j =>
        j.filename.toLowerCase().includes(q) ||
        j.original_name.toLowerCase().includes(q) ||
        (j.ocr_supplier || '').toLowerCase().includes(q)
      )
    }
    return items
  }, [justificatifs, createMonth, createSearch])
  const { data: catData } = useCategories()
  const extractFields = useExtractFields()
  const createTemplate = useCreateTemplate()

  // Auto-extraction quand preCreateFile est fourni
  useEffect(() => {
    if (preCreateFile && preCreateFile !== preCreateHandled.current) {
      preCreateHandled.current = preCreateFile
      setSelectedFile(preCreateFile)
      setExtracted(null)
      extractFields.mutate(preCreateFile, {
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
  }, [preCreateFile])

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

      {/* Filtres justificatifs */}
      <div className="flex items-center gap-2.5 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-[240px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={createSearch}
            onChange={(e) => setCreateSearch(e.target.value)}
            placeholder="Rechercher fournisseur, fichier..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg text-text placeholder:text-text-muted/50 focus:outline-none focus:border-violet-500/50"
          />
          {createSearch && (
            <button
              onClick={() => setCreateSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <select
          value={createMonth}
          onChange={(e) => setCreateMonth(e.target.value)}
          className="text-xs bg-background border border-border rounded-lg px-2.5 py-1.5 text-text focus:outline-none focus:border-violet-500/50"
        >
          <option value="">Tous les mois</option>
          {availableMonths.map(ym => {
            const [y, m] = ym.split('-')
            return (
              <option key={ym} value={ym}>{MOIS_FR[parseInt(m, 10) - 1]} {y}</option>
            )
          })}
        </select>

        <span className="text-[11px] text-text-muted">
          {filteredJustificatifs.length} justificatif{filteredJustificatifs.length !== 1 ? 's' : ''}
        </span>

        {(createSearch || createMonth) && (
          <button
            onClick={() => { setCreateSearch(''); setCreateMonth('') }}
            className="text-[11px] text-text-muted hover:text-text flex items-center gap-0.5 transition-colors"
          >
            <X size={10} />
            Reset
          </button>
        )}
      </div>

      {/* Sélection justificatif */}
      <div className="flex gap-3 mb-4">
        <select
          value={selectedFile}
          onChange={(e) => { setSelectedFile(e.target.value); setExtracted(null); if (e.target.value) setPreviewOpen(true) }}
          className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
        >
          <option value="">Sélectionner un justificatif ({filteredJustificatifs.length})...</option>
          {filteredJustificatifs.map((j) => (
            <option key={j.filename} value={j.filename}>
              {j.filename} ({j.ocr_date || j.date})
            </option>
          ))}
        </select>
        <button
          onClick={() => setPreviewOpen(true)}
          disabled={!selectedFile}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border text-text-muted rounded-lg hover:text-text hover:border-violet-500/40 transition-colors disabled:opacity-30"
          title="Aperçu PDF"
        >
          <Eye size={14} />
        </button>
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
                onChange={(e) => { setCategory(e.target.value); setSousCategorie('') }}
                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              >
                <option value="">—</option>
                {catData?.categories?.map((g) => (
                  <option key={g.name} value={g.name}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Sous-catégorie</label>
              <select
                value={sousCategorie}
                onChange={(e) => setSousCategorie(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              >
                <option value="">—</option>
                {catData?.categories
                  ?.find((g) => g.name === category)
                  ?.subcategories?.map((s) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
              </select>
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
                    <th className="text-center px-3 py-2 w-10" title="Position détectée dans le PDF">Pos.</th>
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
                      <td className="px-3 py-1.5 text-center">
                        {f.coordinates ? (
                          <Crosshair size={12} className="text-emerald-400 mx-auto" title={`Page ${(f.coordinates.page || 0) + 1} — x:${Math.round(f.coordinates.x)} y:${Math.round(f.coordinates.y)}`} />
                        ) : (
                          <span className="text-text-muted/30">—</span>
                        )}
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

      {/* Drawer aperçu PDF */}
      {previewOpen && selectedFile && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 transition-opacity"
            onClick={() => setPreviewOpen(false)}
          />
          <div className="fixed top-0 right-0 h-full w-[550px] max-w-[90vw] bg-background border-l border-border z-50 flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                  <Eye size={16} className="text-violet-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text truncate">{selectedFile}</p>
                  <p className="text-[11px] text-text-muted">Aperçu du justificatif candidat</p>
                </div>
              </div>
              <button
                onClick={() => setPreviewOpen(false)}
                className="p-1 text-text-muted hover:text-text transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden bg-white">
              <iframe
                src={`/api/justificatifs/${encodeURIComponent(selectedFile)}/preview`}
                className="w-full h-full"
                title="Aperçu justificatif"
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}


// ──── Section Bibliothèque ────

function LibrarySection() {
  const { data: templates, isLoading } = useTemplates()
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null)
  const [batchTemplateId, setBatchTemplateId] = useState<string | null>(null)
  const [batchVendor, setBatchVendor] = useState('')
  const [searchText, setSearchText] = useState('')
  const [filterCategory, setFilterCategory] = useState('')

  // Catégories uniques pour le dropdown
  const categories = useMemo(() => {
    if (!templates?.length) return []
    const set = new Set<string>()
    templates.forEach(t => { if (t.category) set.add(t.category) })
    return [...set].sort()
  }, [templates])

  // Filtrage client-side
  const filtered = useMemo(() => {
    if (!templates?.length) return []
    let items = templates
    if (searchText) {
      const q = searchText.toLowerCase()
      items = items.filter(t =>
        t.vendor.toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.sous_categorie || '').toLowerCase().includes(q)
      )
    }
    if (filterCategory) {
      items = items.filter(t => t.category === filterCategory)
    }
    return items
  }, [templates, searchText, filterCategory])

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
      <h3 className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
        <Tag size={16} className="text-violet-400" />
        Bibliothèque ({filtered.length}{filtered.length !== templates.length ? ` / ${templates.length}` : ''})
      </h3>

      {/* Barre de filtres */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Rechercher fournisseur, catégorie..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text placeholder:text-text-muted/50 focus:outline-none focus:border-violet-500/50"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1.5 text-text focus:outline-none focus:border-violet-500/50"
        >
          <option value="">Toutes catégories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        {(searchText || filterCategory) && (
          <button
            onClick={() => { setSearchText(''); setFilterCategory('') }}
            className="text-[11px] text-text-muted hover:text-text flex items-center gap-1 transition-colors"
          >
            <X size={11} />
            Réinitialiser
          </button>
        )}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {filtered.map((tpl, i) => {
          const initials = tpl.vendor.slice(0, 2).toUpperCase()
          const colorClass = colors[i % colors.length]
          const hasSource = !!tpl.source_justificatif
          const hasCoords = tpl.fields.some((f) => f.coordinates)
          return (
            <div
              key={tpl.id}
              className="bg-surface rounded-xl border border-border overflow-hidden hover:border-violet-500/40 transition-colors group cursor-pointer"
              onClick={() => setEditTemplateId(tpl.id)}
            >
              {/* Thumbnail du PDF source — endpoint qui résout auto en_attente/traites */}
              {hasSource ? (
                <div className="h-32 bg-white overflow-hidden border-b border-border flex items-center justify-center">
                  <img
                    src={`/api/justificatifs/${encodeURIComponent(tpl.source_justificatif!)}/thumbnail`}
                    alt={tpl.vendor}
                    className="h-full w-auto object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                </div>
              ) : (
                <div className="h-32 bg-surface-hover flex items-center justify-center border-b border-border">
                  <Image size={28} className="text-text-muted/20" />
                </div>
              )}

              <div className="p-3">
                {/* Vendor + actions */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold', colorClass)}>
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
                    onClick={(e) => { e.stopPropagation(); setEditTemplateId(tpl.id) }}
                    className="p-1 text-text-muted/30 hover:text-text transition-colors opacity-0 group-hover:opacity-100"
                    title="Modifier"
                  >
                    <Pencil size={11} />
                  </button>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 text-[10px] text-text-muted mb-2">
                  <span className="flex items-center gap-0.5">
                    <Hash size={9} />
                    {tpl.fields.length} champs
                  </span>
                  <span className="flex items-center gap-0.5">
                    <FileText size={9} />
                    {tpl.usage_count}x
                  </span>
                  {hasCoords && (
                    <span className="flex items-center gap-0.5 text-emerald-400" title="Fac-similé disponible">
                      <Crosshair size={9} />
                      fac-similé
                    </span>
                  )}
                </div>

                {/* Bouton Batch */}
                <button
                  onClick={(e) => { e.stopPropagation(); setBatchTemplateId(tpl.id); setBatchVendor(tpl.vendor) }}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-lg border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors"
                >
                  <Layers size={12} />
                  Batch fac-similé
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Drawers */}
      {editTemplateId && (
        <TemplateEditDrawer
          templateId={editTemplateId}
          onClose={() => setEditTemplateId(null)}
        />
      )}
      {batchTemplateId && (
        <BatchGenerateDrawer
          templateId={batchTemplateId}
          vendor={batchVendor}
          onClose={() => { setBatchTemplateId(null); setBatchVendor('') }}
        />
      )}
    </div>
  )
}


// ──── Section Générer ────

function GenerateSection({ preFile, preIndex, preTemplate }: Props) {
  const { selectedYear } = useFiscalYearStore()
  const [operationFile, setOperationFile] = useState(preFile || '')
  const [operationIndex, setOperationIndex] = useState(preIndex ? parseInt(preIndex) : 0)
  const [templateId, setTemplateId] = useState(preTemplate || '')
  const [fieldValues, setFieldValues] = useState<Record<string, string | number>>({})

  const { data: opFiles } = useOperationFiles()
  const { data: operations } = useOperations(operationFile || null)

  // Filtrer les fichiers par année comptable
  const filesForYear = opFiles?.filter((f: any) => f.year === selectedYear)
    ?.sort((a: any, b: any) => (a.month ?? 0) - (b.month ?? 0)) || []

  // Filtrer les opérations sans justificatif
  const opsWithoutJustif = operations?.map((op: any, idx: number) => ({ ...op, _idx: idx }))
    .filter((op: any) => !op['Lien justificatif']) || []

  const { data: suggestions } = useTemplateSuggestion(
    operationFile || null,
    operationFile ? operationIndex : undefined,
  )
  const { data: templates } = useTemplates()
  const generate = useGenerateReconstitue()

  // Auto-select si suggestion
  const effectiveTemplateId = templateId || (suggestions?.[0]?.template_id ?? '')
  const selectedTemplate = templates?.find((t) => t.id === effectiveTemplateId)

  // Exclure les champs TVA (non assujetti)
  const TVA_KEYS = new Set(['tva_rate', 'tva', 'montant_ht'])

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
          <label className="text-[10px] text-text-muted mb-1 block">Mois ({selectedYear})</label>
          <select
            value={operationFile}
            onChange={(e) => { setOperationFile(e.target.value); setOperationIndex(0) }}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
          >
            <option value="">Sélectionner un mois...</option>
            {filesForYear.map((f: any) => (
              <option key={f.filename} value={f.filename}>
                {f.month ? MOIS_FR[f.month - 1] : formatFileTitle(f)} ({f.count} ops)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-text-muted mb-1 block">
            Opération sans justificatif
            {opsWithoutJustif.length > 0 && <span className="ml-1 text-warning">({opsWithoutJustif.length})</span>}
          </label>
          <select
            value={operationIndex}
            onChange={(e) => setOperationIndex(parseInt(e.target.value) || 0)}
            disabled={!operationFile || !opsWithoutJustif.length}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-primary disabled:opacity-50"
          >
            <option value="">Sélectionner une opération...</option>
            {opsWithoutJustif.map((op: any) => {
              const montant = op['Débit'] || op['Crédit'] || 0
              const sign = op['Débit'] ? '-' : '+'
              return (
                <option key={op._idx} value={op._idx}>
                  {op.Date} — {(op['Libellé'] || '').slice(0, 35)} — {sign}{formatCurrency(montant)}
                </option>
              )
            })}
          </select>
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

      {/* Champs manuels (hors TVA) */}
      {selectedTemplate && (
        <div className="space-y-3 mb-4">
          {selectedTemplate.fields
            .filter((f) => (f.source === 'manual' || f.source === 'fixed') && !TVA_KEYS.has(f.key))
            .length > 0 && (
            <>
              <p className="text-[10px] text-text-muted uppercase tracking-wide">Champs manuels</p>
              <div className="grid grid-cols-2 gap-3">
                {selectedTemplate.fields
                  .filter((f) => (f.source === 'manual' || f.source === 'fixed') && !TVA_KEYS.has(f.key))
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
            </>
          )}
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
