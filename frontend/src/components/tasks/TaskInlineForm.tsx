import { useState, useRef, useEffect } from 'react'
import type { Task, TaskCreate, TaskUpdate, TaskStatus, TaskPriority } from '@/types'

interface TaskInlineFormProps {
  task?: Task
  defaultStatus?: TaskStatus
  onSubmit: (data: TaskCreate | TaskUpdate) => void
  onCancel: () => void
}

export default function TaskInlineForm({ task, defaultStatus, onSubmit, onCancel }: TaskInlineFormProps) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'normale')
  const [dueDate, setDueDate] = useState(task?.due_date ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    const trimmed = title.trim()
    if (!trimmed) return

    if (task) {
      // Edit mode
      const update: TaskUpdate = {
        title: trimmed,
        description: description.trim() || undefined,
        priority,
        due_date: dueDate || undefined,
      }
      onSubmit(update)
    } else {
      // Create mode
      const create: TaskCreate = {
        title: trimmed,
        description: description.trim() || undefined,
        status: defaultStatus ?? 'todo',
        priority,
        due_date: dueDate || undefined,
      }
      onSubmit(create)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-3 space-y-2" onKeyDown={handleKeyDown}>
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Titre de la tâche..."
        className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optionnel)"
        rows={2}
        className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary resize-none"
      />
      <div className="flex items-center gap-2">
        <select
          value={priority}
          onChange={e => setPriority(e.target.value as TaskPriority)}
          className="bg-background border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-primary"
        >
          <option value="haute">Haute</option>
          <option value="normale">Normale</option>
          <option value="basse">Basse</option>
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="bg-background border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-primary"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!title.trim()}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40 transition-colors"
          style={{ backgroundColor: '#534AB7' }}
        >
          {task ? 'Enregistrer' : 'Ajouter'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-text-muted hover:text-text transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}
