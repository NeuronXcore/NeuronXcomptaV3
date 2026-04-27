import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Pencil, Trash2, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task } from '@/types'

const PRIORITY_COLORS: Record<string, string> = {
  haute: '#E24B4A',
  normale: '#EF9F27',
  basse: '#1D9E75',
}

const PRIORITY_LABELS: Record<string, string> = {
  haute: 'Haute',
  normale: 'Normale',
  basse: 'Basse',
}

interface TaskCardProps {
  task: Task
  onEdit: (task: Task) => void
  onDelete: (id: string) => void
  onDismiss: (id: string) => void
  isDragOverlay?: boolean
}

export default function TaskCard({ task, onEdit, onDelete, onDismiss, isDragOverlay }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  const isDone = task.status === 'done'
  const borderColor = isDone ? '#1D9E75' : PRIORITY_COLORS[task.priority] || '#EF9F27'

  const isOverdue =
    task.due_date && !isDone && new Date(task.due_date) < new Date(new Date().toDateString())

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      {...(isDragOverlay ? {} : attributes)}
      {...(isDragOverlay ? {} : listeners)}
      className={cn(
        'group bg-surface rounded-lg border border-border p-3 cursor-grab active:cursor-grabbing',
        'hover:border-border/80 transition-all',
        isDone && 'opacity-55'
      )}
      style={{
        ...(isDragOverlay ? {} : style),
        borderLeft: `3px solid ${borderColor}`,
      }}
    >
      {/* Title + badges */}
      <div className="flex items-start gap-2 mb-1">
        <span className={cn('text-sm font-medium text-text flex-1', isDone && 'line-through text-text-muted')}>
          {task.title}
        </span>
        {/* Hover actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {task.source === 'manual' ? (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(task) }}
                className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}
                className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-danger transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(task.id) }}
              className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
              title="Ignorer cette tâche"
            >
              <EyeOff size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-text-muted line-clamp-1 mb-2">{task.description}</p>
      )}

      {/* Footer: badges + date */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Priority badge */}
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white"
          style={{ backgroundColor: PRIORITY_COLORS[task.priority] }}
        >
          {PRIORITY_LABELS[task.priority]}
        </span>

        {/* Auto badge */}
        {task.source === 'auto' && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-900/30 text-blue-400">
            Auto
          </span>
        )}

        {/* Due date */}
        {task.due_date && (
          <span className={cn('text-[10px] ml-auto', isOverdue ? 'text-danger font-medium' : 'text-text-muted')}>
            {new Date(task.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
          </span>
        )}
      </div>
    </div>
  )
}
