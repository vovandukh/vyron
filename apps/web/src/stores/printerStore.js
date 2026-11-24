import { defineStore } from 'pinia'
import { ref, shallowReactive, computed } from 'vue'
import { MoonrakerClient, normalizeHost, resolveHost, rememberHost, savedHost } from '@vyron/shared/moonraker/client'
import { fetchGcode, startPrintFile } from '@vyron/shared/moonraker/api'
import { discoverTools, subscriptionObjects, STATE_KEYS, toolNum, findChamber, findLeveling, findMcus, findHwSensors, mcuConnections } from '@vyron/shared/klipper/objects'
import { tuneScript, tunePatch } from '@vyron/shared/klipper/tune'
import { filamentMacros, extruderLimits } from '@vyron/shared/klipper/filament'
import { detectToolheads, toolheadObjects } from '@vyron/shared/klipper/toolheads'
import { detectEddy, eddyObjects } from '@vyron/shared/klipper/eddy'
import { bedShape, bedKey, DEFAULT_BED, sanitizeBedOverride, applyBedOverride } from '@vyron/shared/klipper/bed'
import { dbGet, dbKnown } from '@vyron/shared/moonraker/db'
import { parseGcode } from '@vyron/shared/gcode/parser'
import { model, loadModel, indexForPos, segEnd, layerLabel } from '@vyron/shared/gcode/model'
import {
  DEMO_DEFAULT_TOOLS, DEMO_MAX_TOOLS, DEMO_STEP, DEMO_INTERVAL, demoTools, demoToolheads, demoEddies, demoPreviewModel, resetDemoFiles, DEMO_PRINTING_FILE,
  demoGcode, demoStaticStatus, demoTickStatus, demoHwSensors, demoHostInfo, demoMcuConn
} from '../services/demo'
import { DEMO_BUILD } from '../config'
import { classify, isGcodeError } from '@vyron/shared/klipper/errors'

const LOG_MAX = 500
/** How many error toasts are kept at once (older ones are pushed out). */
const ALERTS_MAX = 4
/** Klipper state polling while it isn't ready (startup / disconnected), ms */
const KLIPPY_POLL = 2000

/**
 * UI messages are stored as { key, params } (translated in components)
 * or { raw } for text that came from the printer.
 */
