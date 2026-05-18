import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  Archive,
  FileText,
  Image as ImageIcon,
  Mail,
  Paperclip,
  Trash2,
  Upload,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import {
  journalAttachmentUrl,
  useDeleteJournalAttachment,
  useUploadJournalAttachment,
} from '@/hooks/usePlaquetteCheck'
import type { JournalAttachment } from '@/types'

interface JournalAttachmentListProps {
  year: number
  entryId: string
  attachments: JournalAttachment[]
}

const ACCEPTED = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'message/rfc822': ['.eml'],
  'application/zip': ['.zip'],
}

function _formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function _iconForMime(mime: string) {
  if (mime.startsWith('image/')) return ImageIcon
  if (mime === 'message/rfc822') return Mail
  if (mime === 'application/zip') return Archive
  if (mime === 'application/pdf') return FileText
  return FileText
}

/**
 * Affiche les pièces jointes d'une entrée journal + drop zone pour upload.
 *
 * Le journal reste toujours appendable (même en validation_finale / declare),
 * donc upload + delete sont toujours autorisés.
 *
 * Session 39 P1.
 */
export function JournalAttachmentList({
  year,
  entryId,
  attachments,
}: JournalAttachmentListProps) {
  const upload = useUploadJournalAttachment(year)
  const del = useDeleteJournalAttachment(year)

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      for (const file of acceptedFiles) {
        try {
          await upload.mutateAsync({ entryId, file })
          toast.success(`${file.name} ajouté`)
        } catch (e) {
          const err = e as Error & { status?: number }
          if (err.status === 413) {
            toast.error(`${file.name} : fichier > 10 Mo`)
          } else if (err.status === 415) {
            toast.error(`${file.name} : type non autorisé`)
          } else {
            toast.error(`${file.name} : ${err.message}`)
          }
        }
      }
    },
    [upload, entryId],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxSize: 10 * 1024 * 1024,
  })

  const handleDelete = async (filename: string) => {
    if (!confirm(`Supprimer "${filename}" ?`)) return
    try {
      await del.mutateAsync({ entryId, filename })
      toast.success('Pièce jointe supprimée')
    } catch (e) {
      toast.error(`Échec : ${(e as Error).message}`)
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {attachments.map((att) => {
            const Icon = _iconForMime(att.mime_type)
            const url = journalAttachmentUrl(year, entryId, att.filename)
            return (
              <div
                key={att.filename}
                className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-surface/60 pl-1.5 pr-1 py-1 hover:border-primary/40 hover:bg-surface transition-colors"
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px]"
                  title={`${att.filename} — ${_formatSize(att.size_bytes)}`}
                >
                  <Icon size={12} className="flex-none text-primary" />
                  <span className="max-w-[180px] truncate text-text">
                    {att.filename}
                  </span>
                  <span className="text-text-muted tabular-nums">
                    {_formatSize(att.size_bytes)}
                  </span>
                </a>
                <button
                  type="button"
                  onClick={() => handleDelete(att.filename)}
                  disabled={del.isPending}
                  className="ml-0.5 rounded p-0.5 text-text-muted opacity-0 hover:bg-danger/15 hover:text-danger group-hover:opacity-100 disabled:opacity-30"
                  aria-label="Supprimer"
                  title="Supprimer la pièce jointe"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Drop zone discrète (clic = file picker, drag-drop = upload) */}
      <div
        {...getRootProps()}
        className={cn(
          'flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 transition-colors',
          isDragActive
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-border/50 text-text-muted hover:border-border hover:bg-surface/40 hover:text-text',
          upload.isPending && 'opacity-50 cursor-not-allowed',
        )}
      >
        <input {...getInputProps()} />
        {upload.isPending ? (
          <>
            <Upload size={11} className="animate-pulse" />
            <span className="text-[10px] italic">Upload en cours…</span>
          </>
        ) : (
          <>
            <Paperclip size={11} />
            <span className="text-[10px]">
              {isDragActive
                ? 'Déposer ici…'
                : 'Glisser ou cliquer (PDF, EML, PNG, JPG, ZIP — ≤ 10 Mo)'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
