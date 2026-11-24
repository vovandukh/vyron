import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'

const r = p => fileURLToPath(new URL(p, import.meta.url))


// Moonraker proxy: in dev the app talks to its own host (localhost:5173) and Vite forwards the API
// and WebSocket to the printer. Origin is rewritten to the printer's address so Moonraker doesn't
// reject localhost requests via cors_domains.
const moonrakerProxy = PRINTER => ({
  target: PRINTER,
  changeOrigin: true,
  ws: true,
  configure: proxy => {
    proxy.on('proxyReq', req => req.setHeader('origin', PRINTER))
    proxy.on('proxyReqWs', req => req.setHeader('origin', PRINTER))
  }
})

// The source index.html lives in src/, not the root: in main the repository root holds the built
// static files (index.html + assets/) that CI copies from dist/.
// mode 'demo' (npm run build:demo): GitHub Pages build in dist-demo/, starts straight in the demo (.env.demo).
// Printer for the dev proxy: PRINTER_URL in the environment or in .env.local (not in git):
//   PRINTER_URL=http://<printer-ip>:7125
// Without it — Moonraker on this machine (localhost:7125). No hard-coded addresses in the repository.
export default defineConfig(({ mode }) => {
  const PRINTER = process.env.PRINTER_URL || loadEnv(mode, r('.'), '').PRINTER_URL || 'http://localhost:7125'
  const moonraker = moonrakerProxy(PRINTER)
  return {
    root: r('./src'),
    envDir: r('.'),          // .env.local etc. are read from the project root
    cacheDir: r('./node_modules/.vite'),
    base: './',              // relative paths: the static files can be served from any nginx folder
    // viteSingleFile: all JS, CSS and images are inlined into one index.html — nginx on the printer
    // can serve just this file, without an assets/ folder.
    plugins: [vue(), viteSingleFile()],
    server: {
      proxy: Object.fromEntries(['/websocket', '/printer', '/server', '/machine', '/api'].map(p => [p, moonraker]))
    },
    build: {
      outDir: r(mode === 'demo' ? './dist-demo' : './dist'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 800
    }
  }
})
