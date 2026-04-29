import { createElement } from 'react'
import toast from 'react-hot-toast'
import { Trash2, AlertTriangle, Landmark } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Toast de confirmation avant suppression d'une immobilisation.
 * Affiche la désignation, les conséquences (cascade ops + OD dotation),
 * et deux boutons Supprimer (rouge) / Annuler.
 *
 * Plus riche que showDeleteConfirmToast (justificatifs) car la cascade
 * touche le registre, les ops liées, et potentiellement la dotation.
 */
export function showDeleteImmoConfirmToast(
  designation: string,
  onConfirm: () => void,
): void {
  const truncated = designation.length > 56 ? designation.slice(0, 53) + '…' : designation

  toast.custom(
    (t) =>
      createElement(
        'div',
        {
          className: cn(
            'bg-surface border border-border rounded-xl shadow-2xl w-[440px] max-w-[92vw] overflow-hidden',
            t.visible ? 'animate-in fade-in zoom-in-95 duration-200' : 'animate-out fade-out zoom-out-95',
          ),
        },
        // Header avec icône rouge ronde + titre
        createElement(
          'div',
          { className: 'flex items-start gap-3 px-5 pt-5 pb-3' },
          createElement(
            'div',
            {
              className:
                'shrink-0 w-10 h-10 rounded-full bg-danger/15 border border-danger/30 flex items-center justify-center',
            },
            createElement(Trash2, { size: 18, className: 'text-danger' }),
          ),
          createElement(
            'div',
            { className: 'flex-1 min-w-0' },
            createElement(
              'div',
              { className: 'text-[15px] font-semibold text-text leading-tight' },
              "Supprimer l'immobilisation ?",
            ),
            createElement(
              'div',
              { className: 'mt-1 flex items-center gap-1.5 text-xs text-text-muted truncate' },
              createElement(Landmark, { size: 11, className: 'shrink-0 opacity-70' }),
              createElement('span', { className: 'truncate' }, truncated),
            ),
          ),
        ),
        // Bullets explicatives
        createElement(
          'ul',
          {
            className:
              'mx-5 mb-3 space-y-1.5 text-[12px] text-text-muted bg-surface-hover/50 rounded-lg px-3 py-2.5 border border-border/50',
          },
          createElement(
            'li',
            { className: 'flex gap-2' },
            createElement('span', { className: 'text-primary shrink-0' }, '•'),
            createElement('span', null, 'Retire l’immobilisation du registre'),
          ),
          createElement(
            'li',
            { className: 'flex gap-2' },
            createElement('span', { className: 'text-primary shrink-0' }, '•'),
            createElement(
              'span',
              null,
              'Délie l’opération bancaire associée',
              createElement(
                'span',
                { className: 'text-text-muted/70' },
                ' (catégorie remise à vide si forcée en « Immobilisations »)',
              ),
            ),
          ),
          createElement(
            'li',
            { className: 'flex gap-2' },
            createElement('span', { className: 'text-primary shrink-0' }, '•'),
            createElement(
              'span',
              null,
              'Si une OD dotation existe pour les années couvertes, son montant deviendra obsolète ',
              createElement(
                'span',
                { className: 'text-warning' },
                '— à régénérer.',
              ),
            ),
          ),
        ),
        // Warning irréversible
        createElement(
          'div',
          {
            className:
              'mx-5 mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-danger/10 border border-danger/20',
          },
          createElement(AlertTriangle, { size: 13, className: 'text-danger shrink-0' }),
          createElement(
            'span',
            { className: 'text-[11px] text-danger font-medium' },
            'Action irréversible',
          ),
        ),
        // Boutons
        createElement(
          'div',
          { className: 'flex justify-end gap-2 px-5 pb-5' },
          createElement(
            'button',
            {
              className:
                'px-4 py-2 text-xs font-medium text-text-muted hover:text-text hover:bg-surface-hover rounded-lg transition-colors',
              onClick: () => toast.dismiss(t.id),
            },
            'Annuler',
          ),
          createElement(
            'button',
            {
              className:
                'flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-danger hover:bg-danger/90 rounded-lg transition-colors shadow-sm',
              onClick: () => {
                toast.dismiss(t.id)
                onConfirm()
              },
            },
            createElement(Trash2, { size: 12 }),
            'Supprimer',
          ),
        ),
      ),
    { duration: 12000, position: 'top-center' },
  )
}
