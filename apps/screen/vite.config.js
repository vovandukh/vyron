import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

const r = p => fileURLToPath(new URL(p, import.meta.url))

// Moonraker proxy for development — as in Vyron Web. Printer address: PRINTER_URL in apps/screen/.env.local
// (not in git) or in the environment; otherwise localhost:7125.
const moonrakerProxy = PRINTER => ({
  target: PRINTER,
  changeOrigin: true,
  ws: true,
  configure: proxy => {
    proxy.on('proxyReq', req => req.setHeader('origin', PRINTER))
    proxy.on('proxyReqWs', req => req.setHeader('origin', PRINTER))
  }
})

// Development: device pages from demo/ (TFT35 frame with state and colour switches) — /demo/tft35.html.
// Inside the frame (../screen.html?state=…) the dev build of Screen runs with hot reload.
const demoPages = () => ({
  name: 'vyron-demo-pages',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const m = /^\/demo\/([\w-]+\.html)/.exec(req.url || '')
      if (!m) return next()
      try { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(await readFile(r('./demo/' + m[1]))) } catch { next() }
    })
  }
})

// Single-file build: on the printer nginx serves one screen.html (CI puts it in the repository root).
export default defineConfig(({ mode }) => {
  const PRINTER = process.env.PRINTER_URL || loadEnv(mode, r('.'), '').PRINTER_URL || 'http://localhost:7125'
  const moonraker = moonrakerProxy(PRINTER)
  return {
    root: r('./src'),
    envDir: r('.'),
    cacheDir: r('./node_modules/.vite'),
    base: './',
    plugins: [vue(), viteSingleFile(), demoPages()],
    server: {
      port: 5200,
      proxy: Object.fromEntries(['/websocket', '/printer', '/server', '/machine', '/api'].map(p => [p, moonraker]))
    },
    // mode 'demo' — GitHub Pages build (the screen in demo mode) in dist-demo/
    build: { outDir: r(mode === 'demo' ? './dist-demo' : './dist'), emptyOutDir: true }
  }
})
