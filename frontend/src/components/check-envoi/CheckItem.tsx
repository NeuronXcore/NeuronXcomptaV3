import { useState } from 'react'
import { Check, AlertTriangle, SquareCheck, OctagonX, Circle, StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CheckEnvoiItem, CheckPeriod } from '@/types'
import CommentBox from './CommentBox'
import { useUpdateCheckItem } from '@/hooks/useCheckEnvoi'

interface CheckItemProps {
  item: CheckEnvoiItem
  year: number
  period: CheckPeriod
  month: number | null
}

function StatusIcon({ status }: { status: CheckEnvoiItem['status'] }) {
  const cls = 'flex-shrink-0'
  switch (status) {
    case 'auto_ok':
      return <Check size={18} className={cn(cls, 'text-success')} aria-label="OK" />
    case 'auto_warning':
      return <AlertTriangle size={18} className={cn(cls, 'text-warning')} aria-label="Warning" />
    case 'manual_ok':
      return <SquareCheck size={18} className={cn(cls, 'text-info')} aria-label="Manuel OK" />
    case 'blocking':
      return <OctagonX size={18} className={cn(cls, 'text-danger')} aria-label="Bloquant" />
    case 'pending':
    default:
      return <Circle size={18} className={cn(cls, 'text-text-muted/60')} aria-label="En attente" />
  }
}

export default function CheckItem({ item, year, period, month }: CheckItemProps) {
  const update = useUpdateCheckItem()
  const hasComment = !!(item.comment && item.comment.trim())
  // Toujours visible si requires_comment, sinon contrôlé par bouton
  const [noteOpen, setNoteOpen] = useState<boolean>(item.requires_comment || hasComment)

  const handleCommentChange = (value: string) => {
    update.mutate({ year, period, month, itemKey: item.key, comment: value })
  }

  const handleManualToggle = () => {
    const next = item.status !== 'manual_ok'
    update.mutate({ year, period, month, itemKey: item.key, manual_ok: next })
  }

  const isManual = item.source === 'manual'
  const isManualOk = item.status === 'manual_ok'

  return (
    <div
      className={cn(
        'rounded-md border bg-surface/40 px-3 py-2.5 transition-colors',
        item.status === 'blocking' && 'border-danger/40 bg-danger/5',
        item.status === 'auto_warning' && 'border-warning/40',
        item.status === 'auto_ok' || item.status === 'manual_ok'
          ? 'border-success/30'
          : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <StatusIcon status={item.status} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-sm text-text">{item.label}</p>
            {item.detail && (
              <span className="text-xs text-text-muted">· {item.detail}</span>
            )}
          </div>
        </div>

        {isManual && (
          <button
            onClick={handleManualToggle}
            className={cn(
              'flex-shrink-0 w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center transition-all',
              isManualOk
                ? 'bg-info border-info text-white'
                : 'border-text-muted/40 hover:border-info',
            )}
            title={isManualOk ? 'Décocher' : 'Cocher'}
            aria-label={isManualOk ? 'Décocher' : 'Cocher'}
          >
            {isManualOk && <Check size={14} strokeWidth={3} />}
          </button>
        )}

        {!item.requires_comment && (
          <button
            onClick={() => setNoteOpen((v) => !v)}
            className={cn(
              'flex-shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors',
              hasComment
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-text-muted hover:text-text hover:border-text-muted',
            )}
            title={hasComment ? 'Note ajoutée' : 'Ajouter une note'}
          >
            <StickyNote size={12} />
            {hasComment ? 'Note ✓' : '+ Note'}
          </button>
        )}
      </div>

      {(noteOpen || item.requires_comment) && (
        <div
          className={cn(
            'mt-2 ml-7',
            item.requires_comment && !hasComment && 'p-2 rounded-md bg-danger/5 border border-danger/30',
          )}
        >
          <CommentBox
            initialValue={item.comment}
            onChange={handleCommentChange}
            placeholder={
              item.requires_comment
                ? 'Commentaire obligatoire pour cette ligne d\'attente'
                : 'Commentaire libre injecté dans le mail'
            }
            required={item.requires_comment}
          />
        </div>
      )}
    </div>
  )
}
