import { useState } from 'react'

const LOGO_SRC = '/assets/logo_lockup_dark_400.png'

/**
 * Logo + wordmark "NeuronXcompta" servi depuis le backend (`/assets/logo_lockup_dark_400.png`).
 *
 * Chorégraphie d'entrée (one-shot) + halo persistant subtil :
 *
 *  t=0     300ms  `nx-logo-enter`   — opacity 0→1, scale 0.96→1 sur le logo
 *  t=100   1100ms `nx-halo-burst`   — halo violet qui éclate derrière le logo
 *  t=400   1100ms `nx-shimmer`      — sweep diagonal gauche → droite (gradient 105°)
 *  t=1350  900ms  `nx-shimmer-back` — sweep diagonal droite → gauche (gradient 255°)
 *  t=1500  ∞      `nx-halo-breathe` — halo qui respire lentement (loop)
 *
 * Les shimmers sont clippés à la silhouette du logo via `mask-image` sur le
 * wrapper masqué — ils ne débordent jamais sur le rectangle. Les halos sont
 * SOEURS du wrapper masqué (positionnés derrière, z-index < logo) pour pouvoir
 * s'étendre au-delà de la silhouette.
 *
 * Si le logo échoue à charger, fallback sur un texte stylisé.
 */
export function LogoLockup() {
  const [imageError, setImageError] = useState(false)

  if (imageError) {
    return (
      <div
        className="inline-flex items-center text-text font-medium tracking-tight text-2xl"
        style={{
          opacity: 0,
          animation: 'nx-logo-enter 300ms ease-out 0ms forwards',
          marginBottom: 28,
        }}
      >
        NeuronXcompta
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 32, position: 'relative', display: 'inline-block' }}>
      {/* Halo burst — éclat violet à l'entrée (one-shot) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: '160%',
          height: '260%',
          transform: 'translate(-50%, -50%) scale(0.55)',
          background: 'radial-gradient(ellipse at center, rgba(127,119,221,0.55) 0%, rgba(127,119,221,0.22) 35%, transparent 70%)',
          filter: 'blur(8px)',
          opacity: 0,
          animation: 'nx-halo-burst 1100ms cubic-bezier(0.22, 0.9, 0.42, 1) 100ms 1 forwards',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      {/* Halo breathe — respiration lente persistante (loop, démarre à t=1500ms) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: '125%',
          height: '200%',
          transform: 'translate(-50%, -50%) scale(1)',
          transformOrigin: 'center',
          background: 'radial-gradient(ellipse at center, rgba(127,119,221,0.20) 0%, rgba(127,119,221,0.08) 40%, transparent 70%)',
          filter: 'blur(6px)',
          opacity: 0,
          animation: 'nx-halo-breathe 4500ms ease-in-out 1500ms infinite',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      {/* Logo masqué + 2 shimmers — clippés à la silhouette via mask-image */}
      <div
        className="nx-logo-wrap"
        style={{
          position: 'relative',
          display: 'inline-block',
          height: 64,
          opacity: 0,
          animation: 'nx-logo-enter 300ms ease-out 0ms forwards',
          zIndex: 1,
          WebkitMaskImage: `url('${LOGO_SRC}')`,
          WebkitMaskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'left center',
          maskImage: `url('${LOGO_SRC}')`,
          maskSize: 'contain',
          maskRepeat: 'no-repeat',
          maskPosition: 'left center',
        }}
      >
        <img
          src={LOGO_SRC}
          alt="NeuronXcompta"
          onError={() => setImageError(true)}
          style={{
            display: 'block',
            height: '100%',
            width: 'auto',
            pointerEvents: 'none',
          }}
        />
        {/* Shimmer #1 — gauche → droite */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(105deg, transparent 0%, transparent 35%, rgba(255,255,255,0.60) 50%, transparent 65%, transparent 100%)',
            transform: 'translateX(-100%)',
            animation: 'nx-shimmer 1100ms ease-out 400ms 1 forwards',
            pointerEvents: 'none',
          }}
        />
        {/* Shimmer #2 — droite → gauche, gradient miroir (255° = 105° mirroré) */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(255deg, transparent 0%, transparent 35%, rgba(255,255,255,0.45) 50%, transparent 65%, transparent 100%)',
            transform: 'translateX(100%)',
            animation: 'nx-shimmer-back 900ms ease-out 1350ms 1 forwards',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  )
}
