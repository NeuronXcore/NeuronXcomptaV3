import { FolderDown, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { usePrepareManual, useOpenManualInFinder } from '@/hooks/useEmail'
import type { DocumentRef } from '@/types'

interface ManualSendButtonProps {
  documents: DocumentRef[]
  destinataires: string[]
  objet: string
  corps: string
  disabled?: boolean
}

export default function ManualSendButton({
  documents,
  destinataires,
  objet,
  corps,
  disabled,
}: ManualSendButtonProps) {
  const prepareManual = usePrepareManual()
  const openInFinder = useOpenManualInFinder()

  const handleClick = async () => {
    if (documents.length === 0) {
      toast.error('Sélectionne au moins un document')
      return
    }
    if (destinataires.length === 0) {
      toast.error('Renseigne au moins un destinataire')
      return
    }
    try {
      const result = await prepareManual.mutateAsync({
        documents,
        destinataires,
        objet: objet || undefined,
        corps: corps || undefined,
      })

      try {
        await navigator.clipboard.writeText(result.corps_plain)
      } catch {
        // Permission clipboard refusée — on continue, l'utilisateur pourra Recopier
      }

      try {
        await openInFinder.mutateAsync(result.id)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Finder indisponible')
      }

      const subject = encodeURIComponent(result.objet)
      const dest = result.destinataires.join(',')
      window.location.href = `mailto:${dest}?subject=${subject}`

      toast.success(
        (
          <div>
            <div>✓ ZIP ouvert dans Finder</div>
            <div>✓ Corps du mail copié</div>
            <div className="text-xs opacity-80 mt-1">
              Colle-le dans le brouillon (⌘V)
            </div>
          </div>
        ),
        { duration: 6000 },
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur préparation manuelle')
    }
  }

  const pending = prepareManual.isPending
  return (
    <button
      onClick={handleClick}
      disabled={disabled || pending}
      className={cn(
        'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-colors',
        'bg-surface-hover text-text hover:bg-border disabled:opacity-50 disabled:cursor-not-allowed',
      )}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : <FolderDown size={14} />}
      <span>Préparer envoi manuel (ZIP + mail pré-rempli)</span>
    </button>
  )
}
