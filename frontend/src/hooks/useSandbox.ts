import { useEffect, useRef, useState, useCallback, createElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import SandboxArrivalToast from '@/components/shared/SandboxArrivalToast'

export interface SandboxOperationRef {
  file?: string | null
  index?: number | null
  ventilation_index?: number | null
  libelle?: string | null
  date?: string | null
  montant?: number | null
  locked?: boolean
  score?: number | null
}

export interface SandboxEvent {
  event_id?: string
  filename: string
  status: string
  timestamp: string
  auto_renamed?: boolean
  original_filename?: string | null
  supplier?: string | null
  best_date?: string | null
  best_amount?: number | null
  auto_associated?: boolean
  operation_ref?: SandboxOperationRef | null
  replayed?: boolean
}

// Dédup globale des events affichés (survit aux reconnects EventSource).
// Clé = event_id (stable entre push live backend et rejeu disque).
const SEEN_EVENT_IDS = new Set<string>()
const SEEN_IDS_MAX = 200

// Map sandbox filename → loading toast id, pour dismiss lors du "processed"
const SCANNING_TOASTS = new Map<string, string>()

// Navigation via history API directe (pas useNavigate) pour éviter d'introduire
// des hooks supplémentaires dans useSandbox — changer le nombre de hooks cassait
// la règle des hooks pour AppLayout qui est re-rendu à chaque navigation.
function navigateTo(url: string) {
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// Toast « arrivée » léger, affiché dès la détection sandbox (avant OCR).
// Auto-dismissé quand le toast riche "processed" prend sa place.
function showScanningToast(data: SandboxEvent) {
  const sandboxName = data.original_filename || data.filename
  const tid = toast.loading(
    `Analyse en cours… ${sandboxName}`,
    {
      duration: 60000, // filet de sécurité si le processed n'arrive jamais
      position: 'top-right',
      style: {
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
        fontSize: '13px',
        maxWidth: '360px',
      },
    },
  )
  SCANNING_TOASTS.set(sandboxName, tid)
}

function dismissScanningToast(data: SandboxEvent) {
  const sandboxName = data.original_filename || data.filename
  const tid = SCANNING_TOASTS.get(sandboxName)
  if (tid) {
    toast.dismiss(tid)
    SCANNING_TOASTS.delete(sandboxName)
  }
}

// Affichage du toast global d'arrivée — déclaré hors du hook pour stabilité.
function showArrivalToast(data: SandboxEvent) {
  const autoAssociated = !!data.auto_associated && !!data.operation_ref
  const opRef = data.operation_ref ?? null
  const onClickOpen = () => {
    if (autoAssociated && opRef?.file != null && opRef?.index != null) {
      navigateTo(
        `/justificatifs?file=${encodeURIComponent(opRef.file)}&highlight=${opRef.index}&filter=avec`,
      )
    } else {
      navigateTo(
        `/ocr?tab=historique&sort=scan_date&highlight=${encodeURIComponent(data.filename)}`,
      )
    }
  }
  toast.custom(
    (t) =>
      createElement(SandboxArrivalToast, {
        toastId: t.id,
        visible: t.visible,
        filename: data.filename,
        supplier: data.supplier,
        bestDate: data.best_date,
        bestAmount: data.best_amount,
        autoRenamed: data.auto_renamed,
        originalFilename: data.original_filename,
        autoAssociated,
        operationLibelle: opRef?.libelle ?? null,
        operationDate: opRef?.date ?? null,
        operationMontant: opRef?.montant ?? null,
        operationLocked: !!opRef?.locked,
        onClickOpen,
      }),
    { duration: Infinity, position: 'top-right' },
  )
}

export function useSandbox() {
  const [lastEvent, setLastEvent] = useState<SandboxEvent | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const queryClient = useQueryClient()

  const connect = useCallback(() => {
    if (eventSourceRef.current) return

    const es = new EventSource('/api/sandbox/events')
    eventSourceRef.current = es

    es.onopen = () => {
      setIsConnected(true)
    }

    es.onmessage = (event) => {
      try {
        const data: SandboxEvent = JSON.parse(event.data)
        // Le premier message "connected" confirme la connexion SSE
        if (data.status === 'connected') {
          setIsConnected(true)
          return
        }
        // Dédup via event_id : évite de re-afficher un toast sur rejeu (reconnect / reload)
        const eid = data.event_id ?? `${data.filename}@${data.timestamp}`
        if (SEEN_EVENT_IDS.has(eid)) return
        SEEN_EVENT_IDS.add(eid)
        if (SEEN_EVENT_IDS.size > SEEN_IDS_MAX) {
          // Purge FIFO pour borner la mémoire
          const first = SEEN_EVENT_IDS.values().next().value
          if (first) SEEN_EVENT_IDS.delete(first)
        }

        setLastEvent(data)
        // Invalider les queries pour rafraîchir les listes
        queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
        queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
        queryClient.invalidateQueries({ queryKey: ['ocr-history'] })

        // Toast riche pour les events "processed" (nouveau fichier traité avec succès)
        if (data.status === 'scanning') {
          // Ne pas rejouer les toasts « scanning » sur reconnect — trop court-vivant,
          // le processed correspondant sera rejoué séparément (et c'est lui qui compte).
          if (!data.replayed) showScanningToast(data)
        } else if (data.status === 'processed') {
          dismissScanningToast(data)
          showArrivalToast(data)
        } else if (data.status === 'error') {
          dismissScanningToast(data)
          toast.error(`Erreur OCR : ${data.filename}`, { duration: 4000 })
        }
      } catch {
        // Ignorer les erreurs de parsing (ping, etc.)
      }
    }

    es.onerror = () => {
      setIsConnected(false)
      es.close()
      eventSourceRef.current = null
      // Reconnexion après 5s
      setTimeout(connect, 5000)
    }
  }, [queryClient])

  useEffect(() => {
    connect()
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [connect])

  return { lastEvent, isConnected }
}
