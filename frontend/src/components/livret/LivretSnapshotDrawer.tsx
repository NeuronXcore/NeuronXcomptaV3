/**
 * Drawer 480px — création d'un snapshot manuel.
 * Champ commentaire + sélecteur date (défaut hier). Au succès, propose
 * `Voir HTML` / `Voir PDF` / `Télécharger`.
 */
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Camera, Download, FileText, GitCompareArrows, Loader2, X } from 'lucide-react'

import {
  downloadSnapshotPdf,
  useCreateLivretSnapshot,
} from '@/hooks/useLivretSnapshots'
import { useLivretStore } from '@/stores/useLivretStore'
import type { CompareUiMode, LivretSnapshotMetadata } from '@/types/livret'

interface Props {
  open: boolean
  onClose: () => void
  year: number
  onCreated?: (snapshot: LivretSnapshotMetadata) => void
  onOpenHtml?: (snapshot: LivretSnapshotMetadata) => void
  onOpenPdf?: (snapshot: LivretSnapshotMetadata) => void
}

function yesterdayIso(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function LivretSnapshotDrawer({
  open,
  onClose,
  year,
  onCreated,
  onOpenHtml,
  onOpenPdf,
}: Props) {
  const [asOfDate, setAsOfDate] = useState(yesterdayIso())
  const [comment, setComment] = useState('')
  const [created, setCreated] = useState<LivretSnapshotMetadata | null>(null)
  const createMutation = useCreateLivretSnapshot()
  const liveCompareMode = useLivretStore((s) => s.compareMode)
  // Phase 4 — défaut = mode comparaison du livret courant (cohérent avec ce qu'on voit à l'écran)
  const [includeComparison, setIncludeComparison] = useState<CompareUiMode>(liveCompareMode)

  // Reset à chaque ouverture
  useEffect(() => {
    if (!open) return
    setAsOfDate(yesterdayIso())
    setComment('')
    setCreated(null)
    setIncludeComparison(liveCompareMode)
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose])

  // Date max = aujourd'hui (on n'autorise pas de figer le futur)
  const maxDate = useMemo(() => todayIso(), [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(
      {
        year,
        body: {
          snapshot_type: 'manual',
          as_of_date: asOfDate,
          comment: comment.trim() || null,
          include_comparison: includeComparison === 'none' ? null : includeComparison,
        },
      },
      {
        onSuccess: (snap) => {
          setCreated(snap)
          toast.success(`Snapshot ${snap.id} créé · HTML ${(snap.html_size / 1024).toFixed(0)} Ko · PDF ${(snap.pdf_size / 1024).toFixed(0)} Ko`)
          onCreated?.(snap)
        },
        onError: (err) => {
          toast.error(`Création impossible : ${err.message}`)
        },
      },
    )
  }

  const isLoading = createMutation.isPending

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 right-0 h-full z-50 flex flex-col bg-surface border-l border-border shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: 'min(480px, 95vw)' }}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <Camera size={18} className="text-primary" />
          <div className="flex-1">
            <h3 className="text-base font-semibold text-text">Figer un instantané</h3>
            <p className="text-xs text-text-muted">Exercice {year}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-background transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {!created ? (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text mb-1">
                Date de figeage (YTD au)
              </label>
              <input
                type="date"
                value={asOfDate}
                max={maxDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-background border border-border text-text text-sm focus:outline-none focus:border-primary"
                required
              />
              <p className="text-[11px] text-text-muted mt-1 italic">
                Par défaut : hier — données stables (mois clos non touché entre temps).
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-1">
                Commentaire (optionnel)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="ex. Avant rendez-vous comptable du 12/04…"
                rows={3}
                className="w-full px-3 py-2 rounded-md bg-background border border-border text-text text-sm focus:outline-none focus:border-primary resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-2">
                <GitCompareArrows size={13} className="inline-block mr-1.5" />
                Inclure la comparaison N-1 ?
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { v: 'none', l: 'Aucune' },
                    { v: 'ytd_comparable', l: 'YTD' },
                    { v: 'annee_pleine', l: 'Année pleine' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setIncludeComparison(opt.v)}
                    className={`px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      includeComparison === opt.v
                        ? 'bg-primary text-white border-primary'
                        : 'bg-surface text-text-muted border-border hover:border-text-muted'
                    }`}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-muted mt-1 italic">
                Si actif, le HTML/PDF embarquent les deltas N-1.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-background/50 p-3 text-xs text-text-muted space-y-1">
              <p>• Génère un fichier <code>.html</code> autonome (consultation hors-ligne).</p>
              <p>• Génère un fichier <code>.pdf</code> paginé (~30-60 pages).</p>
              <p>• Enregistre les 2 fichiers dans la GED comme rapport.</p>
              <p>• Génération en 2-5 secondes selon volumétrie.</p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={14} /> Création en cours…
                </>
              ) : (
                <>
                  <Camera size={14} /> Créer l'instantané
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="rounded-lg border border-success/40 bg-success/5 p-4">
              <p className="text-success text-sm font-medium">✓ Snapshot créé avec succès</p>
              <p className="text-xs text-text-muted mt-2 font-mono">{created.id}</p>
              <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                <div className="text-text-muted">HTML : <span className="text-text tabular-nums">{(created.html_size / 1024).toFixed(0)} Ko</span></div>
                <div className="text-text-muted">PDF : <span className="text-text tabular-nums">{(created.pdf_size / 1024).toFixed(0)} Ko</span></div>
              </div>
              {created.large && (
                <p className="text-xs text-warning mt-2 italic">⚠ HTML &gt; 5 Mo — vérifier l'ouverture dans un navigateur lent.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onOpenHtml?.(created)}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors text-sm"
              >
                👁 Voir HTML
              </button>
              <button
                type="button"
                onClick={() => onOpenPdf?.(created)}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors text-sm"
              >
                <FileText size={14} /> Voir PDF
              </button>
            </div>

            <button
              type="button"
              onClick={() => downloadSnapshotPdf(created.id, created.pdf_filename)}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-surface-hover text-text-muted border border-border hover:text-text transition-colors text-sm"
            >
              <Download size={14} /> Télécharger le PDF
            </button>

            <button
              type="button"
              onClick={() => setCreated(null)}
              className="w-full text-xs text-text-muted hover:text-text underline"
            >
              Créer un autre instantané
            </button>
          </div>
        )}
      </div>
    </>
  )
}
