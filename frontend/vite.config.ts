import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Proxy backend target configurable via env `VITE_API_URL`.
// - `./start.sh` laisse la valeur par défaut → http://127.0.0.1:8000
// - preview Claude (`.claude/launch.json`) fixe VITE_API_URL=http://127.0.0.1:8100
//   pour cohabiter avec l'app principale sur 5173/8000 sans conflit.
const apiTarget = process.env.VITE_API_URL || 'http://127.0.0.1:8000'
const wsTarget = apiTarget.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: wsTarget,
        ws: true,
      },
    },
  },
})
