export default function SidebarLogo() {
  return (
    <div className="flex flex-col items-center gap-2.5 cursor-default">
      {/* Logo + electric frame */}
      <div className="relative w-16 h-16">
        {/* Electric border — animated SVG frame */}
        <svg
          className="absolute -inset-3 w-[calc(100%+24px)] h-[calc(100%+24px)]"
          viewBox="0 0 88 88"
          fill="none"
        >
          {/* Outer electric arc — bright */}
          <rect
            x="4" y="4" width="80" height="80" rx="18"
            stroke="url(#electric-grad)"
            strokeWidth="2.2"
            strokeDasharray="8 4 2 4"
            className="animate-electric-dash"
            filter="url(#electric-blur)"
          />
          {/* Middle arc — counter-rotate */}
          <rect
            x="8" y="8" width="72" height="72" rx="15"
            stroke="url(#electric-grad2)"
            strokeWidth="1.2"
            strokeDasharray="5 8 3 8"
            className="animate-electric-dash-reverse"
            filter="url(#electric-blur-soft)"
          />
          {/* Inner shimmer — fast */}
          <rect
            x="12" y="12" width="64" height="64" rx="12"
            stroke="url(#electric-grad3)"
            strokeWidth="0.6"
            strokeDasharray="3 6"
            className="animate-electric-dash-fast"
            opacity="0.7"
          />
          {/* Corner sparks */}
          <circle cx="13" cy="13" r="2" className="animate-electric-spark-1" fill="#67e8f9" filter="url(#spark-glow)" />
          <circle cx="75" cy="13" r="2" className="animate-electric-spark-2" fill="#38bdf8" filter="url(#spark-glow)" />
          <circle cx="13" cy="75" r="2" className="animate-electric-spark-3" fill="#38bdf8" filter="url(#spark-glow)" />
          <circle cx="75" cy="75" r="2" className="animate-electric-spark-4" fill="#67e8f9" filter="url(#spark-glow)" />
          {/* Mid-edge sparks */}
          <circle cx="44" cy="5" r="1.5" className="animate-electric-spark-5" fill="#a5f3fc" filter="url(#spark-glow)" />
          <circle cx="83" cy="44" r="1.5" className="animate-electric-spark-6" fill="#a5f3fc" filter="url(#spark-glow)" />
          <circle cx="44" cy="83" r="1.5" className="animate-electric-spark-7" fill="#a5f3fc" filter="url(#spark-glow)" />
          <circle cx="5" cy="44" r="1.5" className="animate-electric-spark-8" fill="#a5f3fc" filter="url(#spark-glow)" />
          <defs>
            <linearGradient id="electric-grad" x1="0" y1="0" x2="88" y2="88">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="25%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#818cf8" />
              <stop offset="75%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
            <linearGradient id="electric-grad2" x1="88" y1="0" x2="0" y2="88">
              <stop offset="0%" stopColor="#67e8f9" />
              <stop offset="50%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#67e8f9" />
            </linearGradient>
            <linearGradient id="electric-grad3" x1="0" y1="44" x2="88" y2="44">
              <stop offset="0%" stopColor="#a5f3fc" />
              <stop offset="100%" stopColor="#c4b5fd" />
            </linearGradient>
            <filter id="electric-blur">
              <feGaussianBlur stdDeviation="1.2" />
            </filter>
            <filter id="electric-blur-soft">
              <feGaussianBlur stdDeviation="0.6" />
            </filter>
            <filter id="spark-glow">
              <feGaussianBlur stdDeviation="2" />
            </filter>
          </defs>
        </svg>

        {/* Expanding ring pulse — bright cyan */}
        <div className="absolute inset-0 rounded-2xl bg-cyan-400/25 animate-logo-ring" />

        {/* Soft glow pulse — strong */}
        <div className="absolute -inset-3 rounded-2xl bg-cyan-400/15 blur-2xl animate-logo-glow" />

        {/* Logo image — permanent breathe */}
        <img
          src="/logo_mark_dark.svg"
          alt="NeuronXcompta"
          className="relative w-16 h-16 drop-shadow-[0_0_14px_#22d3ee] animate-logo-breathe"
        />

        {/* Orbiting dot — electric blue bright */}
        <div className="absolute w-2 h-2 rounded-full bg-cyan-300 shadow-[0_0_12px_#22d3ee,0_0_24px_#0ea5e9] animate-logo-orbit" />
      </div>

      {/* Text — centered below logo */}
      <div className="text-center">
        <h1 className="text-lg font-bold leading-tight tracking-tight">
          <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
            NeuronX
          </span>
          <span className="text-text">compta</span>
        </h1>
        <p className="text-[10px] text-text-muted opacity-60">
          Assistant Comptable IA
        </p>
      </div>
    </div>
  )
}
