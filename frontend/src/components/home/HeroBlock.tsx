import { useEffect, useState } from 'react'
import { formatDateLong, getGreeting } from '@/lib/utils'

const ROTATION_INTERVAL_MS = 4500
const FADE_DURATION_MS = 350

function buildPhrases(year: number): string[] {
  return [
    'Le BNC se construit ligne par ligne',
    'Belle journée pour pointer les justificatifs',
    "Une compta saine, l'esprit léger",
    `L'exercice ${year} prend forme, doucement`,
    'Chaque opération bien classée, un soulagement gagné',
    "La rigueur d'aujourd'hui, la sérénité de mai",
  ]
}

/**
 * Bloc Hero : greeting + date + phrase rotative.
 *
 * Animation d'entrée :
 * - Greeting : nx-fade 300ms à t=200
 * - Date : nx-fade-up 400ms à t=350
 * - Phrase : nx-fade 300ms à t=750
 *
 * Rotation phrase : toutes les 4500ms avec cross-fade 350ms.
 */
export function HeroBlock() {
  const phrases = buildPhrases(new Date().getFullYear())
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [phraseVisible, setPhraseVisible] = useState(true)

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPhraseVisible(false)
      window.setTimeout(() => {
        setPhraseIndex((i) => (i + 1) % phrases.length)
        setPhraseVisible(true)
      }, FADE_DURATION_MS)
    }, ROTATION_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [phrases.length])

  return (
    <div className="mb-10">
      <div
        className="text-[12px] uppercase tracking-[0.10em] text-text-muted mb-2"
        style={{ opacity: 0, animation: 'nx-fade 300ms ease-out 200ms forwards' }}
      >
        {getGreeting()}
      </div>
      <div
        className="text-[32px] font-medium tracking-tight mb-3 text-text"
        style={{ opacity: 0, animation: 'nx-fade-up 400ms ease-out 350ms forwards' }}
      >
        {formatDateLong()}
      </div>
      <div
        className="text-[14px] italic text-text-muted min-h-[18px]"
        style={{ opacity: 0, animation: 'nx-fade 300ms ease-out 750ms forwards' }}
      >
        <span
          style={{
            opacity: phraseVisible ? 1 : 0,
            transition: `opacity ${FADE_DURATION_MS}ms ease`,
            display: 'inline-block',
          }}
        >
          {phrases[phraseIndex]}
        </span>
      </div>
    </div>
  )
}
