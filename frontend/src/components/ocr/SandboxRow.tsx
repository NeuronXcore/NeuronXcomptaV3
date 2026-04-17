import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Pencil, Check, X, Loader2, Play, Trash2, Clock, CheckCircle2,
  AlertCircle, Eye,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn, isCanonicalFilename } from '@/lib/utils'
import type { SandboxFileItem } from '@/types'
import PdfThumbnail from '@/components/shared/PdfThumbnail'
import { useRenameInSandbox } from '@/hooks/useSandboxInbox'

interface SandboxRowProps {
  item: SandboxFileItem
  onProcess: (filename: string) => void
  onDelete: (filename: string) => void
  onPreview?: (filename: string) => void
  processing: boolean
  focused: boolean
  onFocus: () => void
  /** Si `true`, la checkbox de s\u00e9lection est coch\u00e9e (batch mode). */
  selected: boolean
  /** Handler de toggle checkbox. Appel\u00e9 avec le nouveau state. */
  onToggleSelected: (next: boolean) => void
}

function formatAgo(iso: string): string {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000
    if (diff < 60) return `il y a ${Math.max(1, Math.floor(diff))}s`
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`
    return `il y a ${Math.floor(diff / 86400)}j`
  } catch {
    return ''
  }
}

export default function SandboxRow({
  item,
  onProcess,
  onDelete,
  onPreview,
  processing,
  focused,
  onFocus,
  selected,
  onToggleSelected,
}: SandboxRowProps) {
  const stem = item.filename.replace(/\.pdf$/i, '')
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(stem)
  const [localFilename, setLocalFilename] = useState(item.filename)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const rename = useRenameInSandbox()

  // Sync local filename when item updates (post-rename server-side)
  useEffect(() => {
    setLocalFilename(item.filename)
    if (!editing) setEditValue(item.filename.replace(/\.pdf$/i, ''))
  }, [item.filename, editing])

  // Focus input on edit
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  // Focus row when parent signals via `focused`
  useEffect(() => {
    if (focused && rowRef.current && !editing) {
      rowRef.current.focus()
    }
  }, [focused, editing])

  const isCanonical = useMemo(
    () => isCanonicalFilename(localFilename),
    [localFilename],
  )

  const startEditing = useCallback(() => {
    setEditValue(localFilename.replace(/\.pdf$/i, ''))
    setEditing(true)
  }, [localFilename])

  const runRename = useCallback(
    (newFilename: string, thenProcess: boolean) => {
      rename.mutate(
        { filename: localFilename, newFilename },
        {
          onSuccess: (data) => {
            setEditing(false)
            setLocalFilename(data.new)
            if (data.old !== data.new) {
              toast.success(`Renommé : ${data.new}`)
            }
            if (thenProcess) {
              onProcess(data.new)
            }
          },
          onError: (err) => {
            const msg = (err as { message?: string }).message || 'Erreur rename'
            toast.error(msg)
            setEditValue(localFilename.replace(/\.pdf$/i, ''))
          },
        },
      )
    },
    [localFilename, rename, onProcess],
  )

  const handleSave = useCallback(
    (thenProcess = false) => {
      const trimmed = editValue.trim()
      if (!trimmed) {
        setEditing(false)
        return
      }
      const newFilename = trimmed.toLowerCase().endsWith('.pdf')
        ? trimmed
        : `${trimmed}.pdf`
      if (newFilename === localFilename) {
        setEditing(false)
        if (thenProcess) onProcess(localFilename)
        return
      }
      runRename(newFilename, thenProcess)
    },
    [editValue, localFilename, runRename, onProcess],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSave(e.shiftKey)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setEditing(false)
        setEditValue(localFilename.replace(/\.pdf$/i, ''))
      }
    },
    [handleSave, localFilename],
  )

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (editing) return
      // Cmd/Ctrl + Backspace → delete
      if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onDelete(localFilename)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onProcess(localFilename)
      }
    },
    [editing, localFilename, onDelete, onProcess],
  )

  // Countdown auto_deadline : re-render toutes les 250 ms tant qu'il y a une
  // deadline \u2014 le `nowTs` state est l'input du useMemo (sans lui, le memo
  // \u00e9tait bloqu\u00e9 sur les deps statiques arrived_at/deadline \u2192 barre fig\u00e9e).
  // 250 ms donne une progression visuelle fluide sans sur-renders superflus.
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    if (!item.auto_deadline) return
    setNowTs(Date.now()) // sync imm\u00e9diat au mount
    const id = setInterval(() => setNowTs(Date.now()), 250)
    return () => clearInterval(id)
  }, [item.auto_deadline])

  const autoCountdown = useMemo(() => {
    if (!item.auto_deadline) return null
    try {
      const deadline = new Date(item.auto_deadline).getTime()
      const arrived = new Date(item.arrived_at).getTime()
      const remainingSec = (deadline - nowTs) / 1000
      if (remainingSec <= 0) {
        return { text: 'OCR auto imminent\u2026', percent: 100, remainingSec: 0 }
      }
      const totalSec = Math.max(1, (deadline - arrived) / 1000)
      const elapsedSec = Math.max(0, totalSec - remainingSec)
      const percent = Math.min(100, (elapsedSec / totalSec) * 100)
      const secs = Math.max(0, Math.ceil(remainingSec))
      return {
        text: secs < 60 ? `OCR auto dans ${secs}s` : `OCR auto dans ${Math.floor(secs / 60)}min`,
        percent,
        remainingSec,
      }
    } catch {
      return null
    }
  }, [item.auto_deadline, item.arrived_at, nowTs])

  const size = item.size_human
  const ago = formatAgo(item.arrived_at)

  return (
    <div
      ref={rowRef}
      tabIndex={0}
      onFocus={onFocus}
      onKeyDown={handleRowKeyDown}
      className={cn(
        'group flex items-start gap-4 p-4 rounded-lg border transition-colors outline-none',
        selected
          ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/40'
          : focused
            ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30'
            : 'border-border bg-surface hover:bg-surface-hover focus:border-primary/60 focus:ring-1 focus:ring-primary/30',
      )}
    >
      {/* Checkbox batch selection — visible opacit\u00e9 50% au repos, 100% au hover
          ou quand au moins 1 ligne est s\u00e9lectionn\u00e9e dans la tab (via prop). */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? 'D\u00e9s\u00e9lectionner' : 'S\u00e9lectionner pour OCR batch'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelected(!selected)
        }}
        className={cn(
          'shrink-0 mt-[22px] w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center transition-all',
          selected
            ? 'bg-primary border-primary text-white opacity-100'
            : 'border-border bg-background text-transparent hover:border-primary/60 opacity-40 group-hover:opacity-100',
        )}
        title={selected ? 'D\u00e9s\u00e9lectionner (cliquer)' : 'S\u00e9lectionner pour OCR batch'}
      >
        <Check size={14} strokeWidth={3} />
      </button>

      {/* Thumbnail */}
      <PdfThumbnail
        sandboxFilename={localFilename}
        className="w-[60px] h-[84px] rounded shrink-0 cursor-pointer"
        iconSize={24}
        lazy={false}
        onClick={() => onPreview?.(localFilename)}
      />

      {/* Body */}
      <div className="flex-1 min-w-0">
        {/* Filename inline editor */}
        <div className="flex items-center gap-2 mb-1">
          {editing ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={rename.isPending}
                className="flex-1 min-w-0 bg-transparent border-b border-primary/60 text-text text-sm py-0.5 outline-none font-mono"
                placeholder="fournisseur_YYYYMMDD_montant.XX"
              />
              <span className="text-text-muted text-xs">.pdf</span>
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={rename.isPending}
                className="p-1 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                title="Valider (↵)"
              >
                {rename.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setEditValue(localFilename.replace(/\.pdf$/i, ''))
                }}
                className="p-1 rounded text-text-muted hover:text-text hover:bg-surface"
                title="Annuler (Esc)"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <span
                className="text-sm font-mono text-text truncate cursor-pointer hover:text-primary transition-colors"
                title={`Cliquer pour renommer — ${localFilename}`}
                onClick={startEditing}
              >
                {localFilename}
              </span>
              <button
                type="button"
                onClick={startEditing}
                className="p-1 text-text-muted hover:text-primary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Renommer (Shift+↵ = renomme puis Lancer OCR)"
              >
                <Pencil size={13} />
              </button>
            </>
          )}
        </div>

        {/* Badges + meta */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {isCanonical ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <CheckCircle2 size={11} /> Canonique
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <AlertCircle size={11} /> En attente
            </span>
          )}
          {processing && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
              <Loader2 size={11} className="animate-spin" /> OCR en cours
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-text-muted">
            <Clock size={11} /> arrivé {ago}
          </span>
          <span className="text-text-muted">· {size}</span>
        </div>

        {/* Countdown auto-mode \u2014 barre dynamique (tick 250 ms, transition 300 ms
            pour lisser entre ticks). Gradient amber\u2192orange pour rendu chaleureux. */}
        {autoCountdown && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden border border-border relative">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-[width] duration-300 ease-linear"
                style={{ width: `${autoCountdown.percent}%` }}
              />
            </div>
            <span className="text-[10px] text-amber-400 tabular-nums whitespace-nowrap min-w-[90px] text-right">
              {autoCountdown.text}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {onPreview && (
          <button
            type="button"
            onClick={() => onPreview(localFilename)}
            className="p-2 rounded-md text-text-muted hover:text-primary hover:bg-surface"
            title="Aperçu PDF"
          >
            <Eye size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onProcess(localFilename)}
          disabled={processing}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
            processing
              ? 'bg-primary/50 text-white/70 cursor-not-allowed'
              : 'bg-primary text-white hover:bg-primary/90',
          )}
          title="Lancer OCR (↵ sur la ligne)"
        >
          {processing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Lancer OCR
        </button>
        <button
          type="button"
          onClick={() => onDelete(localFilename)}
          className="p-2 rounded-md text-text-muted hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Supprimer (⌘⌫)"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}

