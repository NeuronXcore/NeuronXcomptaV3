import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

interface SandboxEvent {
  filename: string
  status: string
  timestamp: string
  auto_renamed?: boolean
  original_filename?: string | null
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
