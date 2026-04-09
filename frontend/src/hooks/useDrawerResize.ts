import { useState, useCallback, useRef } from 'react'

interface UseDrawerResizeOptions {
  defaultWidth: number
  minWidth?: number
  maxWidth?: number
  storageKey?: string
}

export function useDrawerResize({
  defaultWidth,
  minWidth = 400,
  maxWidth = 1200,
  storageKey,
}: UseDrawerResizeOptions) {
  const [width, setWidth] = useState(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const n = parseInt(stored, 10)
        if (n >= minWidth && n <= maxWidth) return n
      }
    }
    return defaultWidth
  })
  const isResizing = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const startX = e.clientX
    const startWidth = width

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const delta = startX - ev.clientX
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta))
      setWidth(newWidth)
      if (storageKey) localStorage.setItem(storageKey, String(newWidth))
    }

    const handleMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [width, minWidth, maxWidth, storageKey])

  return { width, handleMouseDown }
}
