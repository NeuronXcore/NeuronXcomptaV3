import { useState, useRef, useEffect, useCallback } from 'react'
import { Pencil, Wand2, Sparkles, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRenameJustificatif, isRenameCollision } from '@/hooks/useJustificatifs'
import toast from 'react-hot-toast'

interface FilenameEditorProps {
  filename: string
  ocrData?: {
    supplier?: string | null
    best_date?: string | null
    best_amount?: number | null
  }
  originalFilename?: string | null
  onRenamed?: (newFilename: string) => void
  compact?: boolean
}

function normalizeSupplier(raw: string): string {
  let s = raw.toLowerCase().trim()
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  s = s.replace(/[\s.\-_]+/g, '-')
  s = s.replace(/[^a-z0-9-]/g, '')
  s = s.replace(/^-+|-+$/g, '')
  return s.slice(0, 30) || 'inconnu'
}

function buildConventionName(
  supplier: string | null | undefined,
  dateIso: string | null | undefined,
  amount: number | null | undefined,
): string | null {
  if (!dateIso || amount == null) return null
  const norm = normalizeSupplier(supplier || 'inconnu')
  const datePart = dateIso.replace(/-/g, '')
  const amountPart = Math.abs(amount).toFixed(2).replace('.', ',')
  return `${norm}_${datePart}_${amountPart}`
}

export default function FilenameEditor({
  filename,
  ocrData,
  originalFilename,
  onRenamed,
  compact = false,
}: FilenameEditorProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const renameMutation = useRenameJustificatif()

  const stem = filename.replace(/\.pdf$/i, '')

  const startEditing = useCallback(() => {
    setEditValue(stem)
    setEditing(true)
  }, [stem])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const runRename = useCallback(
    (newFilename: string) => {
      renameMutation.mutate(
        { filename, newFilename },
        {
          onSuccess: (data) => {
            if (data.status === 'deduplicated') {
              toast.success(`Doublon supprim\u00e9 : ${data.new}`)
            } else {
              toast.success(`Renomm\u00e9 : ${data.new}`)
            }
            setEditing(false)
            onRenamed?.(data.new)
          },
          onError: (err) => {
            // Rollback du state local à l'ancien filename
            setEditValue(filename.replace(/\.pdf$/i, ''))
            if (isRenameCollision(err)) {
              const { message, suggestion } = err.detail
              toast.custom(
                (t) => (
                  <div className="bg-surface border border-danger/40 rounded-lg p-3 shadow-lg max-w-md">
                    <div className="text-sm text-text mb-2">{message}</div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          toast.dismiss(t.id)
                          runRename(suggestion)
                        }}
                        className="px-2 py-1 text-xs bg-primary text-white rounded hover:bg-primary/90"
                      >
                        Utiliser {suggestion}
                      </button>
                      <button
                        type="button"
                        onClick={() => toast.dismiss(t.id)}
                        className="px-2 py-1 text-xs text-text-muted hover:text-text"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ),
                { duration: 10000 },
              )
            } else {
              toast.error(err.message || 'Erreur lors du renommage')
            }
          },
        },
      )
    },
    [filename, renameMutation, onRenamed],
  )

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim()
    if (!trimmed) {
      setEditing(false)
      return
    }
    const newFilename = trimmed.endsWith('.pdf') ? trimmed : `${trimmed}.pdf`
    if (newFilename === filename) {
      setEditing(false)
      return
    }
    runRename(newFilename)
  }, [editValue, filename, runRename])

  const handleCancel = useCallback(() => {
    setEditing(false)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSave()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    },
    [handleSave, handleCancel],
  )

  const handleSuggest = useCallback(() => {
    if (!ocrData) return
    const suggestion = buildConventionName(ocrData.supplier, ocrData.best_date, ocrData.best_amount)
    if (suggestion) {
      setEditValue(suggestion)
    } else {
      toast.error('Donn\u00e9es OCR insuffisantes pour sugg\u00e9rer un nom')
    }
  }, [ocrData])

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="flex items-center gap-0 flex-1 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Delay to allow button clicks
              setTimeout(() => {
                if (editing && !renameMutation.isPending) {
                  handleCancel()
                }
              }, 200)
            }}
            className={cn(
              'bg-transparent border-b border-accent text-text outline-none min-w-0 flex-1',
              compact ? 'text-[11px] py-0' : 'text-xs py-0.5',
            )}
            disabled={renameMutation.isPending}
          />
          <span className={cn('text-text-muted shrink-0', compact ? 'text-[11px]' : 'text-xs')}>.pdf</span>
        </div>

        {ocrData && (
          <button
            type="button"
            onClick={handleSuggest}
            className="p-0.5 text-primary hover:text-primary/80 transition-colors shrink-0"
            title="Sugg\u00e9rer le nom convention (OCR)"
          >
            <Sparkles size={compact ? 11 : 13} />
          </button>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={renameMutation.isPending}
          className="p-0.5 text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
          title="Valider"
        >
          <Check size={compact ? 11 : 13} />
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="p-0.5 text-text-muted hover:text-text transition-colors shrink-0"
          title="Annuler"
        >
          <X size={compact ? 11 : 13} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className={cn(
          'text-text truncate cursor-pointer hover:text-primary transition-colors',
          compact ? 'text-[11px] max-w-[180px]' : 'text-xs max-w-[200px]',
        )}
        title={filename}
        onClick={startEditing}
      >
        {compact && filename.length > 30
          ? filename.slice(0, 16) + '...' + filename.slice(-12)
          : filename.length > 35
            ? filename.slice(0, 18) + '...' + filename.slice(-14)
            : filename}
      </span>

      <button
        type="button"
        onClick={startEditing}
        className="p-0.5 text-text-muted hover:text-primary transition-colors shrink-0 opacity-0 group-hover:opacity-100"
        title="Renommer"
      >
        <Pencil size={compact ? 10 : 12} />
      </button>

      {originalFilename && (
        <span
          className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-primary/10 text-primary rounded text-[9px] shrink-0"
          title={`Renomm\u00e9 automatiquement depuis ${originalFilename}`}
        >
          <Wand2 size={9} />
          auto
        </span>
      )}
    </div>
  )
}
