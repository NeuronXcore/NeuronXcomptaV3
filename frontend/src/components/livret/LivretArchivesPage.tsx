/**
 * Page Archives — `/livret/:year/archives`.
 *
 * Liste des snapshots de l'année avec filtres (type) et 4 actions par row :
 *   👁 Voir HTML in-app · 📄 Voir PDF in-app · ⬇ Télécharger · 🗑 Supprimer
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft,
  Camera,
  Download,
  Eye,
  FileText,
  Lock,
  Trash2,
} from 'lucide-react'

import {
  downloadSnapshotHtml,
  downloadSnapshotPdf,
  useDeleteLivretSnapshot,
  useLivretSnapshots,
} from '@/hooks/useLivretSnapshots'
import { useFiscalYearStore } from '@/stores/useFiscalYearStore'
import type { LivretSnapshotMetadata, SnapshotType } from '@/types/livret'
import { cn, formatDate } from '@/lib/utils'

import LivretSnapshotDrawer from './LivretSnapshotDrawer'
import LivretSnapshotViewerDrawer from './LivretSnapshotViewerDrawer'
import PdfPreviewDrawer from '@/components/charges-forfaitaires/PdfPreviewDrawer'

const TYPE_BADGES: Record<SnapshotType, string> = {
  auto_monthly: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  cloture: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  manual: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}
const TYPE_LABELS: Record<SnapshotType, string> = {
  auto_monthly: 'Auto mensuel',
  cloture: 'Clôture',
  manual: 'Manuel',
}

type FilterType = 'all' | SnapshotType

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

export default function LivretArchivesPage() {
  const navigate = useNavigate()
  const params = useParams<{ year?: string }>()
  const setStoreYear = useFiscalYearStore((s) => s.setYear)
  const storeYear = useFiscalYearStore((s) => s.selectedYear)

  const yearParam = params.year ? Number(params.year) : storeYear
  const year = Number.isFinite(yearParam) ? yearParam : storeYear

  // Sync URL :year → store
  useEffect(() => {
    if (Number.isFinite(yearParam) && yearParam !== storeYear) {
      setStoreYear(yearParam)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearParam])

  const { data, isLoading } = useLivretSnapshots(year)
  const deleteMutation = useDeleteLivretSnapshot()

  const [filterType, setFilterType] = useState<FilterType>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [htmlViewerOpen, setHtmlViewerOpen] = useState(false)
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false)
  const [activeSnapshot, setActiveSnapshot] = useState<LivretSnapshotMetadata | null>(null)

  const snapshots = useMemo(() => {
    const list = data?.snapshots ?? []
    if (filterType === 'all') return list
    return list.filter((s) => s.type === filterType)
  }, [data, filterType])

  const handleDelete = (snap: LivretSnapshotMetadata) => {
    const isCloture = snap.type === 'cloture'
    const confirmMsg = isCloture
      ? `Snapshot de clôture protégé.\n\nConfirmer la suppression FORCÉE de ${snap.id} ?\nCette action est irréversible.`
      : `Supprimer le snapshot ${snap.id} ?`
    if (!window.confirm(confirmMsg)) return

    deleteMutation.mutate(
      { id: snap.id, force: isCloture },
      {
        onSuccess: () => toast.success(`Snapshot ${snap.id} supprimé`),
        onError: (err) => toast.error(`Suppression impossible : ${err.message}`),
      },
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/livret')}
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
          >
            <ArrowLeft size={14} /> Livret {year}
          </button>
          <span className="text-text-muted">/</span>
          <h1 className="text-2xl font-bold text-text">Archives</h1>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors text-sm"
        >
          <Camera size={14} /> Créer un instantané
        </button>
      </div>

      {/* Filtres type */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-text-muted uppercase tracking-wider font-semibold mr-2">
          Filtrer
        </span>
        {(['all', 'auto_monthly', 'manual', 'cloture'] as FilterType[]).map((t) => {
          const isActive = filterType === t
          const count = t === 'all'
            ? data?.snapshots.length ?? 0
            : (data?.snapshots ?? []).filter((s) => s.type === t).length
          return (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                isActive
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-text-muted border-border hover:border-text-muted',
              )}
            >
              {t === 'all' ? 'Tous' : TYPE_LABELS[t as SnapshotType]} ({count})
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-text-muted">Chargement des archives…</div>
      ) : snapshots.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/30 p-12 text-center">
          <Camera size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-sm text-text-muted">
            {filterType === 'all'
              ? `Aucun snapshot pour ${year}.`
              : `Aucun snapshot de type ${TYPE_LABELS[filterType as SnapshotType]}.`}
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 text-sm"
          >
            <Camera size={14} /> Créer le premier instantané
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-hover">
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">YTD au</th>
                <th className="px-3 py-2 font-semibold">Commentaire</th>
                <th className="px-3 py-2 font-semibold">HTML</th>
                <th className="px-3 py-2 font-semibold">PDF</th>
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap) => {
                const isCloture = snap.type === 'cloture'
                return (
                  <tr key={snap.id} className="border-t border-border hover:bg-surface-hover/50">
                    <td className="px-3 py-2 text-text tabular-nums">
                      {formatDate(snap.snapshot_date)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider inline-flex items-center gap-1',
                          TYPE_BADGES[snap.type],
                        )}
                      >
                        {isCloture && <Lock size={9} />}
                        {TYPE_LABELS[snap.type]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-muted tabular-nums">
                      {formatDate(snap.as_of_date)}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      <span className="italic truncate inline-block max-w-[280px]" title={snap.comment ?? ''}>
                        {snap.comment || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-muted text-xs tabular-nums">
                      {formatBytes(snap.html_size)}
                    </td>
                    <td className="px-3 py-2 text-text-muted text-xs tabular-nums">
                      {formatBytes(snap.pdf_size)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSnapshot(snap)
                            setHtmlViewerOpen(true)
                          }}
                          className="p-1.5 rounded text-primary hover:bg-primary/10 transition-colors"
                          title="Voir HTML"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSnapshot(snap)
                            setPdfViewerOpen(true)
                          }}
                          className="p-1.5 rounded text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
                          title="Voir PDF"
                        >
                          <FileText size={14} />
                        </button>
                        <DownloadMenu snap={snap} />
                        <button
                          type="button"
                          onClick={() => handleDelete(snap)}
                          className="p-1.5 rounded text-danger hover:bg-danger/10 transition-colors"
                          title={isCloture ? 'Supprimer (forcé — cloture protégée)' : 'Supprimer'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <LivretSnapshotDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        year={year}
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

function DownloadMenu({ snap }: { snap: LivretSnapshotMetadata }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 rounded text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
        title="Télécharger"
      >
        <Download size={14} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-40 rounded-lg border border-border bg-surface shadow-xl py-1 min-w-[180px]">
            <button
              type="button"
              onClick={() => {
                downloadSnapshotHtml(snap.id, snap.html_filename)
                setOpen(false)
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover text-text"
            >
              ↓ Télécharger HTML
            </button>
            <button
              type="button"
              onClick={() => {
                downloadSnapshotPdf(snap.id, snap.pdf_filename)
                setOpen(false)
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover text-text"
            >
              ↓ Télécharger PDF
            </button>
          </div>
        </>
      )}
    </div>
  )
}
