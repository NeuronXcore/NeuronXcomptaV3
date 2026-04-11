import { useEffect, useRef, useState, useCallback, createElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import SandboxArrivalToast from '@/components/shared/SandboxArrivalToast'

export interface SandboxEvent {
  filename: string
  status: string
  timestamp: string
  auto_renamed?: boolean
  original_filename?: string | null
  supplier?: string | null
  best_date?: string | null
  best_amount?: number | null
}

// Navigation via history API directe (pas useNavigate) pour éviter d'introduire
// des hooks supplémentaires dans useSandbox — changer le nombre de hooks cassait
// la règle des hooks pour AppLayout qui est re-rendu à chaque navigation.
function navigateToHistorique(filename: string) {
  const url = `/ocr?tab=historique&sort=scan_date&highlight=${encodeURIComponent(filename)}`
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// Affichage du toast global d'arrivée — déclaré hors du hook pour stabilité.
function showArrivalToast(data: SandboxEvent) {
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
        onClickOpen: () => navigateToHistorique(data.filename),
      }),
    { duration: 6000, position: 'top-right' },
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
        setLastEvent(data)
        // Invalider les queries pour rafraîchir les listes
        queryClient.invalidateQueries({ queryKey: ['justificatifs'] })
        queryClient.invalidateQueries({ queryKey: ['justificatif-stats'] })
        queryClient.invalidateQueries({ queryKey: ['ocr-history'] })

        // Toast riche pour les events "processed" (nouveau fichier traité avec succès)
        if (data.status === 'processed') {
          showArrivalToast(data)
        } else if (data.status === 'error') {
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
