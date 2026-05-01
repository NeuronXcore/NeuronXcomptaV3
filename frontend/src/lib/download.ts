/**
 * Helpers de téléchargement blob (forcer le download d'une URL existante).
 * Utilisé par le module Livret (Phase 3) pour les snapshots HTML/PDF — pas de
 * paramètre `?download=true` côté serveur, on reste pur frontend.
 */

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Petit délai avant revoke pour laisser le navigateur initier le download
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadFromUrl(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) {
    throw new Error(`Téléchargement impossible (HTTP ${res.status})`)
  }
  const blob = await res.blob()
  triggerBlobDownload(blob, filename)
}
