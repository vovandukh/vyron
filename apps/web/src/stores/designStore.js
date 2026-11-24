import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { DEFAULT_DESIGN, PRESETS, applyDesign, sanitizeDesign, brandFor, hexToRgb } from '@vyron/shared/theme'
import { usePrinterStore } from './printerStore'
import { useSettingsStore } from './settingsStore'
import { watchDesign, handleCoreEvent } from '@vyron/shared/live'
import { dbGet, dbKnown } from '@vyron/shared/moonraker/db'
import { DEMO_BUILD } from '../config'

const KEY = 'vyron-design'
/** Moonraker database: the design shared by every screen of the printer (PC, tablet, printer screen) */
const DB = { namespace: 'vyron_ui', key: 'design' }
const SYNC_DELAY = 700

function loadLocal() {
  try { return sanitizeDesign(JSON.parse(localStorage.getItem(KEY) || 'null')) } catch { return { ...DEFAULT_DESIGN } }
}

/**
 * UI design (Design page in settings). Changes apply instantly (live preview), are saved to localStorage
 * (so the theme is there on the first frame) and, with a printer connected, to the Moonraker database.
 * On connect the newer of the two versions wins (the updated field).
 */
export const useDesignStore = defineStore('design', () => {
  const d = reactive(loadLocal())
  /** Sync state with the printer: 'local' (this browser only) | 'saving' | 'synced' | 'error' */
  const sync = ref('local')
  const printer = usePrinterStore()
  let timer = 0, applyingRemote = false

  applyDesign(d)

  function touch() {
    d.updated = Date.now()
  }
  function set(key, value) {
    if (!(key in DEFAULT_DESIGN) || key === 'updated') return
    d[key] = sanitizeDesign({ ...d, [key]: value })[key]
    touch()
  }
  function setPreset(id) {
    const p = PRESETS.find(x => x.id === id)
    if (!p) return
    Object.assign(d, { preset: id, accent: p.accent, brand: p.brand })
    touch()
  }
  /** Free accent: the deeper brand shade is picked automatically. */
  function setAccent(hex) {
    if (!hexToRgb(hex)) return
    const accent = String(hex).trim().toLowerCase().replace(/^#?/, '#')
    const p = PRESETS.find(x => x.accent === accent)
    Object.assign(d, p ? { preset: p.id, accent: p.accent, brand: p.brand } : { preset: 'custom', accent, brand: brandFor(accent) })
    touch()
  }
  function reset() {
    Object.assign(d, DEFAULT_DESIGN)
    touch()
  }

  const canSync = () => printer.connected && !(DEMO_BUILD && printer.demoMode)
  async function pushRemote() {
    if (!canSync()) { sync.value = 'local'; return }
    sync.value = 'saving'
    try {
      await printer.call('server.database.post_item', { ...DB, value: { ...d } })
      dbKnown(DB.namespace)
      sync.value = 'synced'
    } catch { sync.value = 'error' }
  }
  async function pullRemote() {
    if (!canSync()) { sync.value = 'local'; return }
    const v = await dbGet((m, p) => printer.call(m, p), DB.namespace, DB.key)
    if (v === undefined) {
      // No record yet (first start) — create it if the user has already changed something
      if (d.updated) pushRemote()
      else sync.value = 'synced'
      return
    }
    const remote = sanitizeDesign(v)
    if (remote.updated > d.updated) {
      applyingRemote = true
      Object.assign(d, remote)
      sync.value = 'synced'
    } else if (d.updated > remote.updated) pushRemote()
    else sync.value = 'synced'
  }

  watch(d, () => {
    applyDesign(d)
    try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* private mode */ }
    if (applyingRemote) { applyingRemote = false; return }
    clearTimeout(timer)
    if (canSync()) { sync.value = 'saving'; timer = setTimeout(pushRemote, SYNC_DELAY) }
  }, { deep: true })

  // After every (re)connect to the printer — reconcile with the Moonraker database
  watch(() => printer.link, (l, o) => { if (l === 'open' || (l === 'ready' && o !== 'open')) pullRemote(); else if (!printer.connected) sync.value = 'local' }, { immediate: true })

  // A theme changed on another device (printer screen, another browser) is picked up without a reload.
  // While our own write is in progress (saving) we stay out: otherwise the other version would overwrite the change just made.
  const live = computed(() => printer.connected && !(DEMO_BUILD && printer.demoMode))
  let stopLive = null
  watch(live, on => {
    stopLive && stopLive(); stopLive = null
    if (on) stopLive = watchDesign({ call: printer.call, getUpdated: () => d.updated, onChange: () => (sync.value === 'saving' ? null : pullRemote()) })
  }, { immediate: true })

  // Vyron Core reports a theme change right away (no waiting for polling) and new UI builds.
  printer.on('agent_event', e => handleCoreEvent(e, {
    onDesign: u => { if (u !== d.updated && sync.value !== 'saving') pullRemote() }
  }))

  // A theme changed in another tab or on the screen page in the demo (same site) — via the storage event.
  // In the demo this is the only path between web and screen (no printer, no Moonraker database).
  addEventListener('storage', e => {
    if (e.key !== KEY || !e.newValue) return
    try {
      const v = sanitizeDesign(JSON.parse(e.newValue))
      if (v.updated !== d.updated) { applyingRemote = true; Object.assign(d, v) }
    } catch { /* corrupted */ }
  })

  // The language is shared by the web and the printer screen: a change in settings goes into the design (and on to
  // the printer); a language that came from the printer (changed on the screen or in another browser) is applied here.
  const settings = useSettingsStore()
  watch(() => settings.lang, l => { if (l && l !== d.lang) { d.lang = l; touch() } })
  watch(() => d.lang, l => { if (l && l !== settings.lang) settings.set('lang', l) }, { immediate: true })

  /** Import from a settings file: unknown keys are dropped, numbers clamped */
  function importDesign(raw) {
    Object.assign(d, sanitizeDesign(raw))
    touch()
  }

  return { d, sync, set, setPreset, setAccent, reset, importDesign }
})
