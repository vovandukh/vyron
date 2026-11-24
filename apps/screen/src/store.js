// Printer state for Vyron Screen: a light version without the web UI's 3D and demo model.
// Connection, Klipper error parsing, theme and translations are shared (@vyron/shared), as in Vyron Web.
import { filamentMacros, extruderLimits } from '@vyron/shared/klipper/filament'
import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { MoonrakerClient, resolveHost } from '@vyron/shared/moonraker/client'
import { fetchGcode } from '@vyron/shared/moonraker/api'
import { classify } from '@vyron/shared/klipper/errors'
import { findChamber, findLeveling } from '@vyron/shared/klipper/objects'
import { applyDesign, sanitizeDesign, PRESETS } from '@vyron/shared/theme'
import { parseGcode } from '@vyron/shared/gcode/parser'
import { model, loadModel, indexForPos } from '@vyron/shared/gcode/model'
import { startDemo, demoCall, demoGcode, setDemoUpdateSink } from './demo'
import { watchDesign, handleCoreEvent } from '@vyron/shared/live'
import { dbGet, dbKnown } from '@vyron/shared/moonraker/db'
import { TUNE_OBJECTS, tuneScript, tunePatch } from '@vyron/shared/klipper/tune'
import { heaterScript, HEAT_OFF } from '@vyron/shared/klipper/heat'
import { lang } from './i18n'

/** Largest G-code the screen parses for the preview: the CB1 has only 1 GB of RAM and Klipper matters more */
const MAX_GCODE_BYTES = 20 * 1024 * 1024

/** Klipper objects the screen needs (minimal — every field is pushed over the WebSocket) */
const BASE = {
  print_stats: ['state', 'filename', 'print_duration', 'info', 'message'],
  virtual_sdcard: ['progress', 'is_active', 'file_position'],
  display_status: ['progress'],
  // power — how hard the heater is working now (0…1): "Heating 64%" in the tiles
  extruder: ['temperature', 'target', 'power', 'can_extrude'],
  heater_bed: ['temperature', 'target', 'power'],
  webhooks: ['state', 'state_message'],
  toolhead: ['homed_axes', 'position'],
  // Live tuning during a print: Z offset, speed, flow, part fan
  ...TUNE_OBJECTS
}
const DESIGN = { namespace: 'vyron_ui', key: 'design' }
/** Key under which Vyron Web keeps the theme in the browser — for syncing in the demo */
const DEMO_DESIGN_KEY = 'vyron-design'

// Demo: in dev with ?demo (or ?state= from the demo/tft35.html device page); in the GitHub Pages build (vite build --mode demo) — always
export const DEMO = import.meta.env.MODE === 'demo' || (import.meta.env.DEV && ['demo', 'state'].some(k => new URLSearchParams(location.search).has(k)))

