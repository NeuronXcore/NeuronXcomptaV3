/**
 * Drawer large (~85% viewport) qui affiche le HTML autonome d'un snapshot dans
 * un iframe sandboxé (`allow-scripts` uniquement — le HTML n'a pas besoin de
 * cookies/localStorage car tout est en JS inline).
 *
 * Pas de fetch côté iframe — le JS embarqué lit `LIVRET_DATA` injecté dans le doc.
 */
import { useEffect, useState } from 'react'
import { Download, ExternalLink, Loader2, X } from 'lucide-react'

import {
  downloadSnapshotHtml,
  snapshotHtmlUrl,
} from '@/hooks/useLivretSnapshots'
import type { LivretSnapshotMetadata } from '@/types/livret'
import { formatDate } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  snapshot: LivretSnapshotMetadata | null
}

const TYPE_BADGES: Record<string, string> = {
  auto_monthly: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  cloture: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  manual: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}
const TYPE_LABELS: Record<string, string> = {
  auto_monthly: 'Auto mensuel',
  cloture: 'Clôture',
  manual: 'Manuel',
}

export default function LivretSnapshotViewerDrawer({ open, onClose, snapshot }: Props) {
  const [iframeLoaded, setIframeLoaded] = useState(false)

  useEffect(() => {
    if (!open) return
    setIframeLoaded(false)
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, snapshot?.id])

  if (!snapshot) return null

  const url = snapshotHtmlUrl(snapshot.id)
  const filename = snapshot.html_filename
  const badgeCls = TYPE_BADGES[snapshot.type] ?? 'bg-surface-hover text-text-muted border-border'
  const typeLabel = TYPE_LABELS[snapshot.type] ?? snapshot.type

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer 85% viewport, max 1400px */}
      <div
        className={`fixed top-0 right-0 h-full z-50 flex flex-col bg-background border-l border-border shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: 'min(85vw, 1400px)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-text">
              Livret comptable {snapshot.year}
            </h3>
            <p className="text-xs text-text-muted mt-1 flex items-center gap-2 flex-wrap">
              <span>Instantané du {formatDate(snapshot.snapshot_date)}</span>
              <span className={`px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider ${badgeCls}`}>
                {typeLabel}
              </span>
              <span className="text-text-muted/70">·</span>
              <span>YTD au {formatDate(snapshot.as_of_date)}</span>
              {snapshot.comment && (
                <>
                  <span className="text-text-muted/70">·</span>
                  <span className="italic truncate" title={snapshot.comment}>{snapshot.comment}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => downloadSnapshotHtml(snapshot.id, filename)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-primary text-white hover:bg-primary/90 transition-colors"
              title="Télécharger le HTML autonome"
            >
              <Download size={13} />
              Télécharger
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
              title="Ouvrir dans un nouvel onglet"
            >
              <ExternalLink size={14} />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Iframe sandbox */}
        <div className="flex-1 min-h-0 relative">
          {!iframeLoaded && (
            <div className="absolute inset-0 flex items-center justify-center text-text-muted z-10 bg-background">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="animate-spin" size={16} /> Chargement du livret figé…
              </div>
            </div>
          )}
          {open && (
            <iframe
              key={snapshot.id}
              src={url}
              sandbox="allow-scripts"
              className="w-full h-full border-0 bg-background"
              title={`Livret ${snapshot.year} — ${snapshot.snapshot_date}`}
              onLoad={() => setIframeLoaded(true)}
            />
          )}
        </div>
      </div>
    </>
  )
}
