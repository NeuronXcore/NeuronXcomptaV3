import { useEffect, useRef, useState } from 'react'

interface UseCountUpOptions {
  from?: number
  to: number
  duration?: number      // ms
  delay?: number         // ms
  enabled?: boolean      // si false, retourne directement `to`
}

/**
 * Compteur animé via requestAnimationFrame avec cleanup propre à l'unmount.
 *
 * Retourne toujours un entier (Math.round) pour éviter les glitchs `71.99999`.
 * Easing : easeOutCubic (`1 - (1-t)^3`).
 */
export function useCountUp({
  from = 0,
  to,
  duration = 1000,
  delay = 0,
  enabled = true,
}: UseCountUpOptions): number {
  const [value, setValue] = useState<number>(enabled ? from : to)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setValue(to)
      return
    }

    setValue(from)
    startRef.current = null

    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now
      const elapsed = now - startRef.current
      const t = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      const current = from + (to - from) * eased
      setValue(Math.round(current))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    timeoutRef.current = window.setTimeout(() => {
      rafRef.current = requestAnimationFrame(tick)
    }, delay)

    return () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [from, to, duration, delay, enabled])

  return value
}
