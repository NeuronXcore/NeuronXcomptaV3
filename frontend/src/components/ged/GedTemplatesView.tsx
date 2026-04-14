import { useMemo } from 'react'
import { FileText, Hash, Layers, Pencil, Wand2, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GedTemplateItem } from '@/types'

interface Props {
  templates: GedTemplateItem[]
  filter: 'all' | 'blank' | 'scanned'
  selectedCategory: string | null
  onOpenDetail: (templateId: string) => void
  onEdit: (templateId: string) => void
  onBatchGenerate: (templateId: string, vendor: string) => void
  isLoading?: boolean
}

export default function GedTemplatesView({
  templates,
  filter,
  selectedCategory,
  onOpenDetail,
  onEdit,
  onBatchGenerate,
  isLoading,
}: Props) {
  const filtered = useMemo(() => {
    let items = templates
    if (filter === 'blank') items = items.filter(t => t.is_blank_template)
    else if (filter === 'scanned') items = items.filter(t => !t.is_blank_template)
    if (selectedCategory) items = items.filter(t => t.category === selectedCategory)
    return items
  }, [templates, filter, selectedCategory])

  if (isLoading) {
    return (
      <div className="text-center py-16 text-text-muted">
        <p className="text-sm">Chargement des templates...</p>
      </div>
    )
  }

  if (!filtered.length) {
    return (
      <div className="text-center py-16 text-text-muted">
        <Layers size={40} className="mx-auto text-text-muted/20 mb-3" />
        <p className="text-lg">Aucun template</p>
        <p className="text-sm mt-1">
          {templates.length === 0
            ? 'Créez-en depuis l\'onglet OCR > Templates'
            : 'Aucun template ne correspond aux filtres courants'}
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {filtered.map(tpl => (
        <TemplateCard
          key={tpl.id}
          tpl={tpl}
          onOpenDetail={() => onOpenDetail(tpl.id)}
          onEdit={() => onEdit(tpl.id)}
          onBatchGenerate={() => onBatchGenerate(tpl.id, tpl.vendor)}
        />
      ))}
    </div>
  )
}

function TemplateCard({
  tpl,
  onOpenDetail,
  onEdit,
  onBatchGenerate,
}: {
  tpl: GedTemplateItem
  onOpenDetail: () => void
  onEdit: () => void
  onBatchGenerate: () => void
}) {
  const initials = tpl.vendor.slice(0, 2).toUpperCase()
  const hasCategory = !!tpl.category
  return (
    <div
      className="bg-surface rounded-xl border border-border overflow-hidden hover:border-primary/40 transition-colors group cursor-pointer relative flex flex-col"
      onClick={onOpenDetail}
    >
      {/* Badge VIERGE overlay */}
      {tpl.is_blank_template && (
        <span className="absolute top-2 right-2 z-10 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 tracking-wide">
          VIERGE
        </span>
      )}

      {/* Thumbnail */}
      {tpl.thumbnail_url ? (
        <div className="h-32 bg-white overflow-hidden border-b border-border flex items-center justify-center">
          <img
            src={tpl.thumbnail_url}
            alt={tpl.vendor}
            className="h-full w-auto object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>
      ) : (
        <div className="h-32 bg-surface-hover flex items-center justify-center border-b border-border">
          <ImageIcon size={28} className="text-text-muted/20" />
        </div>
      )}

      <div className="p-3 flex-1 flex flex-col">
        <div className="flex items-start gap-2 mb-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold bg-primary/15 text-primary shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-text truncate">{tpl.vendor}</p>
            {hasCategory && (
              <p className="text-[10px] text-text-muted truncate">
                {tpl.category}
                {tpl.sous_categorie && <span className="text-text-muted/60"> · {tpl.sous_categorie}</span>}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-[10px] text-text-muted mb-3">
          <span className="flex items-center gap-0.5">
            <Hash size={9} />
            {tpl.fields_count} champs
          </span>
          <span className="flex items-center gap-0.5">
            <FileText size={9} />
            {tpl.facsimiles_generated} générés
          </span>
        </div>

        <div className="flex items-center gap-1.5 mt-auto">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border border-border text-text hover:border-primary/40 hover:bg-primary/5 transition-colors"
            title="Éditer le template"
          >
            <Pencil size={11} />
            Éditer
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onBatchGenerate() }}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-colors',
              'border-orange-500/30 text-orange-400 hover:bg-orange-500/10',
            )}
            title="Générer en batch depuis ce template"
          >
            <Wand2 size={11} />
            Générer
          </button>
        </div>
      </div>
    </div>
  )
}
