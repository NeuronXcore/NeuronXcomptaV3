import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import TaskCard from './TaskCard'
import type { Task, TaskStatus } from '@/types'

interface KanbanColumnProps {
  status: TaskStatus
  title: string
  color: string
  tasks: Task[]
  onEdit: (task: Task) => void
  onDelete: (id: string) => void
  onDismiss: (id: string) => void
  onAddClick: (status: TaskStatus) => void
  addForm?: React.ReactNode
}

export default function KanbanColumn({
  status,
  title,
  color,
  tasks,
  onEdit,
  onDelete,
  onDismiss,
  onAddClick,
  addForm,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  // Tasks are already sorted by order from the parent
  const taskIds = useMemo(() => tasks.map(t => t.id), [tasks])

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-xl border border-border min-h-[400px] transition-colors',
        isOver ? 'bg-surface-hover/50' : 'bg-background'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <span className="text-xs text-text-muted bg-surface rounded-full px-2 py-0.5 ml-auto">
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 p-3 space-y-2 overflow-y-auto">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={onEdit}
              onDelete={onDelete}
              onDismiss={onDismiss}
            />
          ))}
        </SortableContext>

        {/* Inline form or add button */}
        {addForm || (
          <button
            onClick={() => onAddClick(status)}
            className="w-full py-2 border border-dashed border-border rounded-lg text-xs text-text-muted hover:text-text hover:border-text-muted transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus size={14} />
            Ajouter
          </button>
        )}
      </div>
    </div>
  )
}
