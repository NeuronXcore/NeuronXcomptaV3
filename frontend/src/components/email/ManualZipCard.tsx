import { CheckCheck, Copy, FolderOpen, Loader2, Package, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  useDeleteManualZip,
  useMarkManualSent,
  useOpenManualInFinder,
} from '@/hooks/useEmail'
import type { ManualPrep } from '@/types'

interface ManualZipCardProps {
  zip: ManualPrep
}

export default function ManualZipCard({ zip }: ManualZipCardProps) {
  const openInFinder = useOpenManualInFinder()
  const markSent = useMarkManualSent()
  const deleteZip = useDeleteManualZip()

  const handleFinder = () => {
    openInFinder.mutate(zip.id, {
      onError: (err) => toast.error(err.message),
    })
  }

  const handleRecopy = async () => {
    try {
      await navigator.clipboard.writeText(zip.corps_plain)
    } catch {
      toast.error('Clipboard indisponible')
      return
    }
    const subject = encodeURIComponent(zip.objet)
    const dest = zip.destinataires.join(',')
    window.location.href = `mailto:${dest}?subject=${subject}`
    toast.success('Corps recopié — colle-le dans le brouillon (⌘V)')
  }

  const handleSent = () => {
    markSent.mutate(zip.id, {
      onSuccess: () => toast.success('Marqué comme envoyé'),
      onError: (err) => toast.error(err.message),
    })
  }

  const handleDelete = () => {
    if (!window.confirm(`Supprimer le ZIP "${zip.zip_filename}" ?`)) return
    deleteZip.mutate(zip.id, {
      onSuccess: () => toast.success('ZIP supprimé'),
      onError: (err) => toast.error(err.message),
    })
  }

  const relativeDate = (() => {
    try {
      return formatDistanceToNow(new Date(zip.prepared_at), {
        addSuffix: true,
        locale: fr,
      })
    } catch {
      return zip.prepared_at
    }
  })()

  return (
    <div className="bg-surface rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 mb-1">
        <Package size={14} className="text-primary shrink-0" />
        <p className="text-sm font-medium text-text truncate flex-1" title={zip.zip_filename}>
          {zip.zip_filename}
        </p>
      </div>
      <p className="text-xs text-text-muted mb-3">
        {zip.taille_mo.toFixed(1)} Mo · {zip.documents.length} document
        {zip.documents.length > 1 ? 's' : ''} · préparé {relativeDate}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={handleFinder}
          disabled={openInFinder.isPending}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-surface-hover hover:bg-border text-text transition-colors disabled:opacity-50"
        >
          <FolderOpen size={11} /> Finder
        </button>
        <button
          onClick={handleRecopy}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-surface-hover hover:bg-border text-text transition-colors"
        >
          <Copy size={11} /> Recopier
        </button>
        <button
          onClick={handleSent}
          disabled={markSent.isPending}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors disabled:opacity-50"
        >
          {markSent.isPending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <CheckCheck size={11} />
          )}
          Envoyé
        </button>
        <button
          onClick={handleDelete}
          disabled={deleteZip.isPending}
          className="ml-auto flex items-center gap-1 px-2 py-1 text-[11px] rounded text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
          title="Supprimer ce ZIP"
        >
          {deleteZip.isPending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Trash2 size={11} />
          )}
        </button>
      </div>
    </div>
  )
}