export const usePrinter = defineStore('printer', () => {
  /** idle | connecting | open | lost */
  const link = ref('idle')
  const host = ref('')
  /** Klippy: ready | startup | shutdown | error | disconnected */
  const klippy = reactive({ state: 'disconnected', message: '', info: null })
  const st = reactive({})
  const chamber = ref(null)
  const hostname = ref('')
  /** Last job from Moonraker history: { filename, status, print_duration } | null; undefined — history unavailable */
  const lastJob = ref(undefined)
  const busy = ref('')
  const design = shallowRef(sanitizeDesign(null))
  let client = null

  // ---------- navigation: page stack (home → settings → wifi …) ----------
  const stack = ref(['home'])
  const page = computed(() => stack.value[stack.value.length - 1])
  /** Direction of the last transition — for the animation (forward / back) */
  const dir = ref('fwd')
  const go = name => { dir.value = 'fwd'; stack.value = [...stack.value, name] }
  const back = () => { if (stack.value.length > 1) { dir.value = 'back'; stack.value = stack.value.slice(0, -1) } }
  const home = () => { dir.value = 'back'; stack.value = ['home'] }

  // ---------- derived values for the screen ----------
  const ps = computed(() => st.print_stats || {})
  const printState = computed(() => ps.value.state || 'standby')
  const active = computed(() => printState.value === 'printing' || printState.value === 'paused')
  const progress = computed(() => {
    const p = (st.display_status || {}).progress || (st.virtual_sdcard || {}).progress || 0
    return Math.max(0, Math.min(1, p))
  })
  /** Time left, seconds: from actual print time and progress (null while there's too little data) */
  const remaining = computed(() => {
    const d = ps.value.print_duration || 0, p = progress.value
    return printState.value === 'printing' && p > 0.01 && d > 0 ? d / p - d : null
  })
  const layer = computed(() => {
    const i = ps.value.info || {}
    return i.total_layer ? { n: i.current_layer || 0, total: i.total_layer } : null
  })
  const heaters = computed(() => {
    const list = [
      { id: 'extruder', key: 'status.nozzleShort', icon: 'nozzle', ...(st.extruder || {}) },
      { id: 'heater_bed', key: 'status.bed', icon: 'bed', ...(st.heater_bed || {}) }
    ]
    if (chamber.value && st[chamber.value]) list.push({ id: chamber.value, key: 'status.chamber', icon: 'chamber', ...st[chamber.value], target: undefined })
    return list
  })

  // ---------- Klipper state ----------
  function setKlippy(state, message = '') {
    klippy.state = state
    klippy.message = message
    klippy.info = state === 'shutdown' || state === 'error' ? classify(message) : null
  }

  function merge(status) {
    for (const [k, v] of Object.entries(status || {})) st[k] = { ...(st[k] || {}), ...v }
    const s = status && status.print_stats && status.print_stats.state
    if (s) printEvent(s)
    const w = status && status.webhooks
    if (w && w.state) setKlippy(w.state, w.state_message || '')
  }

  // ---------- Moonraker calls (simulated in the demo) ----------
  function call(method, params = {}) {
    if (DEMO) return demoCall(method, params, { emitGcode, merge })
    if (!client) return Promise.reject(new Error('not connected'))
    return client.call(method, params)
  }
  const gcode = script => call('printer.gcode.script', { script })

  /** Subscribe to G-code responses (console lines) — for WIFI_SCAN etc.; returns an unsubscribe function */
  const gcodeListeners = new Set()
  function onGcode(fn) { gcodeListeners.add(fn); return () => gcodeListeners.delete(fn) }
  function emitGcode(line) { gcodeListeners.forEach(fn => fn(line)) }

  async function refresh() {
    try {
      const p = await client.call('printer.info')
      hostname.value = p.hostname || ''
      setKlippy(p.state, p.state_message || '')
      if (p.state === 'ready') await subscribe()
    } catch { setKlippy('disconnected') }
  }

  async function subscribe() {
    const objs = { ...BASE }
    try {
      const list = (await client.call('printer.objects.list')).objects || []
      chamber.value = findChamber(list)
      if (chamber.value) objs[chamber.value] = ['temperature']
      leveling.value = findLeveling(list)
      filMacros.value = filamentMacros(list)
      // Feed limits from [extruder] (max_extrude_only_distance, min_extrude_temp) — read once
      client.call('printer.objects.query', { objects: { configfile: ['settings'] } })
        .then(q => { filLim.value = extruderLimits(((((q || {}).status || {}).configfile || {}).settings || {}).extruder) })
        .catch(() => {})
      if (leveling.value) objs[leveling.value.obj] = ['applied']
    } catch { chamber.value = null }
    const r = await client.call('printer.objects.subscribe', { objects: objs })
    merge(r.status)
    loadLastJob()
  }

  /** Read-only: server.history.list (without [history] in moonraker.conf we simply show nothing) */
  async function loadLastJob() {
    try {
      const r = await call('server.history.list', { limit: 1, order: 'desc' })
      lastJob.value = (r.jobs || [])[0] || null
    } catch { lastJob.value = undefined }
  }

  // ---------- theme: shared with Vyron Web through the Moonraker database ----------
  function useDesign(d) {
    design.value = sanitizeDesign(d)
    applyDesign(design.value, { layout: false })
    // The language is shared with the web UI: if it was picked on the web or another device — apply it
    if (design.value.lang && design.value.lang !== lang.value) lang.value = design.value.lang
  }
  /** Save the current design to the Moonraker database (the web and other screens pick it up) */
  async function saveDesign() {
    try { await call('server.database.post_item', { ...DESIGN, value: { ...design.value } }); dbKnown(DESIGN.namespace) } catch { /* stays local until the next connection */ }
    if (DEMO) { try { localStorage.setItem(DEMO_DESIGN_KEY, JSON.stringify(design.value)) } catch { /* private mode */ } }
  }
  /** Screen language — shared with the printer's web UI */
  function setLang(id) {
    lang.value = id
    useDesign({ ...design.value, lang: id, updated: Date.now() })
    saveDesign()
  }
  async function pullDesign() {
    const v = await dbGet(call, DESIGN.namespace, DESIGN.key)
    if (v !== undefined) useDesign(v) // otherwise nobody has saved a theme yet — the default stays
  }
  /** Picking a preset on the screen: applied at once and saved to the database — every device picks it up */
  async function setPreset(id) {
    const p = PRESETS.find(x => x.id === id)
    if (!p) return
    useDesign({ ...design.value, preset: p.id, accent: p.accent, brand: p.brand, updated: Date.now() })
    await saveDesign()
  }

  function onNotify(method, params) {
    switch (method) {
      case 'notify_status_update': merge(params[0]); break
      case 'notify_gcode_response': emitGcode(params[0] || ''); break
      case 'notify_update_response': updateLine(params[0] || {}); break
      case 'notify_update_refreshed': updates.info = (params[0] || {}).version_info || updates.info; break
      case 'notify_klippy_ready': refresh(); break
      case 'notify_klippy_shutdown': refresh(); break
      case 'notify_klippy_disconnected': setKlippy('disconnected'); break
      case 'notify_agent_event': {
        const e = params[0] || {}
        // Vyron Core: theme changed — pull it now; new build — check and reload quietly
        handleCoreEvent(e, { onDesign: u => { if (u !== design.value.updated) pullDesign() } })
        break
      }
    }
  }

  // A theme changed in the web UI shows up on the screen without a reload (timestamp polling)
  let stopLive = null
  function onState(s) {
    if (s === 'connecting') link.value = 'connecting'
    else if (s === 'open') {
      link.value = 'open'; refresh(); pullDesign()
      stopLive && stopLive()
      stopLive = watchDesign({ call, getUpdated: () => design.value.updated, onChange: pullDesign, visibleOnly: false })
    } else if (s === 'lost') { link.value = 'lost'; stopLive && stopLive(); stopLive = null }
  }

  function start() {
    if (DEMO) {
      link.value = 'open'
      leveling.value = { obj: 'quad_gantry_level', kind: 'qgl' }
      startDemo({ merge, setKlippy })
      // Demo (GitHub Pages): web and screen are separate pages without a printer; the theme travels via the same
      // site's localStorage: a change on the web repaints the screen at once (storage event), and vice versa
      try { const saved = JSON.parse(localStorage.getItem(DEMO_DESIGN_KEY) || 'null'); if (saved) useDesign(saved) } catch { /* none */ }
      addEventListener('storage', e => { if (e.key === DEMO_DESIGN_KEY && e.newValue) { try { useDesign(JSON.parse(e.newValue)) } catch { /* corrupted */ } } })
      hostname.value = 'vyron-demo'
      loadLastJob()
      // ?demo&page=wifi — open a settings page right away (for development)
      const pg = new URLSearchParams(location.search).get('page')
      if (pg) stack.value = ['settings', 'move', 'temp', 'files', 'filament'].includes(pg) ? ['home', pg] : ['home', 'settings', pg]
      return
    }
    host.value = resolveHost()
    if (!host.value) { link.value = 'idle'; return }
    client = new MoonrakerClient({ onState, onNotify })
    client.connect(host.value)
  }

  // ---------- actions (screen buttons) ----------
  async function run(name, method, params = {}) {
    if (DEMO || !client) return
    busy.value = name
    try { await client.call(method, params) } catch { /* Klipper reports the error (state_message) */ } finally { busy.value = '' }
  }
  const pause = () => run('pause', 'printer.print.pause')
  const resume = () => run('resume', 'printer.print.resume')
  const cancel = () => run('cancel', 'printer.print.cancel')
  const firmwareRestart = () => run('fw', 'printer.firmware_restart')
  const restart = () => run('restart', 'printer.restart')
  const restartMoonraker = () => run('moonraker', 'machine.services.restart', { service: 'moonraker' })
  const reboot = () => run('reboot', 'machine.reboot')

  // ---------- motion: home, gantry levelling, motors, jog ----------
  /** Levelling object: { obj: 'quad_gantry_level', kind: 'qgl' } or z_tilt; null — none */
  const leveling = ref(null)
  const homed = computed(() => String((st.toolhead || {}).homed_axes || ''))
  const position = computed(() => (st.toolhead || {}).position || null)
  const leveled = computed(() => (leveling.value ? !!(st[leveling.value.obj] || {}).applied : null))
  /** Current motion action: '' | 'home' | 'level' | 'motors' | 'jog' */
  const moving = ref('')
  // ---------- filament (logic shared with Vyron Web: @vyron/shared/klipper/filament) ----------
  const filMacros = ref({ load: null, unload: null })
  const filLim = ref(extruderLimits())
  const filBusy = ref('')
  /** Load / unload / feed: waits for completion; a Klipper error shows in the pill. During a print — only when paused. */
  async function filament(kind, script) {
    if (filBusy.value || printState.value === 'printing') return false
    filBusy.value = kind
    try { await gcode(script); return true } catch (e) {
      const i = classify(String((e && e.message) || ''))
      flash(i.id === 'generic' ? 'state.error' : 'kerr.' + i.id + '.t', 'red', i.params)
      return false
    } finally { filBusy.value = '' }
  }
  const FEED = { xy: 3000, z: 600 }

  /** Motion G-code with the Klipper error shown in the pill (e.g. "Must home axis first") */
  async function motion(kind, script) {
    if (moving.value || active.value) return
    moving.value = kind
    try { await gcode(script) } catch (e) {
      const i = classify(String((e && e.message) || ''))
      flash(i.id === 'generic' ? 'state.error' : 'kerr.' + i.id + '.t', 'red', i.params)
    } finally { moving.value = '' }
  }
  const homeAll = () => motion('home', 'G28')
  const motorsOff = () => motion('motors', 'M84')
  /** As in Vyron Web: not homed — G28 first; levelling changes the height — G28 Z afterwards */
  function level() {
    const lv = leveling.value
    if (!lv) return
    const all = /x/.test(homed.value) && /y/.test(homed.value) && /z/.test(homed.value)
    motion('level', (all ? '' : 'G28\n') + (lv.kind === 'ztilt' ? 'Z_TILT_ADJUST' : 'QUAD_GANTRY_LEVEL') + '\nG28 Z')
  }
  /** Relative move of an axis by dist mm (G91 → G1 → G90) */
  /** Live tuning during a print: kind 'z' (increment, mm) | 'zreset' | 'speed' | 'flow' | 'fan' (%) */
  async function tune(kind, v) {
    if (DEMO) { merge(tunePatch(st, kind, v)); return }
    const script = tuneScript(kind, v)
    if (script) { try { await gcode(script) } catch { /* Klipper reports the reason */ } }
  }

  // ---------- files and starting a print ----------
  /** File selected for the print page: { path, modified, size } */
  const selFile = ref(null)
  /** G-code files on the printer, newest first: [{ path, modified, size }] */
  async function listFiles() {
    const r = await call('server.files.list', { root: 'gcodes' })
    return (Array.isArray(r) ? r : []).filter(f => /\.(gcode|g|gco)$/i.test(f.path)).sort((a, b) => b.modified - a.modified)
  }
  const fileMeta = filename => call('server.files.metadata', { filename }).catch(() => ({}))
  /** Start a print and go back home (the model and progress appear there) */
  async function printFile(filename) {
    if (active.value) return false
    try { await call('printer.print.start', { filename }); home(); return true } catch { return false }
  }
  /** Delete a G-code file from the printer (Moonraker refuses to delete the file being printed) */
  async function deleteFile(path) {
    try { await call('server.files.delete_file', { path: 'gcodes/' + path }); return true } catch { return false }
  }
  /** Slicer thumbnail URL (relative to the file's folder) */
  function thumbUrl(filename, meta) {
    const th = ((meta && meta.thumbnails) || []).slice().sort((a, b) => b.width - a.width)[0]
    if (!th || !host.value) return ''
    const dir = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/') + 1) : ''
    return location.protocol + '//' + host.value + '/server/files/gcodes/' + (dir + th.relative_path).split('/').map(encodeURIComponent).join('/')
  }

  /** Heating: target for a heater (extruder, heater_bed …) and "turn everything off" */
  async function setTemp(name, target) { try { await gcode(heaterScript(name, target)) } catch { /* Klipper reports the reason */ } }
  async function heatOff() { try { await gcode(HEAT_OFF) } catch { /* Klipper reports the reason */ } }

  function jog(axis, dist) {
    const f = axis === 'z' ? FEED.z : FEED.xy
    motion('jog', 'G91\nG1 ' + axis.toUpperCase() + dist + ' F' + f + '\nG90')
  }
  const shutdown = () => run('shutdown', 'machine.shutdown')
  /** Emergency stop — without waiting for an answer, as in the web UI */
  function estop() {
    if (DEMO) { setKlippy('shutdown', 'Shutdown due to M112 command'); return }
    client && client.fire('printer.emergency_stop')
  }

  // ---------- G-code preview of the current print ----------
  /** none | loading | ready | big (file too large for the screen) | error */
  const gcodeState = ref('none')
  /** Model version counter: the large arrays live outside reactivity (shared/gcode/model) */
  const modelVer = ref(0)
  let loadedName = ''
  const filename = computed(() => ps.value.filename || '')
  /** How many model segments are already printed */
  const done = computed(() => {
    modelVer.value // dependency: a new model means a new count
    if (gcodeState.value !== 'ready' || !model.N) return 0
    if (!active.value && printState.value === 'complete') return model.N
    if (DEMO) return Math.floor(progress.value * model.N)
    const pos = (st.virtual_sdcard || {}).file_position
    return pos == null ? 0 : indexForPos(pos)
  })
  async function loadGcode(fn) {
    loadedName = fn
    gcodeState.value = 'loading'
    try {
      if (DEMO) loadModel(...demoGcode())
      else {
        const meta = await call('server.files.metadata', { filename: fn }).catch(() => ({}))
        if (meta.size > MAX_GCODE_BYTES) { gcodeState.value = 'big'; return }
        const { P, F, T } = parseGcode(await fetchGcode(host.value, fn))
        if (loadedName !== fn) return
        loadModel(P, F, T)
      }
      modelVer.value++
      gcodeState.value = model.N ? 'ready' : 'error'
    } catch { if (loadedName === fn) gcodeState.value = 'error' }
  }
  /** The model shows during a print and after it ends (finished part) until the next print starts */
  const showModel = computed(() => active.value || printState.value === 'complete')
  watch([filename, showModel], ([fn, on]) => { if (fn && on && fn !== loadedName) loadGcode(fn) })

  // ---------- events for the pill in the top bar (like the web UI's Dynamic Island) ----------
  const event = ref(null)
  let eventTimer = 0
  function flash(key, tone, params) {
    clearTimeout(eventTimer)
    event.value = { key, tone, params, at: Date.now() }
    eventTimer = setTimeout(() => { event.value = null }, 3200)
  }
  const PRINT_EVENTS = {
    printing: ['island.printStart', 'brand'], complete: ['island.printDone', 'green'], paused: ['island.paused', 'amber'],
    cancelled: ['island.cancelled', 'dim'], error: ['island.printError', 'red']
  }
  // Only a real print state change: the first state received (on screen start) isn't an event
  let lastPrint = null
  function printEvent(s) {
    const o = lastPrint
    lastPrint = s
    if (!o || s === o || (s === 'printing' && o === 'paused')) return
    if (s === 'complete' || s === 'cancelled' || s === 'error') setTimeout(loadLastJob, 1500)
    const e = PRINT_EVENTS[s]
    if (e) flash(...e)
  }
  watch(() => klippy.state, (s, o) => {
    if (!o || s === o) return
    if (s === 'ready' && o !== 'disconnected') flash('island.ready', 'green')
    else if (s === 'shutdown' || s === 'error') flash('island.klipperError', 'red')
  })

  // ---------- updates (Moonraker update_manager) ----------
  const updates = reactive({ info: {}, busy: false, checking: false, log: [] })
  function updateLine(r) {
    if (r.message) updates.log = [...updates.log.slice(-40), String(r.message).trim()]
    updates.busy = !r.complete
    if (r.complete) refreshUpdates(false)
  }
  async function refreshUpdates(remote) {
    updates.checking = !!remote
    try {
      const r = remote ? await call('machine.update.refresh', {}) : await call('machine.update.status', {})
      updates.info = (r && r.version_info) || {}
      if (!remote) updates.busy = !!(r && r.busy)
    } catch { /* keep the previous state */ } finally { updates.checking = false }
  }
  /** name: an update_manager component, 'system' (OS packages) or '*' (everything) */
  async function runUpdate(name) {
    updates.busy = true
    updates.log = []
    const m = name === '*' ? 'machine.update.full' : name === 'system' ? 'machine.update.system'
      : name === 'klipper' ? 'machine.update.klipper' : name === 'moonraker' ? 'machine.update.moonraker' : 'machine.update.client'
    try { await call(m, m === 'machine.update.client' ? { name } : {}) } catch (e) {
      updates.log = [...updates.log, String((e && e.message) || e)]
      updates.busy = false
    }
  }
  if (DEMO) setDemoUpdateSink(updateLine)

  return {
    gcodeState, modelVer, done, filename, showModel, event, updates, refreshUpdates, runUpdate,
    link, host, hostname, lastJob, klippy, st, printState, active, progress, remaining, layer, heaters, busy, design, setLang,
    stack, page, dir, go, back, home, tune, setTemp, heatOff, listFiles, fileMeta, printFile, thumbUrl, selFile, deleteFile,
    call, gcode, onGcode, setPreset,
    leveling, homed, position, leveled, moving, homeAll, motorsOff, level, jog,
    filMacros, filLim, filBusy, filament,
    start, pause, resume, cancel, estop, firmwareRestart, restart, restartMoonraker, reboot, shutdown
  }
})
