// Moonraker WebSocket JSON-RPC client with automatic reconnect.

export function normalizeHost(v) {
  return String(v || '').trim().replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '').replace(/\/.*$/, '')
}

// Protocol follows the page: https → wss/https, http → ws/http (no mixed content).
// Exception (GitHub Pages demo only, allowLocalInsecure): a printer on the local network has no TLS, so
// private addresses use ws/http — the browser allows it if the user enabled "Insecure content".
let localInsecure = false
export function allowLocalInsecure() { localInsecure = true }
/** Private address: 10.*, 172.16–31.*, 192.168.*, 127.*, localhost, *.local, a dotless name */
export function isLocalHost(host) {
  const h = String(host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === 'localhost' || h.endsWith('.local') || (!!h && !h.includes('.') && !h.includes(':'))
}
const secureFor = host => typeof location !== 'undefined' && location.protocol === 'https:' && !(localInsecure && isLocalHost(host))
export const socketUrl = host => (secureFor(host) ? 'wss://' : 'ws://') + host + '/websocket'
export const httpBase = host => (secureFor(host) ? 'https://' : 'http://') + host
/** Connecting from an https page to a printer without TLS — the browser may block it (mixed content) */
export const mixedContentRisk = host => typeof location !== 'undefined' && location.protocol === 'https:' && localInsecure && isLocalHost(host)

// ---------- printer host selection (no hard-coded addresses) ----------
const HOST_KEY = 'vyron.host'
const OLD_HOST_KEY = 'voronui.host'   // before the rebrand — read until a new one is saved

/** Host saved after a manual connection (empty — connect to the page's host). */
export function savedHost() {
  try { return localStorage.getItem(HOST_KEY) || localStorage.getItem(OLD_HOST_KEY) || '' } catch { return '' }
}

/** Remember a manual host; the page's own host is not saved (it is the default anyway). */
export function rememberHost(host) {
  try {
    localStorage.removeItem(OLD_HOST_KEY)
    if (host && host !== location.host) localStorage.setItem(HOST_KEY, host)
    else localStorage.removeItem(HOST_KEY)
  } catch { /* private mode */ }
}

/**
 * Host to auto-connect to:
 *   ?host=ip:port → saved in localStorage → VITE_PRINTER_HOST → the host serving the page
 *   (on the printer that is nginx/Moonraker itself, in dev the Vite proxy). Opened as a file — empty
 *   (the address is entered by hand; no hard-coded addresses).
 */
export function resolveHost() {
  const q = new URLSearchParams(location.search).get('host')
  if (q) return normalizeHost(q)
  const s = savedHost()
  if (s) return normalizeHost(s)
  const env = import.meta.env.VITE_PRINTER_HOST
  if (env) return normalizeHost(env)
  return location.protocol.startsWith('http') && location.host ? location.host : ''
}

export class RpcError extends Error {}

/** Connection watchdog: silence before sending a ping, and the time to answer before dropping (ms). */
const WATCH_IDLE = 8000, WATCH_GRACE = 6000

/**
 * handlers:
 *  onState(state, info)  — 'connecting' | 'open' | 'error' | 'lost' | 'addrError'
 *  onNotify(method, params)
 *  onRpcError(message)
 *  onInvalid()           — invalid JSON from the server
 */
export class MoonrakerClient {
  constructor(handlers) {
    this.h = handlers
    this.ws = null
    this.host = null
    this.rid = 10
    this.pending = new Map()
    this.reconnectTimer = null
    this.reconnectDelay = 1500
    this.intentional = false
    this.lastMsg = 0
    this.pingAt = 0
    this.watchdog = null
  }

  get connected() {
    return !!this.ws && this.ws.readyState === 1
  }

  connect(host) {
    this.close()
    this.intentional = false
    this.host = host
    this.reconnectDelay = 1500
    this._open()
  }

  close() {
    this.intentional = true
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this._stopWatchdog()
    if (this.ws) {
      this.ws.onclose = null
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }
    this._rejectAll()
  }

  /** Call and wait for the answer. Rejects on an RPC error or without a connection. */
  call(method, params = {}) {
    if (!this.connected) return Promise.reject(new Error('WebSocket is not connected'))
    const id = ++this.rid
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
    })
  }

  /** Fire-and-forget call: the answer is ignored (G-code errors arrive via notify_gcode_response). */
  fire(method, params = {}) {
    if (!this.connected) return false
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id: ++this.rid }))
    return true
  }

  _open() {
    const host = this.host
    this.h.onState('connecting', { host })
    let ws
    try { ws = new WebSocket(socketUrl(host)) } catch (e) {
      this.h.onState('addrError', { host, message: e.message })
      return
    }
    this.ws = ws
    ws.onopen = () => { this.reconnectDelay = 1500; this._startWatchdog(ws); this.h.onState('open', { host }) }
    ws.onmessage = ev => { this.lastMsg = Date.now(); this.pingAt = 0; this._message(ev) }
    ws.onerror = () => this.h.onState('error', { host })
    ws.onclose = () => this._lost(ws, host)
  }

  /** Connection lost: reject pending calls, report the state and reconnect with growing back-off. */
  _lost(ws, host) {
    if (this.ws !== ws) return
    this.ws = null
    this._stopWatchdog()
    this._rejectAll()
    if (this.intentional) return
    this.h.onState('lost', { host })
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      if (!this.intentional && this.host === host) this._open()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(15000, this.reconnectDelay * 1.7)
  }

  // Half-dead connection watchdog. When Wi-Fi drops without closing TCP, the socket stays open for minutes:
  // the UI shows frozen data as live and calls hang. Moonraker sends notify_proc_stat_update every second,
  // so after WATCH_IDLE ms of silence we ask server.info; if nothing arrives within WATCH_GRACE ms the link is dead.
  // The ping counts from when it was sent, so after a laptop wakes up we check first instead of dropping at once.
  _startWatchdog(ws) {
    this._stopWatchdog()
    this.lastMsg = Date.now()
    this.pingAt = 0
    this.watchdog = setInterval(() => {
      if (this.ws !== ws || ws.readyState !== 1) return
      const now = Date.now()
      if (this.pingAt) {
        if (now - this.pingAt > WATCH_GRACE) {
          ws.onclose = null
          try { ws.close() } catch { /* ignore */ }
          this._lost(ws, this.host)
        }
      } else if (now - this.lastMsg > WATCH_IDLE) {
        this.pingAt = now
        try { ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'server.info', params: {}, id: ++this.rid })) } catch { /* ignore */ }
      }
    }, 2000)
  }

  _stopWatchdog() {
    clearInterval(this.watchdog)
    this.watchdog = null
    this.pingAt = 0
  }

  _message(ev) {
    let d
    try { d = JSON.parse(ev.data) } catch { this.h.onInvalid?.(); return }
    if (d.id != null && this.pending.has(d.id)) {
      const p = this.pending.get(d.id)
      this.pending.delete(d.id)
      if (d.error) {
        const msg = d.error.message || 'RPC error'
        this.h.onRpcError?.(msg)
        p.reject(new RpcError(msg))
      } else p.resolve(d.result)
      return
    }
    if (d.method) this.h.onNotify(d.method, d.params || [])
  }

  _rejectAll() {
    for (const p of this.pending.values()) p.reject(new Error('closed'))
    this.pending.clear()
  }
}
