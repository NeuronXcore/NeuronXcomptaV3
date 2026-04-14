import { createElement } from 'react'
import toast from 'react-hot-toast'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DeleteJustificatifResult } from '@/hooks/useJustificatifs'

/**
 * Toast de confirmation avant suppression d'un justificatif.
 * Affiche le nom du fichier, le libellé de l'opération liée (si fourni),
 * et deux boutons Supprimer / Annuler.
 */
export function showDeleteConfirmToast(
  filename: string,
  operationLibelle: string | null,
  onConfirm: () => void,
): void {
  const truncated = filename.length > 30 ? filename.slice(0, 27) + '...' : filename
  toast.custom(
    (t) =>
      createElement(
        'div',
        {
          className: cn(
            'flex items-center gap-3 bg-surface border border-border rounded-xl px-4 py-3 shadow-lg max-w-lg',
            t.visible ? 'animate-in fade-in slide-in-from-top-2' : 'animate-out fade-out',
          ),
        },
        createElement(Trash2, { size: 16, className: 'text-red-400 shrink-0' }),
        createElement(
          'div',
          { className: 'flex flex-col gap-0.5 min-w-0' },
          createElement('span', { className: 'text-sm text-text' }, `Supprimer ${truncated} ?`),
          operationLibelle
            ? createElement(
                'span',
                { className: 'text-[11px] text-text-muted truncate' },
                `Lié à : ${operationLibelle}`,
              )
            : null,
        ),
        createElement(
          'button',
          {
            className:
              'px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors shrink-0',
            onClick: () => {
              toast.dismiss(t.id)
              onConfirm()
            },
          },
          'Supprimer',
        ),
        createElement(
          'button',
          {
            className:
              'px-3 py-1 bg-surface-hover hover:bg-border text-text-muted text-xs font-medium rounded-lg transition-colors shrink-0',
            onClick: () => toast.dismiss(t.id),
          },
          'Annuler',
        ),
      ),
    { duration: 8000 },
  )
}

/**
 * Toast de succès détaillé après suppression.
 * Liste les nettoyages effectués.
 */
export function showDeleteSuccessToast(result: DeleteJustificatifResult): void {
  const details: string[] = []
  if (result.ops_unlinked.length > 0) details.push('lien opération nettoyé')
  if (result.thumbnail_deleted) details.push('thumbnail purgée')
  if (result.ged_cleaned) details.push('GED nettoyée')
  if (result.ocr_cache_deleted) details.push('cache OCR purgé')
  const suffix = details.length > 0 ? ` — ${details.join(', ')}` : ''
  toast.success(`${result.deleted} supprimé${suffix}`)
}
