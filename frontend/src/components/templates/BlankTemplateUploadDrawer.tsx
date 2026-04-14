import { useCallback, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { FileText, Plus, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCategories } from '@/hooks/useApi'
import { useCreateTemplateFromBlank } from '@/hooks/useTemplates'
import type { JustificatifTemplate } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (template: JustificatifTemplate) => void
}

export default function BlankTemplateUploadDrawer({ open, onClose, onCreated }: Props) {
  const { data: catData } = useCategories()
  const createFromBlank = useCreateTemplateFromBlank()

  const [file, setFile] = useState<File | null>(null)
  const [vendor, setVendor] = useState('')
  const [aliases, setAliases] = useState<string[]>([])
  const [aliasInput, setAliasInput] = useState('')
  const [category, setCategory] = useState('')
  const [sousCategorie, setSousCategorie] = useState('')

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

  const onDrop = useCallback((accepted: File[]) => {
    const pdf = accepted.find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (pdf) setFile(pdf)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
  })

  const addAlias = () => {
    const v = aliasInput.trim().toLowerCase()
    if (v && !aliases.includes(v)) {
      setAliases([...aliases, v])
    }
    setAliasInput('')
  }

  const removeAlias = (a: string) => setAliases(aliases.filter((x) => x !== a))

  const reset = () => {
    setFile(null)
    setVendor('')
    setAliases([])
    setAliasInput('')
    setCategory('')
    setSousCategorie('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const canSubmit = !!file && vendor.trim().length > 0 && !createFromBlank.isPending

  const handleSubmit = () => {
    if (!canSubmit || !file) return
    createFromBlank.mutate(
      {
        file,
        vendor: vendor.trim(),
        vendor_aliases: aliases,
        category: category || undefined,
        sous_categorie: sousCategorie || undefined,
      },
      {
        onSuccess: (tpl) => {
          onCreated(tpl)
          reset()
          onClose()
        },
      },
    )
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40" onClick={handleClose} />}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[420px] max-w-[95vw] bg-background border-l border-border z-50 flex flex-col transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-lg font-semibold text-text">Nouveau template vierge</p>
            <p className="text-xs text-text-muted mt-0.5">
              Depuis un PDF de fond (sans OCR)
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Dropzone */}
          <div>
            <p className="text-xs font-medium text-text-muted mb-2">PDF de fond</p>
            <div
              {...getRootProps()}
              className={cn(
                'border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors',
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-surface/50',
              )}
            >
              <input {...getInputProps()} />
              {file ? (
                <div className="flex items-center justify-center gap-2 text-sm text-text">
                  <FileText size={18} className="text-primary" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-text-muted">({Math.round(file.size / 1024)} Ko)</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-text-muted">
                  <Upload size={22} />
                  <p className="text-sm">
                    {isDragActive ? 'Déposer le PDF ici...' : 'Glisser un PDF ou cliquer pour parcourir'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Vendor */}
          <div>
            <label className="text-xs font-medium text-text-muted mb-1 block">
              Nom du fournisseur <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Ex: Clinique ELSAN"
              className="w-full px-3 py-1.5 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary text-text"
            />
          </div>

          {/* Aliases */}
          <div>
            <label className="text-xs font-medium text-text-muted mb-1 block">
              Alias de matching (optionnel)
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {aliases.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded text-xs"
                >
                  {a}
                  <button onClick={() => removeAlias(a)} className="hover:text-red-400">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAlias())}
                placeholder="Ajouter un alias..."
                className="flex-1 px-2 py-1 text-xs bg-surface border border-border rounded focus:outline-none focus:border-primary text-text"
              />
              <button
                onClick={addAlias}
                className="p-1 text-text-muted hover:text-primary"
                title="Ajouter"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Catégorie / Sous-catégorie */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-muted mb-1 block">Catégorie</label>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value)
                  setSousCategorie('')
                }}
                className="w-full px-2 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-primary text-text"
              >
                <option value="">-- Aucune --</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-muted mb-1 block">Sous-catégorie</label>
              <select
                value={sousCategorie}
                onChange={(e) => setSousCategorie(e.target.value)}
                disabled={!category}
                className="w-full px-2 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-primary text-text disabled:opacity-50"
              >
                <option value="">-- Aucune --</option>
                {(subcategoriesMap[category] || []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Info */}
          <div className="text-[11px] text-text-muted bg-surface/40 border border-border rounded-lg p-3 leading-relaxed">
            Après création, l'éditeur s'ouvre pour positionner les champs
            <span className="text-text"> Date</span> et
            <span className="text-text"> Montant TTC</span> sur l'aperçu du PDF.
            {category && (
              <>
                {' '}La catégorie
                <span className="text-text font-medium"> {category}</span>
                {sousCategorie && <> / <span className="text-text font-medium">{sousCategorie}</span></>}
                {' '}sera propagée dans chaque fac-similé généré pour booster le rapprochement automatique.
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between">
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-xs text-text-muted hover:text-text border border-border rounded-lg transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              'px-4 py-1.5 text-xs font-medium rounded-lg transition-colors',
              canSubmit
                ? 'bg-orange-500 text-white hover:bg-orange-600'
                : 'bg-surface text-text-muted cursor-not-allowed',
            )}
          >
            {createFromBlank.isPending ? 'Création...' : 'Créer le template'}
          </button>
        </div>
      </div>
    </>
  )
}
