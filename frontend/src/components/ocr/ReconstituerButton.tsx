import { useState } from 'react'
import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTemplateSuggestion } from '@/hooks/useTemplates'
import ReconstituerDrawer from './ReconstituerDrawer'

interface ReconstituerButtonProps {
  operationFile: string
  operationIndex: number
  libelle: string
  className?: string
  size?: 'sm' | 'md'
  onGenerated?: () => void
}

export default function ReconstituerButton({
  operationFile, operationIndex, libelle,
  className, size = 'sm', onGenerated,
}: ReconstituerButtonProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { data: suggestions } = useTemplateSuggestion(operationFile, operationIndex)

  const hasSuggestion = suggestions && suggestions.length > 0
  const topSuggestion = hasSuggestion ? suggestions[0] : null

  if (!hasSuggestion) {
    return (
      <button
        disabled
        title="Aucun template fournisseur"
        className={cn(
          'flex items-center gap-1 text-text-muted/40 cursor-not-allowed',
          size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1.5',
          className,
        )}
      >
        <FileText size={size === 'sm' ? 11 : 14} />
        {size === 'md' && 'Reconstituer'}
      </button>
    )
  }

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        title={`Reconstituer via template ${topSuggestion!.vendor}`}
        className={cn(
          'flex items-center gap-1 bg-violet-600/15 text-violet-400 rounded transition-colors hover:bg-violet-600/25',
          size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1.5',
          className,
        )}
      >
        <FileText size={size === 'sm' ? 11 : 14} />
        {size === 'md' && 'Reconstituer'}
        {topSuggestion && (
          <span className={cn(
            'bg-emerald-500/20 text-emerald-400 rounded-full px-1.5',
            size === 'sm' ? 'text-[8px]' : 'text-[10px]',
          )}>
            {topSuggestion.vendor}
          </span>
        )}
      </button>

      <ReconstituerDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        operationFile={operationFile}
        operationIndex={operationIndex}
        libelle={libelle}
        suggestedTemplateId={topSuggestion?.template_id}
        onGenerated={onGenerated}
      />
    </>
  )
}
