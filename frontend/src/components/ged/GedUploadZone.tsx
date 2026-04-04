import { useState, useMemo } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, X, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGedUpload, useGedPostes, useGedTypes } from '@/hooks/useGed'
import { useCategories } from '@/hooks/useApi'

interface GedUploadZoneProps {
  open: boolean
  onClose: () => void
}

export default function GedUploadZone({ open, onClose }: GedUploadZoneProps) {
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState('divers')
  const [poste, setPoste] = useState('')
  const [categorie, setCategorie] = useState('')
  const [sousCategorie, setSousCategorie] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [notes, setNotes] = useState('')

  const { data: postesConfig } = useGedPostes()
  const { data: types = [] } = useGedTypes()
  const { data: categoriesData } = useCategories()
  const uploadMutation = useGedUpload()

  const categories = categoriesData?.categories ?? []
  const subcategories = useMemo(() => {
    if (!categorie) return []
    const cat = categories.find(c => c.name === categorie)
    return cat?.subcategories?.map(s => s.name) ?? []
  }, [categorie, categories])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: files => { if (files[0]) setFile(files[0]) },
    accept: { 'application/pdf': ['.pdf'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] },
    maxFiles: 1,
  })

  const handleUpload = () => {
    if (!file) return
    uploadMutation.mutate(
      {
        file,
        metadata: {
          type: docType,
          year,
          month,
          poste_comptable: poste || null,
          categorie: categorie || null,
          sous_categorie: sousCategorie || null,
          tags,
          notes,
        },
      },
      {
        onSuccess: () => {
          setFile(null)
          setTags([])
          setNotes('')
          setCategorie('')
          setSousCategorie('')
          onClose()
        },
      }
    )
  }

  const addTag = () => {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-w-[95vw] max-h-[90vh] overflow-y-auto bg-background border border-border rounded-xl shadow-2xl z-50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text">Upload document</h2>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors mb-4',
            isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
          )}
        >
          <input {...getInputProps()} />
          {file ? (
            <div className="flex items-center gap-3 justify-center">
              <FileText size={20} className="text-primary" />
              <span className="text-sm text-text">{file.name}</span>
              <button
                onClick={e => { e.stopPropagation(); setFile(null) }}
                className="text-text-muted hover:text-red-400"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div>
              <Upload size={24} className="mx-auto text-text-muted mb-2" />
              <p className="text-sm text-text-muted">Glissez un fichier ici ou cliquez</p>
              <p className="text-xs text-text-muted mt-1">PDF, JPG, PNG</p>
            </div>
          )}
        </div>

        {/* Form */}
        <div className="space-y-3">
          {/* Type + Poste */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Type de document</label>
              <input
                type="text"
                list="ged-type-suggestions"
                value={docType}
                onChange={e => setDocType(e.target.value)}
                placeholder="Ex: courrier CARMF, devis..."
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
              />
              <datalist id="ged-type-suggestions">
                {types.map(t => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Poste comptable</label>
              <select
                value={poste}
                onChange={e => setPoste(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              >
                <option value="">Aucun</option>
                {(postesConfig?.postes ?? []).map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Catégorie + Sous-catégorie */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Catégorie</label>
              <select
                value={categorie}
                onChange={e => { setCategorie(e.target.value); setSousCategorie('') }}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              >
                <option value="">Aucune</option>
                {categories.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Sous-catégorie</label>
              <select
                value={sousCategorie}
                onChange={e => setSousCategorie(e.target.value)}
                disabled={!categorie || subcategories.length === 0}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary disabled:opacity-50"
              >
                <option value="">Aucune</option>
                {subcategories.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Année + Mois */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Année</label>
              <input
                type="number"
                value={year}
                onChange={e => setYear(parseInt(e.target.value))}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-1">Mois</label>
              <select
                value={month}
                onChange={e => setMonth(parseInt(e.target.value))}
                className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2024, i).toLocaleDateString('fr-FR', { month: 'long' })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Tags</label>
            <div className="flex gap-1.5 flex-wrap mb-1.5">
              {tags.map(t => (
                <span key={t} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
                  {t}
                  <button onClick={() => setTags(prev => prev.filter(x => x !== t))}><X size={10} /></button>
                </span>
              ))}
            </div>
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              placeholder="Ajouter un tag + Entrée"
              className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary resize-none"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-text">
            Annuler
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || uploadMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {uploadMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Uploader
          </button>
        </div>
      </div>
    </>
  )
}
