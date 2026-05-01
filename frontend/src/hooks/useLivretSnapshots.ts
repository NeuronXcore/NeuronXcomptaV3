/**
 * Hooks TanStack Query pour les snapshots du Livret comptable (Phase 3).
 *
 * Endpoints consommés (cf. backend/routers/livret.py) :
 *   - GET /api/livret/snapshots[?year=]
 *   - POST /api/livret/snapshots/{year}
 *   - GET /api/livret/snapshots/{snapshot_id}
 *   - GET /api/livret/snapshots/{snapshot_id}/html (inline pour iframe)
 *   - GET /api/livret/snapshots/{snapshot_id}/pdf (inline pour <object>)
 *   - DELETE /api/livret/snapshots/{snapshot_id}[?force=true]
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/api/client'
import { downloadFromUrl } from '@/lib/download'
import type {
  CreateSnapshotRequest,
  LivretSnapshotMetadata,
  SnapshotsListResponse,
} from '@/types/livret'

// ─── URL builders (utilisés par les drawers iframe / object) ────

export function snapshotHtmlUrl(snapshotId: string): string {
  return `/api/livret/snapshots/${encodeURIComponent(snapshotId)}/html`
}

export function snapshotPdfUrl(snapshotId: string): string {
  return `/api/livret/snapshots/${encodeURIComponent(snapshotId)}/pdf`
}

// ─── Téléchargements forcés (blob URL + lien <a download>) ──────

export async function downloadSnapshotHtml(
  snapshotId: string,
  filename?: string,
): Promise<void> {
  await downloadFromUrl(snapshotHtmlUrl(snapshotId), filename || `${snapshotId}.html`)
}

export async function downloadSnapshotPdf(
  snapshotId: string,
  filename?: string,
): Promise<void> {
  await downloadFromUrl(snapshotPdfUrl(snapshotId), filename || `${snapshotId}.pdf`)
}

// ─── Hooks ────────────────────────────────────────────────────────

export function useLivretSnapshots(year?: number) {
  const qs = year !== undefined ? `?year=${year}` : ''
  return useQuery<SnapshotsListResponse>({
    queryKey: ['livret-snapshots', year ?? null],
    queryFn: () => api.get<SnapshotsListResponse>(`/livret/snapshots${qs}`),
    staleTime: 30_000,
  })
}

export function useLivretSnapshot(snapshotId: string | null) {
  return useQuery<LivretSnapshotMetadata>({
    queryKey: ['livret-snapshot', snapshotId],
    queryFn: () => api.get<LivretSnapshotMetadata>(`/livret/snapshots/${snapshotId}`),
    enabled: !!snapshotId,
  })
}

export function useCreateLivretSnapshot() {
  const qc = useQueryClient()
  return useMutation<LivretSnapshotMetadata, Error, { year: number; body?: CreateSnapshotRequest }>({
    mutationFn: ({ year, body }) =>
      api.post<LivretSnapshotMetadata>(
        `/livret/snapshots/${year}`,
        body ?? { snapshot_type: 'manual' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['livret-snapshots'] })
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
    },
  })
}

export function useDeleteLivretSnapshot() {
  const qc = useQueryClient()
  return useMutation<{ deleted: boolean }, Error, { id: string; force?: boolean }>({
    mutationFn: ({ id, force }) => {
      const qs = force ? '?force=true' : ''
      return api.delete<{ deleted: boolean }>(`/livret/snapshots/${id}${qs}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['livret-snapshots'] })
      qc.invalidateQueries({ queryKey: ['ged-documents'] })
      qc.invalidateQueries({ queryKey: ['ged-tree'] })
    },
  })
}