export const usePrinterStore = defineStore('printer', () => {
  // ---------- connection ----------
  const host = ref(null)
  const demoMode = ref(false)
  /** idle | connecting | open | ready | shutdown | lost | demo */
  const link = ref('idle')
  const metaOverride = ref(null)
  const gcodeError = ref(null)

  // ---------- Klipper state and errors ----------
  /**
   * State of Klippy itself (separate from the Moonraker WebSocket): state — ready | startup | shutdown | error | disconnected | null,
   * message — Klipper's state_message (shutdown / config error text), info — its parsed form (@vyron/shared/klipper/errors.js).
   */
  const klippy = ref({ state: null, message: '', info: null })
  /** Host name from printer.info (bigtreetech-cb1, voron…) — fallback board name in Engineering → Hardware */
  const hostName = ref('')
  /** G-code / print error toasts: [{ id, at, n, src: 'gcode' | 'print', info }] — newest last */
  const alerts = ref([])
  /** Restart action in progress: 'fw' | 'restart' | 'service' | null (see klippyAction) */
  const klippyBusy = ref(null)
  let klippyTimer = 0, alertId = 0, busyTransit = false, busyTimer = 0

  // ---------- Klipper status ----------
  /** Klipper status objects ('print_stats', 'extruder', …). Each key is replaced whole on update. */
  const st = shallowReactive({})
  const objectList = ref([])
  const toolObjects = ref([])
  /** Fallback board sensors by name: { toolhead number: object } */
  const boardObjects = ref({})
  /** Toolhead board for each extruder: { extruder: Toolhead | null } (see shared/klipper/toolheads.js) */
  const toolheads = ref({})
  /** BTT Eddy probes bound to toolheads: { extruder: Eddy[] } (see shared/klipper/eddy.js) */
  const eddies = ref({})
  const activeTool = ref(0)
  const toolStatus = ref({ key: 'tools.waiting' })
  const ctlMsg = ref(null)

  // ---------- console ----------
  const consoleLines = ref([])
  const cmdHistory = ref([])
  let lineId = 0

  // ---------- print model ----------
  const modelVersion = ref(0)
  const done = ref(0)
  let loadedName = null, loading = false, demoTimer = null
  /** 3D preview of a file from history/list: { name, loading?, error? } or null (the current print is shown). */
  const preview = ref(null)
  /** The current print's model, put aside while a file preview is open. */
  let savedPrint = null

  // ---------- event bus for components ----------
  const listeners = new Map()
  function on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, new Set())
    listeners.get(ev).add(fn)
    return () => listeners.get(ev).delete(fn)
  }
  const emit = (ev, ...a) => listeners.get(ev)?.forEach(fn => fn(...a))

  const client = new MoonrakerClient({
    onState: handleState,
    onNotify: handleNotify,
    onRpcError: msg => log(msg, 'e'),
    onInvalid: () => log({ key: 'msg.invalidWs' }, 'e')
  })

  // ================= getters =================
  const connected = computed(() => ['open', 'ready', 'shutdown'].includes(link.value))
  const printState = computed(() => (st.print_stats || {}).state)
  /** A real print is running (not in the demo, so controls stay available). */
  const isPrinting = computed(() => !(DEMO_BUILD && demoMode.value) && printState.value === 'printing')

  const stateLabel = computed(() => {
    if ((DEMO_BUILD && demoMode.value)) return { key: 'state.demo' }
    switch (link.value) {
      case 'idle': return { key: 'state.standby' }
      case 'connecting': return { key: 'state.connecting' }
      case 'lost': return { key: 'state.lost' }
      case 'shutdown': return { key: klippy.value.state === 'error' ? 'state.klipperConfig' : 'state.klipperError' }
      case 'open':
        if (klippy.value.state === 'startup') return { key: 'state.klipperStartup' }
        if (klippy.value.state === 'disconnected') return { key: 'state.klipperOffline' }
    }
    const s = printState.value
    if (s) return STATE_KEYS[s] ? { key: STATE_KEYS[s] } : { raw: s }
    return { key: link.value === 'ready' ? 'state.ready' : 'state.connected' }
  })

  const meta = computed(() => {
    if ((DEMO_BUILD && demoMode.value)) return { key: 'meta.demo' }
    if (metaOverride.value) return metaOverride.value
    const fn = (st.print_stats || {}).filename
    if (gcodeError.value && fn === gcodeError.value.name) return { key: 'meta.gcodeError', params: { msg: gcodeError.value.msg } }
    if (connected.value) return fn ? { raw: fn } : { key: 'meta.noFile' }
    return { key: 'meta.notConnected' }
  })

  /** Active toolhead: the real toolhead.extruder from Klipper, otherwise the last pick in the UI. */
  const activeToolName = computed(() => {
    const ex = (st.toolhead || {}).extruder
    return ex && toolObjects.value.includes(ex) ? ex : toolObjects.value[activeTool.value] || null
  })
  /** Switching toolheads only makes sense with more than one. */
  const canSwitchTools = computed(() => toolObjects.value.length > 1)
  const nozzleTemp = computed(() => (activeToolName.value ? (st[activeToolName.value] || {}).temperature : null))
  const nozzleTarget = computed(() => (activeToolName.value ? (st[activeToolName.value] || {}).target : null))
  const bedTemp = computed(() => (st.heater_bed || {}).temperature)
  const bedTarget = computed(() => (st.heater_bed || {}).target)
  // What really exists in the Klipper config (printer.objects.list; in the demo — keys of the simulated status).
  // The telemetry panel shows only rows that have both an object and data.
  const hasBed = computed(() => objectList.value.includes('heater_bed'))
  const hasFan = computed(() => objectList.value.includes('fan'))
  const chamberObj = computed(() => findChamber(objectList.value))
  const chamberTemp = computed(() => (chamberObj.value ? (st[chamberObj.value] || {}).temperature : null))
  const speedFactor = computed(() => (st.gcode_move || {}).speed_factor)
  const fanSpeed = computed(() => (st.fan || {}).speed)
  const position = computed(() => (st.toolhead || {}).position || null)
  /** Gantry levelling: { obj, kind: 'qgl' | 'ztilt' } or null if it isn't configured. */
  const leveling = computed(() => findLeveling(objectList.value))
  /** Levelling state (applied) — for QGL or Z-Tilt; null if neither exists. */
  const qgl = computed(() => (leveling.value ? (st[leveling.value.obj] || {}).applied ?? null : null))
  /** Heater limits from printer.cfg (max_temp): { extruder: 300, heater_bed: 120, … } */
  const heaterMax = ref({})
  /** Feed limits of each extruder from printer.cfg: { extruder: { maxDist, minTemp } } (see shared/klipper/filament) */
  const extruderCfg = ref({})
  /** The user's LOAD_FILAMENT / UNLOAD_FILAMENT macros, if present */
  const filMacros = computed(() => filamentMacros(objectList.value))
  /** Kinematics and round-bed mesh — from printer.cfg settings (read-only) */
  const kinematics = ref('')
  const meshRound = ref(false)
  /** The bed as Klipper defines it (toolhead axis_minimum/maximum + kinematics) */
  const bedAuto = computed(() => bedShape(kinematics.value, st.toolhead) || DEFAULT_BED)
  /**
   * Manual bed override (Settings → Bed) when auto-detection doesn't fit.
   * Stored in the Moonraker database (vyron_ui/bed) — the same for every device of this printer.
   */
  const bedOverride = ref(sanitizeBedOverride(null))
  /** Work area for the 3D scene. The object changes only together with the bed (so the scene isn't rebuilt every frame). */
  let bedCache = DEFAULT_BED
  const bed = computed(() => {
    const b = applyBedOverride(bedAuto.value, bedOverride.value)
    if (bedKey(b) !== bedKey(bedCache)) bedCache = b
    return bedCache
  })
  const BED_DB = { namespace: 'vyron_ui', key: 'bed' }
  async function loadBedOverride() {
    bedOverride.value = sanitizeBedOverride(await dbGet((m, q) => client.call(m, q), BED_DB.namespace, BED_DB.key))
  }
  async function setBedOverride(o) {
    bedOverride.value = sanitizeBedOverride(o)
    if ((DEMO_BUILD && demoMode.value) || !client.connected) return
    try {
      await client.call('server.database.post_item', { ...BED_DB, value: { ...bedOverride.value } })
      dbKnown(BED_DB.namespace)
    } catch { /* stays until the page reloads */ }
  }
  // ---------- hardware: MCUs, host ----------
  /** Every microcontroller from printer.objects.list ('mcu', 'mcu EBBCan', …) */
  const mcuObjects = computed(() => findMcus(objectList.value))
  /** Board and host chip temperature sensors: [{ obj, name, type: 'mcu'|'host', mcu }] */
  const hwSensors = ref([])
  /** The host's machine.system_info (model, CPU, RAM) — requested once per connection */
  const hostInfo = ref(null)
  /** Connection of each MCU from printer.cfg: { obj: { kind: 'usb'|'can'|'uart'|'linux', iface?, id } } */
  const mcuConn = ref({})

  const progressPct = computed(() => {
    // During a file's 3D preview the model isn't the current print; print progress comes from virtual_sdcard.
    if (preview.value) return Math.floor(((st.virtual_sdcard || {}).progress || 0) * 100)
    modelVersion.value
    return model.N ? Math.floor((done.value / model.N) * 100) : 0
  })

  /** Seconds left, or null. */
  const etaSeconds = computed(() => {
    const ps = st.print_stats || {}, sd = st.virtual_sdcard || {}
    if (ps.state !== 'printing' || !(sd.progress > 0.01)) return null
    const d = ps.print_duration || 0
    return d / sd.progress - d
  })

  const layerText = computed(() => {
    const info = (st.print_stats || {}).info || {}
    if (info.current_layer) return info.current_layer + ' / ' + (info.total_layer || '–')
    if (preview.value) return '–'
    modelVersion.value
    return layerLabel(done.value)
  })

  /** Heater type for the nozzle temperature dialog: the active extruder from toolhead. */
  /** Heater of the active nozzle; null until Klipper reports any extruder (no 'extruder' placeholder). */
  const nozzleHeater = computed(() => activeToolName.value)
  /** Number of detected toolheads: 0 before Klipper answers (objects.list), then exactly as many as exist. */
  const toolCount = computed(() => toolObjects.value.length)

  // ================= actions =================
  function log(t, cls) {
    let line
    if (typeof t === 'string') {
      emit('log', t)
      line = { id: ++lineId, text: t, cls: cls || (/^!!/.test(t) ? 'e' : '') }
    } else line = { id: ++lineId, msg: t, cls: cls || '' }
    const a = consoleLines.value
    a.push(line)
    if (a.length > LOG_MAX) a.splice(0, a.length - LOG_MAX)
  }

  function clearState() {
    for (const k of Object.keys(st)) delete st[k]
    objectList.value = []
    heaterMax.value = {}
    kinematics.value = ''
    meshRound.value = false
    bedOverride.value = sanitizeBedOverride(null)
    hwSensors.value = []
    hostInfo.value = null
    mcuBadAt.value = {}
    mcuRate.value = {}
    mcuConn.value = {}
    for (const k in mcuSeen) delete mcuSeen[k]
    toolObjects.value = []
    boardObjects.value = {}
    toolheads.value = {}
    eddies.value = {}
    loadedName = null
    loading = false
    gcodeError.value = null
    metaOverride.value = null
    preview.value = null
    savedPrint = null
    clearTimeout(klippyTimer)
    clearTimeout(busyTimer)
    klippy.value = { state: null, message: '', info: null }
    hostName.value = ''
    alerts.value = []
    klippyBusy.value = null
  }

  function stopDemo() {
    clearInterval(demoTimer)
    demoTimer = null
  }

  /**
   * Leaving the demo (the Demo mode switch in the control centre). If a printer is already known
   * (a previous connection or a saved host) — connect to it, otherwise stay idle
   * with an empty scene. The page host isn't used here: in the GitHub Pages demo build it isn't a printer.
   */
  function exitDemo() {
    if (!(DEMO_BUILD && demoMode.value)) return
    stopDemo()
    demoMode.value = false
    clearState()
    activeTool.value = 0
    toolStatus.value = { key: 'tools.waiting' }
    Object.assign(demoJob, { file: null, state: 'standby', k: 0, pos: null, progress: 0 })
    applyModel({ P: new Float32Array(0), F: [], T: null })
    link.value = 'idle'
    const h = host.value || savedHost()
    if (h) connect(h)
  }

  /** remember: the host was entered by hand — remember it for the next visits. */
  function connect(rawHost, { remember = false } = {}) {
    const h = normalizeHost(rawHost)
    if (!h) return
    if (remember) rememberHost(h)
    stopDemo()
    demoMode.value = false
    clearState()
    host.value = h
    client.connect(h)
  }

  function handleState(s, info) {
    if (s === 'connecting') { link.value = 'connecting'; metaOverride.value = { key: 'conn.connectingTo', params: { host: info.host } } }
    else if (s === 'open') {
      link.value = 'open'
      metaOverride.value = { key: 'conn.connectedTo', params: { host: info.host } }
      initObjects()
      refreshKlippy()
      client.call('server.gcode_store', { count: 60 })
        .then(r => (r.gcode_store || []).forEach(x => log(x.message)))
        .catch(() => {})
    }
    else if (s === 'error') metaOverride.value = { key: 'conn.wsError' }
    else if (s === 'lost') { link.value = 'lost'; metaOverride.value = { key: 'conn.lost' }; clearTimeout(klippyTimer); klippyBusy.value = null }
    else if (s === 'addrError') { link.value = 'idle'; metaOverride.value = { key: 'conn.addrError', params: { msg: info.message } } }
  }

  function handleNotify(method, params) {
    switch (method) {
      case 'notify_status_update': mergeStatus(params[0] || {}); break
      case 'notify_gcode_response': {
        const line = params[0] || ''
        log(line)
        if (isGcodeError(line)) pushAlert(line, 'gcode')
        break
      }
      case 'notify_klippy_ready': setKlippy('ready', ''); initObjects(); break
      // The reason text comes separately: in webhooks.state_message or via printer.info
      case 'notify_klippy_shutdown': setKlippy('shutdown', klippy.value.state === 'shutdown' ? klippy.value.message : ''); refreshKlippy(); break
      case 'notify_klippy_disconnected': setKlippy('disconnected', ''); break
      case 'notify_history_changed': emit('history_changed'); break
      case 'notify_filelist_changed': emit('filelist_changed', params[0] || {}); break
      case 'notify_update_response': emit('update_response', params[0]); break
      case 'notify_update_refreshed': emit('update_refreshed', params[0] || {}); break
      // Moonraker agent events, including Vyron Core ({ agent: 'vyron-core', event, data })
      case 'notify_agent_event': emit('agent_event', params[0] || {}); break
    }
  }

  // ================= Klipper state and errors =================
  /**
   * New Klippy state (from printer.info, webhooks or notify_klippy_*). Syncs link
   * (ready → 'ready', shutdown/error → 'shutdown', startup/disconnected → 'open') and, while Klipper
   * isn't ready, polls its state — notify_klippy_* doesn't come on every transition (e.g. startup → error).
   */
  function setKlippy(state, message = '') {
    if (!state) return
    message = String(message || '').trim()
    const bad = state === 'shutdown' || state === 'error'
    const cur = klippy.value
    if (cur.state !== state || cur.message !== message) {
      const info = bad && message ? classify(message) : null
      klippy.value = { state, message, info }
      // The Klipper card shows the shutdown reason — the same text in toasts would be redundant
      if (info) alerts.value = alerts.value.filter(a => a.info.head !== info.head)
    }
    if (!(DEMO_BUILD && demoMode.value) && ['open', 'ready', 'shutdown'].includes(link.value)) link.value = state === 'ready' ? 'ready' : bad ? 'shutdown' : 'open'
    if (klippyBusy.value) {
      if (state === 'startup' || state === 'disconnected') busyTransit = true
      else if (busyTransit) finishBusy()
    }
    clearTimeout(klippyTimer)
    if (!(DEMO_BUILD && demoMode.value) && (state === 'startup' || state === 'disconnected')) klippyTimer = setTimeout(refreshKlippy, KLIPPY_POLL)
  }

  /** State query: server.info (works without Klipper) → printer.info with the state_message text. */
  async function refreshKlippy() {
    if ((DEMO_BUILD && demoMode.value) || !client.connected) return
    clearTimeout(klippyTimer)
    try {
      const s = await client.call('server.info')
      if (!s || !s.klippy_connected) { setKlippy((s && s.klippy_state) || 'disconnected', ''); return }
      const p = await client.call('printer.info')
      if (p && p.hostname) hostName.value = p.hostname
      setKlippy(p.state, p.state_message)
    } catch {
      if (client.connected) klippyTimer = setTimeout(refreshKlippy, KLIPPY_POLL)
    }
  }

  /** Error toast. Identical messages don't multiply — a "×N" counter and the timer restarts. */
  function pushAlert(raw, src) {
    const info = classify(raw)
    if (!info.head) return
    const k = klippy.value
    if ((k.state === 'shutdown' || k.state === 'error') && (info.id === 'shutdownNow' || (k.info && k.info.head === info.head))) return
    const a = alerts.value, same = a.find(x => x.info.head === info.head)
    if (same) {
      alerts.value = [...a.filter(x => x !== same), { ...same, at: Date.now(), n: same.n + 1, src: src === 'print' ? 'print' : same.src }]
      return
    }
    alerts.value = [...a, { id: ++alertId, at: Date.now(), n: 1, src, info }].slice(-ALERTS_MAX)
  }
  const dismissAlert = id => { alerts.value = alerts.value.filter(a => a.id !== id) }

  /**
   * Restart after an error: 'fw' — FIRMWARE_RESTART (MCUs + host), 'restart' — RESTART (reload the config),
   * 'service' — restart the klipper service via Moonraker (when Klippy isn't connected at all).
   * klippyBusy holds until Klipper goes through startup and becomes ready / shutdown again (or 45 s).
   */
  const KLIPPY_RPC = { fw: ['printer.firmware_restart', {}], restart: ['printer.restart', {}], service: ['machine.services.restart', { service: 'klipper' }] }
  const KLIPPY_CMD = { fw: 'FIRMWARE_RESTART', restart: 'RESTART', service: 'systemctl restart klipper' }
  function finishBusy() { clearTimeout(busyTimer); klippyBusy.value = null; busyTransit = false }
  async function klippyAction(kind) {
    if (!KLIPPY_RPC[kind] || klippyBusy.value) return
    klippyBusy.value = kind
    busyTransit = false
    clearTimeout(busyTimer)
    busyTimer = setTimeout(finishBusy, 45000)
    if (DEMO_BUILD && demoMode.value) {
      setTimeout(() => setKlippy('startup'), 500)
      setTimeout(() => setKlippy('ready'), 2600)
      return
    }
    try {
      if (!client.connected) throw new Error('not connected')
      log('> ' + KLIPPY_CMD[kind], 'c')
      await client.call(...KLIPPY_RPC[kind])
      refreshKlippy()
    } catch (e) {
      // Klipper may drop the Moonraker connection before answering — that is the restart
      if (busyTransit || /disconnect|closed|shutdown/i.test((e && e.message) || '')) { refreshKlippy(); return }
      finishBusy()
      throw e
    }
  }

  // ---------- demo: error simulation for testing the UI (?demoError=<kind>, console DEMO_ERROR <kind>) ----------
  const RESTART_TAIL = '\n\nOnce the underlying issue is corrected, use the\n"FIRMWARE_RESTART" command to reset the firmware, reload the\nconfig, and restart the host software.\nPrinter is shutdown'
  const DEMO_KLIPPY = {
    mcu: ['shutdown', "Lost communication with MCU 'EBBCan'" + RESTART_TAIL],
    timer: ['shutdown', "MCU 'mcu' shutdown: Timer too close\nThis often indicates the host computer is overloaded. Check\nfor other processes consuming excessive CPU time, high swap\nusage, disk errors, overheating, unstable voltage, or\nsimilar system problems on the host computer." + RESTART_TAIL],
    heater: ['shutdown', "Heater extruder not heating at expected rate\nSee the 'verify_heater' section in docs/Config_Reference.md\nfor the parameters that control this check." + RESTART_TAIL],
    adc: ['shutdown', "MCU 'EBBCan' shutdown: ADC out of range\nThis generally occurs when a heater temperature exceeds\nits configured min_temp or max_temp." + RESTART_TAIL],
    estop: ['shutdown', 'Shutdown due to M112 command' + RESTART_TAIL],
    config: ['error', "Option 'max_temp' in section 'extruder' must be specified\n\nOnce the underlying issue is corrected, use the \"RESTART\"\ncommand to reload the config and restart the host software.\nPrinter is halted"],
    startup: ['startup', ''], offline: ['disconnected', '']
  }
  const DEMO_GCODE = {
    home: '!! Must home axis first: 120.000 120.000 10.000 [0.000]',
    range: '!! Move out of range: 400.000 120.000 10.000 [0.000]',
    cold: "!! Extrude below minimum temp\n!! See the 'min_extrude_temp' config option for details",
    probe: '!! Probe triggered prior to movement',
    qgl: '!! Too many retries: aborting QGL',
    macro: "!! Error evaluating 'gcode_macro PRINT_START:gcode': jinja2.exceptions.UndefinedError: 'BED' is undefined",
    unknown: '!! Unknown command:"G29"'
  }
  function demoError(kind) {
    if (!DEMO_BUILD || !(DEMO_BUILD && demoMode.value)) return false
    if (DEMO_GCODE[kind]) { log(DEMO_GCODE[kind]); pushAlert(DEMO_GCODE[kind], 'gcode'); return true }
    if (kind === 'ready') { setKlippy('ready'); return true }
    const e = DEMO_KLIPPY[kind]
    if (!e) return false
    setKlippy(e[0], e[1])
    // A demo startup reaches "ready" by itself (as real Klipper does, without user action)
    if (kind === 'startup') setTimeout(() => { if ((DEMO_BUILD && demoMode.value) && klippy.value.state === 'startup') setKlippy('ready') }, 6000)
    return true
  }

  async function initObjects() {
    try {
      const r = await client.call('printer.objects.list')
      objectList.value = r.objects || []
      const { tools, boards } = discoverTools(objectList.value)
      toolObjects.value = tools
      boardObjects.value = boards
      if (activeTool.value >= tools.length) activeTool.value = 0
      toolStatus.value = { key: 'tools.found', params: { n: tools.length } }
      // Toolhead boards: read the printer.cfg settings (read-only) and find MCUs by the extruders' pins.
      let extra = []
      try {
        const q = await client.call('printer.objects.query', { objects: { configfile: ['settings'] } })
        const settings = (((q || {}).status || {}).configfile || {}).settings || {}
        heaterMax.value = Object.fromEntries([...tools, 'heater_bed']
          .map(n => [n, Number((settings[n] || {}).max_temp)]).filter(([, v]) => v > 0))
        extruderCfg.value = Object.fromEntries(tools.map(n => [n, extruderLimits(settings[n])]))
        kinematics.value = String((settings.printer || {}).kinematics || '')
        meshRound.value = Number((settings.bed_mesh || {}).mesh_radius) > 0
        loadBedOverride().catch(() => {})
        toolheads.value = detectToolheads(settings, tools, objectList.value)
        eddies.value = detectEddy(settings, tools, toolheads.value, objectList.value)
        hwSensors.value = findHwSensors(objectList.value, settings)
        mcuConn.value = mcuConnections(settings, findMcus(objectList.value))
        extra = [...toolheadObjects(toolheads.value), ...eddyObjects(eddies.value)]
      } catch { toolheads.value = {}; eddies.value = {}; hwSensors.value = findHwSensors(objectList.value) }
      // Hardware telemetry: every MCU (version, last_stats with retransmit/invalid), host load, chip sensors
      extra.push(...findMcus(objectList.value), 'system_stats', ...hwSensors.value.map(s => s.obj),
        ...objectList.value.filter(n => /^canbus_stats /.test(n)))
      client.call('machine.system_info', {}).then(r => { hostInfo.value = (r && r.system_info) || null }).catch(() => {})
      const s = await client.call('printer.objects.subscribe', { objects: subscriptionObjects(objectList.value, tools, boards, extra) })
      if (s && s.status) mergeStatus(s.status)
    } catch { /* the error is already in the console */ }
  }

  /**
   * MCU bus stability: the moment of the last growth of bytes_retransmit / bytes_invalid for each MCU.
   * Tracked in the store since connecting — so the Engineering menu sees losses that happened while it was closed.
   */
  const mcuBadAt = ref({})
  /** Traffic of each MCU, B/s: { 'mcu EBBCan': { w, r } } — from the growth of bytes_write / bytes_read */
  const mcuRate = ref({})
  const mcuSeen = {}
  const markBad = k => { mcuBadAt.value = { ...mcuBadAt.value, [k]: Date.now() } }
  function trackMcu(k, ls) {
    const r = Number(ls.bytes_retransmit) || 0, i = Number(ls.bytes_invalid) || 0, p = mcuSeen[k]
    const bw = Number(ls.bytes_write), br = Number(ls.bytes_read), t = performance.now()
    if (p && (r > p.r || i > p.i)) markBad(k)
    if (p && p.t && Number.isFinite(bw) && Number.isFinite(br) && t - p.t > 400 && bw >= p.bw && br >= p.br) {
      const dt = (t - p.t) / 1000
      mcuRate.value = { ...mcuRate.value, [k]: { w: (bw - p.bw) / dt, r: (br - p.br) / dt } }
      mcuSeen[k] = { r, i, bw, br, t }
    } else mcuSeen[k] = { r, i, bw: p && t - p.t <= 400 ? p.bw : bw, br: p && t - p.t <= 400 ? p.br : br, t: p && t - p.t <= 400 ? p.t : t }
  }
  /** CAN bus: growing receive/transmit errors are also a sign of an unstable link (tx_retries — display only) */
  function trackCan(k, s) {
    const mk = 'mcu ' + k.slice(13), key = k + '#', p = mcuSeen[key]
    const rx = Number(s.rx_error) || 0, tx = Number(s.tx_error) || 0
    if (p && (rx > p.rx || tx > p.tx)) markBad(mk)
    mcuSeen[key] = { rx, tx }
  }

  function mergeStatus(patch) {
    const prevPrint = (st.print_stats || {}).state
    for (const k in patch) {
      st[k] = Object.assign({}, st[k], patch[k])
      if (patch[k] && patch[k].last_stats && /^mcu( |$)/.test(k)) trackMcu(k, patch[k].last_stats)
      else if (patch[k] && /^canbus_stats /.test(k)) trackCan(k, st[k])
    }
    // The print failed with an error: print_stats.message is the reason (pushAlert filters the duplicate "!!" line)
    const ps = st.print_stats || {}
    if (ps.state === 'error' && prevPrint && prevPrint !== 'error' && ps.message) pushAlert(ps.message, 'print')
    if (patch.webhooks && !(DEMO_BUILD && demoMode.value)) setKlippy(st.webhooks.state, st.webhooks.state_message)
    if ((DEMO_BUILD && demoMode.value)) return
    metaOverride.value = null
    maybeLoadGcode()
    const pos = (st.virtual_sdcard || {}).file_position
    if (model.P && pos != null && !loading && !preview.value) done.value = indexForPos(pos)
  }

  function applyModel({ P, F, T }) {
    loadModel(P, F, T)
    done.value = 0
    modelVersion.value++
  }

  async function maybeLoadGcode() {
    const fn = (st.print_stats || {}).filename
    // While another file is previewed, the new print loads after the preview closes.
    if (!fn || fn === loadedName || loading || !host.value || preview.value) return
    loading = true
    loadedName = fn
    gcodeError.value = null
    try {
      applyModel(parseGcode(await fetchGcode(host.value, fn)))
    } catch (e) {
      gcodeError.value = { name: fn, msg: e.message }
    } finally {
      loading = false
    }
    const pos = (st.virtual_sdcard || {}).file_position
    if (model.P && pos != null) done.value = indexForPos(pos)
  }

  /** Demo with n toolheads (1…DEMO_MAX_TOOLS). Without an argument — ?demo=N from the URL or DEMO_DEFAULT_TOOLS. */
  /**
   * Demo: bed shape — rectangular (CoreXY 350×350) or round (delta, radius 150).
   * The round one is centred at the same (175, 175) so the demo model sits in the middle.
   */
  const demoBed = ref('rect')
  function applyDemoBed() {
    const round = demoBed.value === 'round'
    kinematics.value = round ? 'delta' : 'corexy'
    meshRound.value = round
    mergeStatus({ toolhead: round
      ? { axis_minimum: [25, 25, 0, -99999], axis_maximum: [325, 325, 300, 99999] }
      : { axis_minimum: [0, 0, 0, -99999], axis_maximum: [350, 350, 330, 99999] } })
  }
  function setDemoBed(kind) {
    demoBed.value = kind === 'round' ? 'round' : 'rect'
    if ((DEMO_BUILD && demoMode.value)) applyDemoBed()
  }

  function startDemo(n) {
    if (!DEMO_BUILD) return   // the printer build has no demo (see config.js)
    if (!(n >= 1)) n = Number(new URLSearchParams(location.search).get('demo')) || DEMO_DEFAULT_TOOLS
    n = Math.min(DEMO_MAX_TOOLS, Math.max(1, Math.round(n)))
    client.close()
    stopDemo()
    clearState()
    host.value = null
    demoMode.value = true
    link.value = 'demo'
    const tools = demoTools(n), heads = demoToolheads(tools), eds = demoEddies(tools, heads)
    toolObjects.value = tools
    boardObjects.value = {}
    toolheads.value = heads
    eddies.value = eds
    activeTool.value = 0
    toolStatus.value = { key: 'tools.demoMode' }
    resetDemoFiles()
    demoHeat.targets = {}; demoHeat.temps = {}
    mergeStatus(demoStaticStatus(heads, eds))
    applyDemoBed()
    demoBeginPrint(DEMO_PRINTING_FILE)
    // The demo has the full sensor set (chamber, QGL, fan…) — the "object list" comes from the simulated status.
    mergeStatus(demoTickStatus({ pos: null, progress: 0, state: 'printing', filename: demoJob.file, activeTool: 0, tools, toolheads: heads, eddies: eds, heat: demoHeatStep(tools) }))
    objectList.value = Object.keys(st)
    heaterMax.value = Object.fromEntries([...tools.map(n => [n, 300]), ['heater_bed', 120]])
    hwSensors.value = demoHwSensors(heads)
    hostInfo.value = demoHostInfo
    mcuConn.value = demoMcuConn(heads, eds)
    setKlippy('ready')
    const de = new URLSearchParams(location.search).get('demoError')
    if (de) setTimeout(() => demoError(de), 600)
    demoTimer = setInterval(() => {
      // While a file is previewed the model on screen is different — the "print" pauses so progress isn't drawn on another model.
      if (!preview.value && demoJob.state === 'printing') {
        // every demo print takes ~15 s regardless of the model size
        demoJob.k = Math.min(model.N, demoJob.k + Math.max(DEMO_STEP, Math.ceil(model.N / 400)))
        done.value = indexForPos(demoJob.k)
        demoJob.pos = done.value ? segEnd(done.value - 1) : null
        demoJob.progress = model.N ? done.value / model.N : 0
        if (demoJob.k >= model.N) demoJob.state = 'complete'
      }
      mergeStatus(demoTickStatus({
        pos: demoJob.pos, progress: demoJob.progress, state: demoJob.state, filename: demoJob.file,
        activeTool: activeTool.value, tools, toolheads: heads, eddies: eds, heat: demoHeatStep(tools)
      }))
    }, DEMO_INTERVAL)
  }

  /** Current demo job: file, state, position in the model. */
  const demoJob = { file: null, state: 'standby', k: 0, pos: null, progress: 0 }

  /**
   * Demo heaters: targets set by the user (quick sliders) and current temperatures
   * easing towards the target (~1 s) — so the demo shows both the odometer and the toolhead heat colours.
   * Without an explicit target: the active toolhead 205°, the rest off; bed 110°.
   */
  const demoHeat = { targets: {}, temps: {} }
  function demoHeatStep(tools) {
    const out = {}
    const step = (n, def) => {
      const tg = demoHeat.targets[n] ?? def
      const cur = demoHeat.temps[n] ?? Math.max(tg, 25)
      const next = cur + (Math.max(tg, 25) - cur) * 0.05
      demoHeat.temps[n] = Math.abs(next - Math.max(tg, 25)) < 0.05 ? Math.max(tg, 25) : next
      out[n] = { temperature: demoHeat.temps[n], target: tg }
    }
    tools.forEach((n, i) => step(n, i === activeTool.value ? 205 : 0))
    step('heater_bed', 110)
    return out
  }

  /**
   * Quick control from the telemetry panel (sliders and presets). Real G-code:
   *   nozzle → M104 T<n> S<°>, bed → M140 S<°>, speed → M220 S<%>, fan → M106 S<0…255>.
   * In the demo nothing is sent — values are simulated locally.
   */
  function quickSet(kind, v) {
    v = Math.round(Number(v))
    if (!Number.isFinite(v) || v < 0) return false
    const tool = activeToolName.value
    if ((DEMO_BUILD && demoMode.value)) {
      if (kind === 'nozzle' && tool) demoHeat.targets[tool] = v
      else if (kind === 'bed') demoHeat.targets.heater_bed = v
      else if (kind === 'speed') mergeStatus({ gcode_move: { speed_factor: v / 100 } })
      else if (kind === 'fan') mergeStatus({ fan: { speed: v / 100 } })
      return true
    }
    const script = {
      nozzle: tool ? `M104 T${toolNum(tool)} S${v}` : null,
      bed: `M140 S${v}`,
      speed: `M220 S${Math.max(1, v)}`,
      fan: `M106 S${Math.round(Math.min(100, v) * 2.55)}`
    }[kind]
    return script ? rpc(script) : false
  }

  /**
   * Live tuning during a print (@vyron/shared/klipper/tune): Z offset, speed, flow, fan.
   * kind: 'z' (v — increment, mm) | 'zreset' | 'speed' | 'flow' | 'fan' (v — new value, %).
   */
  function tune(kind, v) {
    if ((DEMO_BUILD && demoMode.value)) { mergeStatus(tunePatch(st, kind, v)); return true }
    const script = tuneScript(kind, v)
    return script ? rpc(script) : false
  }

  /**
   * Demo: show a print state with one tap — printing | paused | complete | idle (no print).
   * So a visitor sees "print finished" and idle too, not just an endless print.
   */
  function demoSet(state) {
    if (!(DEMO_BUILD && demoMode.value)) return
    if (state === 'idle') {
      Object.assign(demoJob, { file: null, state: 'standby', k: 0, pos: null, progress: 0 })
      applyModel({ P: new Float32Array(0), F: [], T: null })
      done.value = 0
    } else {
      if (!demoJob.file) demoBeginPrint(DEMO_PRINTING_FILE)
      if (state === 'complete') {
        demoJob.k = model.N; done.value = indexForPos(model.N)
        demoJob.pos = done.value ? segEnd(done.value - 1) : null
        demoJob.progress = 1
      } else if (demoJob.state === 'complete' || demoJob.state === 'cancelled') {
        Object.assign(demoJob, { k: 0, pos: null, progress: 0 }); done.value = 0
      }
      demoJob.state = state
    }
    mergeStatus({ print_stats: { state: demoJob.state, filename: demoJob.file || '' }, virtual_sdcard: { progress: demoJob.progress } })
  }

  function demoBeginPrint(file) {
    applyModel(file === DEMO_PRINTING_FILE ? demoGcode() : demoPreviewModel(file))
    Object.assign(demoJob, { file, state: 'printing', k: 0, pos: null, progress: 0 })
  }

  /** The printer is busy with a job: a new print can't start. */
  const printBusy = computed(() => ['printing', 'paused'].includes(printState.value))

  /**
   * Start printing a file from the printer (POST /printer/print/start).
   * State checks are here; the user confirmation lives in the component (useConfirm).
   * In the demo — simulated: the printer switches to printing with this file's model.
   */
  async function startPrint(filename) {
    if (printBusy.value) throw new Error('busy')
    if (preview.value) closePreview()
    if (DEMO_BUILD && demoMode.value) { demoBeginPrint(filename); return }
    if (!connected.value || !host.value) throw new Error('not connected')
    await startPrintFile(host.value, filename)
  }

  /**
   * 3D preview of a G-code file on the printer (read-only: GET /server/files/gcodes/…).
   * The current print's model is put aside and returned after closePreview().
   */
  async function openPreview(filename) {
    if (!preview.value) savedPrint = model.P ? { P: model.P, F: model.F, T: model.T, done: done.value } : null
    preview.value = { name: filename, loading: true }
    try {
      const parsed = DEMO_BUILD && demoMode.value ? demoPreviewModel(filename) : parseGcode(await fetchGcode(host.value, filename))
      if (!preview.value || preview.value.name !== filename) return   // closed, or another file opened
      applyModel(parsed)
      done.value = model.N            // show the model fully "printed"
      preview.value = { name: filename }
    } catch (e) {
      if (preview.value && preview.value.name === filename) preview.value = { name: filename, error: e.message }
    }
  }

  function closePreview() {
    if (!preview.value) return
    preview.value = null
    if (savedPrint) {
      const s = savedPrint
      applyModel(s)
      const pos = (st.virtual_sdcard || {}).file_position
      done.value = !(DEMO_BUILD && demoMode.value) && pos != null ? indexForPos(pos) : s.done
    } else if (model.P) {
      applyModel({ P: new Float32Array(0), F: [] })
    }
    savedPrint = null
    if (!(DEMO_BUILD && demoMode.value)) maybeLoadGcode()
  }

  /**
   * Auto-start: connect to the printer (?host= → localStorage → VITE_PRINTER_HOST → page host → default address).
   * The demo only exists in the demo build (npm run build:demo / dev:demo): it starts right away there, connecting — via ?host=.
   */
  function autoStart() {
    const q = new URLSearchParams(location.search)
    if (DEMO_BUILD && (q.has('demo') || (import.meta.env.VITE_DEMO_DEFAULT === '1' && !q.has('host')))) { startDemo(); return }
    const h = resolveHost()   // ?host= → localStorage → VITE_PRINTER_HOST → page host
    if (h) connect(h)
  }

  /** G-code from the control buttons. Returns false and writes the reason to ctlMsg if the command didn't go out. */
  function rpc(script) {
    if ((DEMO_BUILD && demoMode.value) || !client.connected) {
      ctlMsg.value = { key: (DEMO_BUILD && demoMode.value) ? 'msg.demoNoExec' : 'msg.notConnected' }
      return false
    }
    ctlMsg.value = null
    client.fire('printer.gcode.script', { script })
    return true
  }

  /**
   * Filament change (load / unload / manual feed): waits until Klipper runs the script.
   * A Klipper error (cold nozzle, move too long) rejects the promise with the text. In the demo — only a simulated duration.
   */
  const filBusy = ref('')
  async function runFilament(kind, script) {
    if (filBusy.value) return
    filBusy.value = kind
    try {
      if (DEMO_BUILD && demoMode.value) { await new Promise(r => setTimeout(r, 1400)); return }
      if (!client.connected) throw new Error('not connected')
      log('> ' + script.replace(/\n/g, ' · '), 'c')
      await client.call('printer.gcode.script', { script })
    } finally {
      filBusy.value = ''
    }
  }

  /** Raw G-code without the demo check (Wi‑Fi macros). */
  function sendRaw(script) {
    return client.fire('printer.gcode.script', { script })
  }

  function consoleSend(cmd) {
    cmd = cmd.trim()
    if (!cmd) return
    cmdHistory.value.push(cmd)
    log('> ' + cmd, 'c')
    const dm = DEMO_BUILD && demoMode.value && /^DEMO_ERROR\s+(\w+)$/i.exec(cmd)
    if (dm && demoError(dm[1].toLowerCase())) return
    if ((DEMO_BUILD && demoMode.value) || !client.connected) {
      log({ key: (DEMO_BUILD && demoMode.value) ? 'msg.demoNoExec' : 'msg.notConnectedPrinter' }, 'e')
      return
    }
    client.fire('printer.gcode.script', { script: cmd })
  }

  /** RPC with an answer, for components. */
  function call(method, params) {
    return client.call(method, params)
  }

  /** Select a toolhead by position in toolObjects; sends T<number from the extruder name>. */
  function selectTool(i) {
    const name = toolObjects.value[i]
    if (!name || !canSwitchTools.value) return
    const n = toolNum(name)
    if ((DEMO_BUILD && demoMode.value)) {
      activeTool.value = i
      toolStatus.value = { key: 'tools.demoSelected', params: { i: n } }
      return
    }
    if (rpc('T' + n)) {
      activeTool.value = i
      toolStatus.value = { key: 'tools.sent', params: { i: n } }
    }
  }

  /** Heating target of a specific extruder — works with any number of toolheads, no T<n> macros needed. */
  function setToolTarget(name, v) {
    return rpc('SET_HEATER_TEMPERATURE HEATER=' + name + ' TARGET=' + v)
  }

  function setHeater(heater, v) {
    return client.call('printer.gcode.script', { script: 'SET_HEATER_TEMPERATURE HEATER=' + heater + ' TARGET=' + v })
  }

  function emergencyStop() {
    client.fire('printer.emergency_stop')
  }

  /**
   * Pause / resume / cancel the current print — Moonraker's standard methods
   * (printer.print.pause|resume|cancel call the printer's PAUSE / RESUME / CANCEL_PRINT macros,
   * so parking the head etc. works as in Mainsail). Cancel confirmation lives in the component.
   * In the demo the state changes locally (the demo print loop stops on pause).
   */
  /**
   * Gantry levelling (the QGL / Z-Tilt button). As on a Voron: if the axes aren't homed — G28 first,
   * then QUAD_GANTRY_LEVEL (or Z_TILT_ADJUST), then G28 Z (levelling changes the height).
   * printer.gcode.script returns only after completion — the promise lasts exactly as long as the gantry moves.
   * A Klipper error (e.g. "Probe triggered prior to movement") rejects the promise with the text.
   */
  const levelingBusy = ref(false)
  async function levelGantry() {
    const lv = leveling.value
    if (!lv || levelingBusy.value) return
    levelingBusy.value = true
    try {
      if (DEMO_BUILD && demoMode.value) {
        mergeStatus({ [lv.obj]: { applied: false } })
        await new Promise(r => setTimeout(r, 2600))
        mergeStatus({ [lv.obj]: { applied: true } })
        return
      }
      if (!client.connected) throw new Error('not connected')
      const homed = String((st.toolhead || {}).homed_axes || '')
      const cmd = lv.kind === 'ztilt' ? 'Z_TILT_ADJUST' : 'QUAD_GANTRY_LEVEL'
      const script = (/x/.test(homed) && /y/.test(homed) && /z/.test(homed) ? '' : 'G28\n') + cmd + '\nG28 Z'
      log('> ' + script.replace(/\n/g, ' · '), 'c')
      await client.call('printer.gcode.script', { script })
    } finally {
      levelingBusy.value = false
    }
  }

  async function printAction(kind) {
    if (!['pause', 'resume', 'cancel'].includes(kind)) return
    if ((DEMO_BUILD && demoMode.value)) {
      if (kind === 'pause' && demoJob.state === 'printing') demoJob.state = 'paused'
      else if (kind === 'resume' && demoJob.state === 'paused') demoJob.state = 'printing'
      else if (kind === 'cancel') demoJob.state = 'cancelled'
      mergeStatus({ print_stats: { state: demoJob.state } })
      return
    }
    if (!client.connected) throw new Error('not connected')
    await client.call('printer.print.' + kind, {})
  }

  return {
    // state
    host, demoMode, link, st, objectList, toolObjects, boardObjects, toolheads, eddies, activeTool, toolStatus, ctlMsg,
    consoleLines, cmdHistory, modelVersion, done,
    // getters
    connected, isPrinting, printState, stateLabel, meta, activeToolName, canSwitchTools, toolCount, nozzleTemp, bedTemp, chamberTemp,
    speedFactor, fanSpeed, position, qgl, progressPct, etaSeconds, layerText, nozzleHeater, tune,
    extruderCfg, filMacros, filBusy, runFilament,
    nozzleTarget, bedTarget, hasBed, hasFan, chamberObj, leveling, heaterMax, quickSet, kinematics, meshRound, bed, hostName, bedAuto, bedOverride, setBedOverride,
    mcuObjects, hwSensors, hostInfo, mcuBadAt, mcuRate, mcuConn,
    // actions
    preview, openPreview, closePreview, printBusy, startPrint, demoSet, demoBed, setDemoBed,
    on, log, connect, startDemo, exitDemo, autoStart, rpc, sendRaw, consoleSend, call, selectTool, setToolTarget,
    setHeater, emergencyStop, printAction, levelGantry, levelingBusy, mergeStatus,
    // Klipper errors
    klippy, alerts, klippyBusy, dismissAlert, klippyAction, refreshKlippy, demoError
  }
})
