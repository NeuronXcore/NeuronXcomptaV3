/**
 * Header sticky : titre + sélecteur année + live dot pulsant + horodatage MAJ
 * + boutons Phase 3 actifs (Figer / Archives / ↓ PDF / ↓ HTML).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Camera, Download, FileArchive, FolderClock } from 'lucide-react'

import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import { useOperationFiles } from '@/hooks/useOperations'
import {
  downloadSnapshotHtml,
  downloadSnapshotPdf,
  useLivretSnapshots,
} from '@/hooks/useLivretSnapshots'
import type { LivretMetadata, LivretSnapshotMetadata } from '@/types/livret'
import { cn } from '@/lib/utils'

import LivretSnapshotDrawer from './LivretSnapshotDrawer'
import LivretSnapshotViewerDrawer from './LivretSnapshotViewerDrawer'
import PdfPreviewDrawer from '@/components/charges-forfaitaires/PdfPreviewDrawer'

interface Props {
  metadata?: LivretMetadata
  isFetching: boolean
}

export default function LivretToolbar({ metadata, isFetching }: Props) {
  const navigate = useNavigate()
  const { selectedYear, setYear } = useFiscalYearStore()
  const { data: files } = useOperationFiles()
  const { data: snapshotsData } = useLivretSnapshots(selectedYear)
  const snapshots: LivretSnapshotMetadata[] = snapshotsData?.snapshots ?? []
  const latestSnapshot = snapshots[0] ?? null
  const snapshotsCount = snapshots.length

  const [createOpen, setCreateOpen] = useState(false)
  const [htmlViewerOpen, setHtmlViewerOpen] = useState(false)
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false)
  const [activeSnapshot, setActiveSnapshot] = useState<LivretSnapshotMetadata | null>(null)

  const years = (() => {
    const set = new Set<number>()
    const now = new Date().getFullYear()
    set.add(now)
    set.add(now - 1)
    set.add(now + 1)
    files?.forEach((f) => f.year && set.add(f.year))
    return [...set].sort((a, b) => b - a)
  })()

  const [relativeUpdated, setRelativeUpdated] = useState('—')
  useEffect(() => {
    if (!metadata?.generated_at) return
    function tick() {
      const generated = new Date(metadata!.generated_at).getTime()
      const now = Date.now()
      const diffSec = Math.max(0, Math.round((now - generated) / 1000))
      if (diffSec < 5) setRelativeUpdated('à l’instant')
      else if (diffSec < 60) setRelativeUpdated(`il y a ${diffSec} s`)
      else if (diffSec < 3600) setRelativeUpdated(`il y a ${Math.round(diffSec / 60)} min`)
      else setRelativeUpdated(`il y a ${Math.round(diffSec / 3600)} h`)
    }
    tick()
    const interval = setInterval(tick, 5000)
    return () => clearInterval(interval)
  }, [metadata?.generated_at])

  const isLive = metadata?.is_live ?? true

  const handleViewLatestHtml = () => {
    if (!latestSnapshot) {
      toast('Aucun snapshot — créez-en un d\'abord', { icon: '📸' })
      setCreateOpen(true)
      return
    }
    setActiveSnapshot(latestSnapshot)
    setHtmlViewerOpen(true)
  }

  const handleViewLatestPdf = () => {
    if (!latestSnapshot) {
      toast('Aucun snapshot — créez-en un d\'abord', { icon: '📸' })
      setCreateOpen(true)
      return
    }
    setActiveSnapshot(latestSnapshot)
    setPdfViewerOpen(true)
  }

  return (
    <div className="sticky top-0 z-20 bg-background border-b border-border">
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text">Livret comptable</h1>
            <p className="text-xs text-text-muted">
              Synthèse narrative annuelle — vivant, archivable
            </p>
          </div>
          <div className="flex items-center gap-1.5 ml-4">
            <button
              type="button"
              onClick={() => setYear(selectedYear - 1)}
              className="px-2 py-1 rounded-md hover:bg-surface-hover text-text-muted"
              aria-label="Année précédente"
            >
              ◀
            </button>
            <select
              value={selectedYear}
              onChange={(e) => setYear(Number(e.target.value))}
              className="px-3 py-1.5 rounded-md bg-surface border border-border text-text text-base font-medium tabular-nums"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setYear(selectedYear + 1)}
              className="px-2 py-1 rounded-md hover:bg-surface-hover text-text-muted"
              aria-label="Année suivante"
            >
              ▶
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Live indicator */}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={cn(
                  'absolute inline-flex h-full w-full rounded-full opacity-75',
                  isLive ? 'animate-ping bg-success' : 'bg-text-muted',
                )}
              />
              <span
                className={cn(
                  'relative inline-flex rounded-full h-2.5 w-2.5',
                  isLive ? 'bg-success' : 'bg-text-muted',
                )}
              />
            </span>
            <span className="text-xs text-text-muted">
              {isFetching ? 'mise à jour…' : `MAJ ${relativeUpdated}`}
            </span>
          </div>

          {/* Boutons Phase 3 actifs */}
          <div className="flex items-center gap-1.5 pl-3 border-l border-border">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-primary text-white hover:bg-primary/90 transition-colors"
              title="Figer un instantané du livret courant"
            >
              <Camera size={13} />
              <span className="hidden md:inline">Figer instantané</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`/livret/${selectedYear}/archives`)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-surface-hover text-text border border-border hover:bg-surface transition-colors"
              title="Voir les archives"
            >
              <FolderClock size={13} />
              <span className="hidden md:inline">Archives</span>
              {snapshotsCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] tabular-nums">
                  {snapshotsCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={handleViewLatestPdf}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-surface-hover text-text border border-border hover:bg-surface transition-colors"
              title={latestSnapshot ? `Voir le PDF du dernier snapshot (${latestSnapshot.snapshot_date})` : 'Aucun snapshot'}
            >
              <Download size={13} />
              <span className="hidden md:inline">↓ PDF</span>
            </button>
            <button
              type="button"
              onClick={handleViewLatestHtml}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-surface-hover text-text border border-border hover:bg-surface transition-colors"
              title={latestSnapshot ? `Voir le HTML du dernier snapshot (${latestSnapshot.snapshot_date})` : 'Aucun snapshot'}
            >
              <FileArchive size={13} />
              <span className="hidden md:inline">↓ HTML</span>
            </button>
          </div>
        </div>
      </div>

      {/* Drawers */}
      <LivretSnapshotDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        year={selectedYear}
        onCreated={(snap) => setActiveSnapshot(snap)}
        onOpenHtml={(snap) => {
          setActiveSnapshot(snap)
          setCreateOpen(false)
          setHtmlViewerOpen(true)
        }}
        onOpenPdf={(snap) => {
          setActiveSnapshot(snap)
          setCreateOpen(false)
          setPdfViewerOpen(true)
        }}
      />
      <LivretSnapshotViewerDrawer
        open={htmlViewerOpen}
        onClose={() => setHtmlViewerOpen(false)}
        snapshot={activeSnapshot}
      />
      {activeSnapshot && (
        <PdfPreviewDrawer
          open={pdfViewerOpen}
          onClose={() => setPdfViewerOpen(false)}
          pdfUrl={`/api/livret/snapshots/${activeSnapshot.id}/pdf`}
          downloadFilename={activeSnapshot.pdf_filename}
          title={`Livret ${activeSnapshot.year} — Instantané ${activeSnapshot.snapshot_date}`}
          subtitle={activeSnapshot.comment ?? undefined}
        />
      )}
    </div>
  )
}
