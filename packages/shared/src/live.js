// Live updates without reloading the page — shared by Vyron Web and Vyron Screen.
//
// 1. watchDesign: a theme changed on another device applies here within seconds. Every interval we read only
//    the design timestamp (one number) from the Moonraker database; the full design only when it changed.
//    With Vyron Core running the notification is instant and this polling is just a fallback.
// 2. watchBuild: a new UI build landed on the printer (Update Manager) — the page reloads quietly
//    while nobody is using it (canReload + a few seconds without touches).
//    Seamless: a cross-document View Transition keeps a snapshot of the old page until the new one has
//    connected and shows data (revealReady), then fades it out. Without support — a plain page swap.

/**
 * The new page is ready (connected and showing data) — release the old page's snapshot.
 * The snapshot itself is held by a script in index.html's <head> (pagereveal event; 4 s limit).
 */
const held = []
const HOLD_MAX = 2500

/**
 * The open page is still loading its own data (update list, config files…) — the old snapshot
 * is held until the promise settles (at most HOLD_MAX) so an empty page never shows.
 */
export function holdReveal(p) {
  if (!window.__vyronReady && p && typeof p.then === 'function') held.push(p)
  return p
}

export async function revealReady() {
  if (window.__vyronReady) return
  // Give the page a moment to start its own requests, then wait for them
  await new Promise(r => setTimeout(r, 50))
  if (held.length) await Promise.race([Promise.allSettled(held), new Promise(r => setTimeout(r, HOLD_MAX))])
  // One more frame so the fetched data gets painted under the snapshot
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  window.__vyronReady = true
  if (window.__vyronPlay) window.__vyronPlay()
  // Drop the version marker from the URL
  const u = new URL(location.href)
  if (u.searchParams.has('_v')) { u.searchParams.delete('_v'); history.replaceState(history.state, '', u.href) }
}

import { dbGet } from './moonraker/db.js'

const DESIGN_UPDATED = { namespace: 'vyron_ui', key: 'design.updated' }

/** @returns stop function */
export function watchDesign({ call, getUpdated, onChange, interval = 3000, visibleOnly = true }) {
  let timer = 0, stopped = false, busy = false
  const shown = () => !visibleOnly || !document.hidden
  async function tick() {
    if (stopped) return
    if (shown() && !busy) {
      busy = true
      try {
        const u = Number(await dbGet(call, DESIGN_UPDATED.namespace, DESIGN_UPDATED.key)) || 0
        if (u && u !== getUpdated()) await onChange(u)
      } catch { /* nobody has saved a design yet */ } finally { busy = false }
    }
    if (!stopped) timer = setTimeout(tick, interval)
  }
  const onVis = () => { if (!document.hidden && !stopped) { clearTimeout(timer); tick() } }
  document.addEventListener('visibilitychange', onVis)
  timer = setTimeout(tick, interval)
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis) }
}

const IDLE_MS = 4000
let kick = () => {}

/**
 * Vyron Core events (notify_agent_event), shared by Web and Screen.
 * ui_updated — new build: check right away. design_changed — passed to onDesign(updated).
 * @returns true if the event was handled
 */
export function handleCoreEvent(e, { onDesign } = {}) {
  if (!e || e.agent !== 'vyron-core') return false
  if (e.event === 'ui_updated') { kick(); return true }
  if (e.event === 'design_changed' && onDesign) { onDesign((e.data || {}).updated); return true }
  return false
}

/**
 * @param {{ canReload?: () => boolean, beforeReload?: () => void, interval?: number,
 *   idle?: number | (() => number), visibleOnly?: boolean }} o
 * idle — ms without touches before reloading. visibleOnly: false — for the printer screen (kiosk):
 * a browser without a window manager may consider the page hidden although it is always on screen.
 * @returns stop function
 */
export function watchBuild({ canReload = () => true, beforeReload = () => {}, interval = 20000, idle = IDLE_MS, visibleOnly = true } = {}) {
  const shown = () => !visibleOnly || !document.hidden
  const idleMs = () => (typeof idle === 'function' ? idle() : idle)
  // In development vite (HMR) reloads the page; from disk (file://) there is nothing to check
  if (import.meta.env.DEV || !location.protocol.startsWith('http')) return () => {}
  const url = location.pathname || '/'
  let tag = null, timer = 0, pending = false, stopped = false
  let lastInput = Date.now()
  const touch = () => { lastInput = Date.now() }
  const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']
  EVENTS.forEach(e => addEventListener(e, touch, { passive: true, capture: true }))

  async function version() {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (!r.ok) return null
    return r.headers.get('etag') || r.headers.get('last-modified')
  }
  function reload() {
    try { beforeReload() } catch { /* never block the update */ }
    // Not reload but replace to the same URL with a version marker: for this navigation the browser runs a
    // View Transition — the old page stays as a snapshot until the new one is ready (see index.html and revealReady).
    const u = new URL(location.href)
    u.searchParams.set('_v', Date.now().toString(36))
    location.replace(u.href)
  }
  async function tick() {
    if (stopped) return
    if (!pending && shown()) {
      try {
        const v = await version()
        if (v && tag && v !== tag) pending = true
        if (v && !tag) tag = v
      } catch { /* printer temporarily unreachable */ }
    }
    if (pending && shown() && Date.now() - lastInput > idleMs() && canReload()) { stopped = true; reload(); return }
    timer = setTimeout(tick, pending ? 1000 : interval)
  }
  timer = setTimeout(tick, 1500)
  // Vyron Core reported a new build (ui_updated) — check now instead of waiting for the interval
  kick = () => { if (!stopped && !pending) { clearTimeout(timer); tick() } }
  return () => { stopped = true; clearTimeout(timer); EVENTS.forEach(e => removeEventListener(e, touch, { capture: true })) }
}

/** State to restore after such a reload (tab, section) — kept in sessionStorage */
const KEY = 'vyron.resume'
export function saveResume(state) { try { sessionStorage.setItem(KEY, JSON.stringify(state)) } catch { /* private mode */ } }
export function takeResume() {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); sessionStorage.removeItem(KEY); return v } catch { return null }
}
