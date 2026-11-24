<script setup>
// Update centre (Moonraker Update Manager).
// "Check for updates" → machine.update.refresh (a real git/apt query; the legacy
// machine.update.status?refresh only as a fallback). While checking — an Apple-style activity indicator
// and a shimmer over the rows; afterwards the list is reloaded, components with updates
// move to the top and get highlighted, and a summary appears on top.
import { computed, ref, shallowRef, nextTick, onActivated, onDeactivated, watch } from 'vue'
import { holdReveal } from '@vyron/shared/live'
import { usePrinterStore } from '../../stores/printerStore'
import { useConfirm } from '../../composables/useConfirm'
import { useI18n } from '../../composables/useI18n'
import { demoUpdates } from '../../services/demo'
import { DEMO_BUILD } from '../../config'
import Spinner from '../ui/Spinner.vue'

const printer = usePrinterStore()
const { ask } = useConfirm()
const { t, tm } = useI18n()

const vi = shallowRef({})
const busy = ref(false)
const msg = ref('')
// The update log survives a page reload (including the quiet one into the new version from this very update)
const LOG_KEY = 'vyron.updlog', LOG_TTL = 10 * 60 * 1000
function loadLog() {
  try { const v = JSON.parse(sessionStorage.getItem(LOG_KEY) || 'null'); return v && Date.now() - v.at < LOG_TTL ? v.lines : [] } catch { return [] }
}
const logLines = ref(loadLog())
const logEl = ref(null)
/** A check is running (machine.update.refresh) */
const checking = ref(false)
/** A check finished in this session — show the summary; the counter restarts the highlight animation */
const checked = ref(false)
const flash = ref(0)
let lid = logLines.value.reduce((m, l) => Math.max(m, l.id), 0)

function addLog(m, cls = '') {
  logLines.value.push({ id: ++lid, m, cls })
  try { sessionStorage.setItem(LOG_KEY, JSON.stringify({ at: Date.now(), lines: logLines.value.slice(-200) })) } catch { /* private mode */ }
  nextTick(() => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight })
}

const rows = computed(() => {
  const list = Object.keys(vi.value).map((name, i) => {
    const v = vi.value[name] || {}, sys = name === 'system', web = !sys && String(v.configured_type || '').startsWith('web')
    const behind = sys ? v.package_count || 0 : v.commits_behind ? v.commits_behind.length : 0
    const need = web ? !!v.remote_version && v.remote_version !== '?' && v.remote_version !== v.version : behind > 0
    const info = sys ? t('upd.packages', { n: v.package_count || 0 }) : (v.full_version_string || v.version || '–') + (web && need ? ' → ' + v.remote_version : '')
    const flag = v.is_dirty ? t('upd.dirty') : v.is_valid === false ? t('upd.invalid') : ''
    return { name, sys, need, info, i, status: flag || t(need ? 'upd.available' : 'upd.upToDate'), canUpdate: need && !flag }
  })
  // Components with updates go to the top (the rest keep Moonraker's order)
  return list.sort((a, b) => (b.need - a.need) || a.i - b.i)
})
const needCount = computed(() => rows.value.filter(r => r.need).length)

function load() {
  if (DEMO_BUILD && printer.demoMode) { vi.value = demoUpdates; return Promise.resolve() }
  // No connection yet (e.g. right after a reload) — load once it appears
  if (!printer.connected) return Promise.resolve()
  msg.value = ''
  return printer.call('machine.update.status', {})
    .then(r => { vi.value = r.version_info || {}; busy.value = !!r.busy })
    .catch(e => { msg.value = e.message })
}

/** A real check: query the git remotes and apt (may take tens of seconds). */
async function check() {
  if (checking.value) return
  checking.value = true
  msg.value = ''
  try {
    if (DEMO_BUILD && printer.demoMode) {
      await new Promise(r => setTimeout(r, 1600))
      vi.value = demoUpdates
    } else {
      let r
      try { r = await printer.call('machine.update.refresh', {}) }
      catch (e) {
        // Older Moonraker: only status?refresh. Updates are blocked during a print — show the reason.
        if (/print/i.test(e.message || '')) throw e
        r = await printer.call('machine.update.status', { refresh: true })
      }
      vi.value = (r && r.version_info) || vi.value
      busy.value = !!(r && r.busy)
    }
    checked.value = true
    flash.value++
    glow()
  } catch (e) {
    msg.value = e.message || String(e)
  } finally {
    checking.value = false
  }
}

