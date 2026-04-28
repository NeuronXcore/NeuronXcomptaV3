/**
 * Aurora signature : 3 blobs en `radial-gradient` à très faible opacité, dérivant lentement.
 *
 * - Couleurs hardcodées (signature, validées en mockup) — ne pas remplacer par CSS vars.
 * - Pas de `filter: blur()` : la diffusion vient du gradient lui-même
 *   (couleur centre 0% → couleur × 0.3 à 35% → transparent à 65%).
 * - `pointer-events: none` pour ne pas bloquer les clics sur le contenu.
 */
const BLOBS = [
  {
    color: 'rgba(127,119,221,0.32)',
    fade: 'rgba(127,119,221,0.10)',
    style: { top: '-15%', left: '5%', width: '55%', height: '75%' },
    animation: 'nx-aurora-1 24s ease-in-out infinite alternate',
  },
  {
    color: 'rgba(93,202,165,0.20)',
    fade: 'rgba(93,202,165,0.06)',
    style: { bottom: '-25%', right: '0%', width: '55%', height: '70%' },
    animation: 'nx-aurora-2 28s ease-in-out infinite alternate',
  },
  {
    color: 'rgba(239,159,39,0.16)',
    fade: 'rgba(239,159,39,0.05)',
    style: { top: '30%', right: '18%', width: '38%', height: '50%' },
    animation: 'nx-aurora-3 32s ease-in-out infinite alternate',
  },
] as const

export function AuroraBackground() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      {BLOBS.map((b, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            ...b.style,
            background: `radial-gradient(closest-side, ${b.color} 0%, ${b.fade} 35%, transparent 65%)`,
            animation: b.animation,
            willChange: 'transform',
          }}
        />
      ))}
    </div>
  )
}
