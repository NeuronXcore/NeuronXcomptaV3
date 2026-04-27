import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { RefreshCw, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/shared/PageHeader'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import KanbanColumn from './KanbanColumn'
import TaskCard from './TaskCard'
import TaskInlineForm from './TaskInlineForm'
import { useTasks, useCreateTask, useUpdateTask, useDeleteTask, useRefreshAutoTasks, useReorderTasks } from '@/hooks/useTasks'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import type { Task, TaskStatus, TaskCreate, TaskUpdate } from '@/types'

const COLUMNS: { status: TaskStatus; title: string; color: string }[] = [
  { status: 'todo', title: 'To do', color: '#B4B2A9' },
  { status: 'in_progress', title: 'In progress', color: '#378ADD' },
  { status: 'done', title: 'Done', color: '#1D9E75' },
]

export default function TasksPage() {
  const { selectedYear } = useFiscalYearStore()
  const { data: tasks, isLoading } = useTasks(selectedYear)
  const createMutation = useCreateTask()
  const updateMutation = useUpdateTask()
  const deleteMutation = useDeleteTask()
  const refreshMutation = useRefreshAutoTasks()
  const reorderMutation = useReorderTasks()

  const [addingInColumn, setAddingInColumn] = useState<TaskStatus | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  // Auto-refresh auto-tasks when year changes
  const lastRefreshedYear = useRef<number | null>(null)
  useEffect(() => {
    if (lastRefreshedYear.current === selectedYear) return
    lastRefreshedYear.current = selectedYear
    refreshMutation.mutate(selectedYear)
  }, [selectedYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // Group tasks by status, sorted by order
  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      todo: [],
      in_progress: [],
      done: [],
    }
    for (const t of tasks ?? []) {
      if (grouped[t.status]) grouped[t.status].push(t)
    }
    // Sort each column by order field
    for (const key of Object.keys(grouped) as TaskStatus[]) {
      grouped[key].sort((a, b) => a.order - b.order)
    }
    return grouped
  }, [tasks])

  const handleDragStart = (event: DragStartEvent) => {
    const task = (tasks ?? []).find(t => t.id === event.active.id)
    setActiveTask(task ?? null)
  }

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveTask(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const allTasks = tasks ?? []
    const task = allTasks.find(t => t.id === active.id)
    if (!task) return

    // Determine target column: `over.id` could be a column id or a card id
    const columnStatuses: string[] = ['todo', 'in_progress', 'done']
    let targetStatus: TaskStatus
    if (columnStatuses.includes(over.id as string)) {
      targetStatus = over.id as TaskStatus
    } else {
      const overTask = allTasks.find(t => t.id === over.id)
      targetStatus = overTask?.status ?? task.status
    }

    const sameColumn = targetStatus === task.status

    if (sameColumn) {
      // Intra-column reorder
      const columnTasks = [...tasksByStatus[task.status]]
      const oldIndex = columnTasks.findIndex(t => t.id === active.id)
      const newIndex = columnTasks.findIndex(t => t.id === over.id)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

      const reordered = arrayMove(columnTasks, oldIndex, newIndex)
      // Persist order for this column
      reorderMutation.mutate(reordered.map(t => t.id))
    } else {
      // Cross-column move: update status + insert at target position
      const targetColumn = [...tasksByStatus[targetStatus]]
      const overIndex = targetColumn.findIndex(t => t.id === over.id)

      // Build new order: insert task into target column at the drop position
      const insertIndex = overIndex === -1 ? targetColumn.length : overIndex
      targetColumn.splice(insertIndex, 0, task)

      updateMutation.mutate(
        { id: task.id, data: { status: targetStatus } },
        {
          onSuccess: () => {
            // Persist the new order for the target column
            reorderMutation.mutate(targetColumn.map(t => t.id))
            const label = COLUMNS.find(c => c.status === targetStatus)?.title ?? targetStatus
            toast.success(`Tâche déplacée vers ${label}`)
          },
        }
      )
    }
  }, [tasks, tasksByStatus, updateMutation, reorderMutation])

  const handleCreate = (data: TaskCreate | TaskUpdate) => {
    const payload = { ...(data as TaskCreate), year: selectedYear }
    createMutation.mutate(payload, {
      onSuccess: () => setAddingInColumn(null),
    })
  }

  const handleEdit = (task: Task) => {
    setEditingTask(task)
    setAddingInColumn(null)
  }

  const handleEditSubmit = (data: TaskUpdate) => {
    if (!editingTask) return
    updateMutation.mutate(
      { id: editingTask.id, data },
      { onSuccess: () => { setEditingTask(null); toast.success('Tâche modifiée') } }
    )
  }

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id)
  }

  const handleDismiss = (id: string) => {
    updateMutation.mutate(
      { id, data: { dismissed: true } },
      { onSuccess: () => toast.success('Tâche ignorée') }
    )
  }

  if (isLoading) return <LoadingSpinner text="Chargement des tâches..." />

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Tâches"
        description={`Suivi des actions comptables — ${selectedYear}`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshMutation.mutate(selectedYear)}
              disabled={refreshMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-text hover:bg-surface-hover transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshMutation.isPending ? 'animate-spin' : ''} />
              Rafraîchir
            </button>
            <button
              onClick={() => { setAddingInColumn('todo'); setEditingTask(null) }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: '#534AB7' }}
            >
              <Plus size={16} />
              Nouvelle tâche
            </button>
          </div>
        }
      />

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-3 gap-4 mt-4">
          {COLUMNS.map(col => (
            <KanbanColumn
              key={col.status}
              status={col.status}
              title={col.title}
              color={col.color}
              tasks={tasksByStatus[col.status]}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onDismiss={handleDismiss}
              onAddClick={(s) => { setAddingInColumn(s); setEditingTask(null) }}
              addForm={
                addingInColumn === col.status ? (
                  <TaskInlineForm
                    defaultStatus={col.status}
                    onSubmit={handleCreate}
                    onCancel={() => setAddingInColumn(null)}
                  />
                ) : editingTask && editingTask.status === col.status ? (
                  <TaskInlineForm
                    task={editingTask}
                    onSubmit={handleEditSubmit}
                    onCancel={() => setEditingTask(null)}
                  />
                ) : undefined
              }
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              onEdit={() => {}}
              onDelete={() => {}}
              onDismiss={() => {}}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