/** One-off soft glow of the rows with updates (Web Animations — repeats after every check) */
const updEl = ref(null)
function glow() {
  nextTick(() => {
    if (!updEl.value || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    updEl.value.querySelectorAll('.updRow.need').forEach((el, i) => el.animate(
      [{ backgroundColor: 'rgba(var(--accent-rgb),.28)', boxShadow: 'inset 0 0 0 1px rgba(var(--accent-rgb),.45)' }, { backgroundColor: 'rgba(var(--accent-rgb),.06)', boxShadow: 'inset 0 0 0 1px rgba(var(--accent-rgb),0)' }],
      { duration: 1400, delay: 120 + i * 90, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }))
  })
}

async function updateOne(r) {
  if (!(await ask({ key: 'upd.confirmOne', params: { name: r.name } }, true))) return
  addLog({ key: 'upd.updating', params: { name: r.name } })
  const m = r.sys ? 'machine.update.system' : r.name === 'klipper' ? 'machine.update.klipper' : r.name === 'moonraker' ? 'machine.update.moonraker' : 'machine.update.client'
  printer.call(m, m === 'machine.update.client' ? { name: r.name } : {}).catch(e => addLog({ raw: e.message }, 'e'))
}

async function updateAll() {
  if (!(await ask('upd.confirmAll', true))) return
  addLog({ key: 'upd.updatingAll' })
  printer.call('machine.update.full', {}).catch(e => addLog({ raw: e.message }, 'e'))
}

function onResponse(p) {
  if (!p) return
  if (p.message) addLog({ raw: (p.application ? p.application + ': ' : '') + p.message })
  if (p.complete) { addLog({ key: 'upd.finished' }); load() }
}

let offs = [], active = false
watch(() => printer.connected, c => { if (c && active) holdReveal(load()) })
onActivated(() => {
  active = true
  holdReveal(load())
  offs = [printer.on('update_response', onResponse), printer.on('update_refreshed', p => { vi.value = p.version_info || {} })]
})
onDeactivated(() => { active = false; offs.forEach(f => f()); offs = [] })
</script>

<template>
  <section class="view">
    <div class="row">
      <button class="chk" :class="{ on: checking }" :disabled="checking" :aria-busy="String(checking)" @click="check">
        <Transition name="spin"><Spinner v-if="checking" /></Transition>
        <span>{{ checking ? t('upd.checking') : t('upd.check') }}</span>
      </button>
      <button :class="{ primary: needCount > 0 && !checking }" :disabled="printer.isPrinting || checking || !needCount" @click="updateAll">{{ t('upd.all') }}</button>
      <!-- Check summary: springs in after every check -->
      <Transition name="sum" mode="out-in">
        <span v-if="checked && !checking" :key="flash + '-' + needCount" class="sum" :class="needCount ? 'has' : 'ok'" role="status">
          <i class="sdot"></i>{{ needCount ? t('upd.availableN', { n: needCount }) : t('upd.allUpToDate') }}
        </span>
      </Transition>
      <span class="msg">{{ msg }}</span>
    </div>
    <div v-if="rows.length" ref="updEl" class="upd" :class="{ checking }">
      <TransitionGroup name="ur">
        <div v-for="r in rows" :key="r.name" class="updRow" :class="{ need: r.need }">
          <span class="n" :title="r.name">{{ r.name }}</span>
          <span class="d" :title="r.info">{{ r.info }}</span>
          <span :class="r.need ? 'needTxt' : 'd'" :title="r.status">{{ r.status }}</span>
          <button :class="{ primary: r.canUpdate }" :disabled="!r.canUpdate || busy || checking || printer.isPrinting" @click="updateOne(r)">{{ t('upd.update') }}</button>
        </div>
      </TransitionGroup>
    </div>
    <div ref="logEl" class="log ulog">
      <div v-for="l in logLines" :key="l.id" :class="l.cls">{{ tm(l.m) }}</div>
    </div>
  </section>
</template>

<style scoped>
.msg{color:var(--coral);font-size:12px}
/* Check button: the activity indicator appears left of the text */
.view .chk{display:inline-flex;align-items:center;gap:8px}
.chk.on{color:var(--ink);border-color:rgba(var(--accent-rgb),.45);background:rgba(var(--accent-rgb),.1)}
.view .chk:disabled.on{opacity:1;cursor:progress}
.spin-enter-active{transition:opacity var(--t-fast) var(--ease-out),transform var(--t-spring) var(--spring)}
.spin-enter-from{opacity:0;transform:scale(.4)}

/* Summary: green "all up to date" or coral "N available" */
.sum{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:500;border:1px solid}
.sum.ok{color:var(--ok-ink);border-color:rgba(var(--green-rgb),.3);background:rgba(var(--green-rgb),.08)}
.sum.has{color:var(--coral);border-color:rgba(var(--accent-rgb),.35);background:rgba(var(--accent-rgb),.1)}
.sdot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}
.sum.has .sdot{animation:sdot 1.8s cubic-bezier(.45,0,.55,1) infinite}
@keyframes sdot{50%{opacity:.35}}
.sum-enter-active{transition:opacity var(--t-mid) var(--ease-out),transform var(--t-spring) var(--spring)}
.sum-leave-active{transition:opacity .12s var(--ease-out)}
.sum-enter-from{opacity:0;transform:scale(.85) translateX(-6px)}
.sum-leave-to{opacity:0}

/* Log under the list: fills the remaining space, but at least ~4 lines */
.view .ulog{flex:1 1 120px;min-height:90px;max-height:none}
.updRow{position:relative;display:grid;grid-template-columns:1fr 1.6fr 1fr auto;gap:12px;align-items:center;padding:10px 14px;font-size:13px;
  transition:background-color var(--t-mid) var(--ease-out)}
.updRow+.updRow{border-top:1px solid var(--hair)}
/* Component list with dynamic height: with a few rows it takes exactly what it needs,
   with many it takes the panel's free space and scrolls by itself. The log below stays visible. */
.upd{position:relative;flex:0 1 auto;min-height:96px;overflow-y:auto;overscroll-behavior:contain;background:var(--surface);border:1px solid var(--hair);border-radius:var(--r-lg)}
.upd::-webkit-scrollbar-track{margin:12px 0}
.updRow .n{font-weight:500}
.updRow .d{color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.updRow .needTxt{color:var(--coral);font-weight:500}

/* Has updates: a coral stripe on the left, a light row tint; after a check — a one-off soft glow */
.updRow.need{background:rgba(var(--accent-rgb),.06)}
.updRow.need::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--coral);box-shadow:0 0 10px rgba(var(--accent-rgb),.8)}

/* Check in progress: a soft shimmer runs over the rows */
.upd.checking .updRow::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.06) 50%,transparent 70%);background-size:220% 100%;
  animation:upd-shimmer 1.3s linear infinite}
@keyframes upd-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}

/* Re-sorting: rows with updates spring up to the top */
.ur-move{transition:transform var(--t-spring) var(--spring)}
@media(max-width:700px){.updRow{grid-template-columns:1fr auto}}
</style>
