<script setup>
// Status pill in the spirit of the Dynamic Island. Collapsed: state indicator + state + time left.
// On system events (connection, QGL, print start/end…) it springs open with a message
// and collapses back after a few seconds. Click/tap expands it in place with the detailed state and
// host address, collapsing by itself after 1.2 s (the control centre opens only with the "…" button).
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { DEMO_BUILD } from '../../config'
import { usePrinterStore } from '../../stores/printerStore'
import { useUiStore } from '../../stores/uiStore'
import { useI18n } from '../../composables/useI18n'
import { fmtDuration } from '@vyron/shared/format'
import { resolveHost } from '@vyron/shared/moonraker/client'

const printer = usePrinterStore()
const ui = useUiStore()
const { t, tm } = useI18n()

// The pill shows only the duration ("Printing · 1 h 15 min"); the full "… left" text is in the tooltip.
const eta = computed(() => (printer.etaSeconds == null ? '' : fmtDuration(printer.etaSeconds, t)))
const etaFull = computed(() => (eta.value ? t('eta.left', { t: eta.value }) : ''))
const printing = computed(() => printer.printState === 'printing')

// ---------- event queue ----------
/** Current event: { id, key, params, tone: ok | warn | err | info } or null */
const ev = ref(null)
const queue = []
let timer = 0, shownAt = 0, seq = 0
const SHOW = 3400, SHOW_BUSY = 1700, MIN = 1100

function next() {
  clearTimeout(timer)
  const e = queue.shift()
  ev.value = e || null
  if (!e) return
  shownAt = Date.now()
  timer = setTimeout(next, queue.length ? SHOW_BUSY : SHOW)
}
function push(key, tone = 'info', params) {
  const last = queue.length ? queue[queue.length - 1] : ev.value
  if (last && last.key === key) return
  queue.push({ id: ++seq, key, params, tone })
  if (!ev.value) next()
  else { // something is already shown: don't hold it longer than needed so the queue doesn't lag
    clearTimeout(timer)
    timer = setTimeout(next, Math.max(0, MIN - (Date.now() - shownAt)))
  }
}

// ---------- expand on click: "Connected · 192.168.1.100:7125" ----------
const PEEK = 1200
const PEEK_TONE = { ready: 'ok', open: 'ok', lost: 'warn', shutdown: 'err' }
function peek() {
  // Klipper in an error state: the pill brings back the hidden card with the reason and restart buttons
  if (klippyBad.value && ui.klippyHidden) { ui.klippyHidden = false; return }
  clearTimeout(timer)
  // A system event interrupted by the click is shown right after the expansion
  if (ev.value && !ev.value.peek) queue.unshift(ev.value)
  const params = DEMO_BUILD && printer.demoMode
    ? { state: t('state.demo'), host: t('island.demoHost') }
    : { state: tm(printer.stateLabel), host: printer.host || resolveHost() || t('island.noHost') }
  ev.value = { id: ++seq, key: 'island.detail', params, tone: PEEK_TONE[printer.link] || 'info', peek: true }
  shownAt = Date.now()
  timer = setTimeout(next, PEEK)   // a repeat click during the expansion restarts the countdown
}

watch(() => printer.link, (l, o) => {
  if (l === o) return
  if (l === 'demo') push('island.demo', 'info')
  else if (l === 'open') push('island.connected', 'ok', { host: printer.host })
  else if (l === 'ready' && o !== 'open') push('island.ready', 'ok')
  // Only the loss of a live connection. Failed reconnect attempts (connecting → lost every 1.5–15 s)
  // aren't announced — the red dot in the pill shows the state anyway.
  else if (l === 'lost' && o !== 'connecting') push('island.lost', 'warn')
})
// Klipper error (also in the demo simulation): shutdown / config error; going back to ready after it is a separate event
const klippyBad = computed(() => ['shutdown', 'error'].includes(printer.klippy.state))
watch(() => printer.klippy.state, (s, o) => {
  if (s === o) return
  if (s === 'shutdown') push('island.klipperError', 'err')
  else if (s === 'error') push('island.klipperConfig', 'err')
  else if (s === 'ready' && ['shutdown', 'error', 'startup', 'disconnected'].includes(o)) push('island.ready', 'ok')
})
// Only a real false → true transition: the initial state load (null → true) isn't an event.
watch(() => printer.qgl, (v, o) => {
  if (v === true && o === false) push(printer.leveling?.kind === 'ztilt' ? 'island.ztilt' : 'island.qgl', 'ok')
})
const PRINT_EVENTS = {
  printing: ['island.printStart', 'info'], complete: ['island.printDone', 'ok'], paused: ['island.paused', 'warn'],
  error: ['island.printError', 'err'], cancelled: ['island.cancelled', 'warn']
}
watch(() => printer.printState, (s, o) => {
  if (!o || s === o || !PRINT_EVENTS[s]) return
  if (s === 'printing' && o === 'paused') return
  push(...PRINT_EVENTS[s])
})

// ---------- width: measure the content and spring-animate width ----------
// In the header flow the pill takes only its compact width (slotW); an expanded event widens OVER
// its neighbours (like the real Dynamic Island), so the header doesn't wrap and --hb doesn't jump.
const inner = ref(null)
const w = ref(0), slotW = ref(0)
let ro = null
const measure = () => {
  if (!inner.value) return
  w.value = Math.ceil(inner.value.getBoundingClientRect().width)
  if (!ev.value) slotW.value = w.value
}
onMounted(() => {
  measure()
  if (window.ResizeObserver) { ro = new ResizeObserver(measure); ro.observe(inner.value) }
  // Demo enabled before mounting (?demo) is worth announcing too
  if (printer.link === 'demo') push('island.demo', 'info')
})
onBeforeUnmount(() => { ro?.disconnect(); clearTimeout(timer) })
</script>

<template>
  <span class="islot" :style="slotW ? { width: slotW + 'px' } : null">
  <button class="isl" :class="[ev ? 'ex t-' + ev.tone : '', { live: printing, kbad: klippyBad }]" :style="w ? { width: w + 'px' } : null"
          :title="t(klippyBad && ui.klippyHidden ? 'island.klippyShow' : 'island.peekTitle')" @click="peek">
    <span ref="inner" class="in">
      <Transition name="sw">
        <span v-if="ev" :key="'e' + ev.id" class="irow" role="status">
          <svg v-if="ev.tone === 'ok'" class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4 6.6 11.4 12.5 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <svg v-else-if="ev.tone === 'info'" class="ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor" /></svg>
          <svg v-else class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2v5.6M8 11.6v.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          <span class="msg">{{ t(ev.key, ev.params) }}</span>
        </span>
        <span v-else key="idle" class="irow">
          <span class="dot" :class="'l-' + printer.link"></span>
          <span class="lbl">{{ tm(printer.stateLabel) }}</span>
          <span v-if="eta" class="eta" :title="etaFull">{{ eta }}</span>
        </span>
      </Transition>
    </span>
  </button>
  </span>
</template>

<style scoped>
/* --isl-max — limit of the collapsed pill (a long ETA is cut with an ellipsis), --isl-max-ex — of the expanded one */
.islot{--isl-max:min(360px,46vw);--isl-max-ex:min(400px,calc(100vw - 150px));position:relative;z-index:3;flex:none;height:30px;
  transition:width var(--t-spring) var(--spring)}
.isl{position:absolute;left:0;top:0;height:30px;padding:0;border-radius:15px;overflow:hidden;cursor:pointer;pointer-events:auto;
  background:#050506;border:1px solid rgba(255,255,255,.07);color:var(--ink);font:inherit;font-size:12px;letter-spacing:0;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 6px 18px -10px rgba(0,0,0,.8);
  transition:width var(--t-spring) var(--spring),box-shadow var(--t-mid) var(--ease-out),border-color var(--t-mid) var(--ease-out),transform var(--t-spring) var(--spring)}
.isl:active{transform:scale(.96)}
.isl:hover{border-color:rgba(255,255,255,.14)}
.isl:focus-visible{outline:2px solid var(--coral);outline-offset:2px}
.in{display:block;position:relative;width:max-content;max-width:var(--isl-max);height:100%}
.ex .in{max-width:var(--isl-max-ex)}
.irow{display:flex;align-items:center;gap:8px;height:100%;padding:0 13px 0 11px;white-space:nowrap}
.lbl{flex:none;color:var(--ink);font-weight:500}
.eta,.msg{min-width:0;overflow:hidden;text-overflow:ellipsis}
.eta{color:var(--dim)}
.eta::before{content:'·';margin-right:8px;color:var(--dim)}
.msg{font-weight:500}
.ic{width:15px;height:15px;flex:none}

/* Expanded pill: a thin coloured glow by the event tone */
.ex.t-ok{border-color:rgba(var(--green-rgb),.35);box-shadow:0 0 0 1px rgba(var(--green-rgb),.1),0 0 22px -4px rgba(var(--green-rgb),.45)}
.ex.t-ok .ic{color:var(--green)}
.ex.t-info{border-color:rgba(var(--accent-rgb),.35);box-shadow:0 0 22px -4px rgba(var(--accent-rgb),.45)}
.ex.t-info .ic{color:var(--coral)}
.ex.t-warn{border-color:rgba(var(--amber-rgb),.4);box-shadow:0 0 22px -4px rgba(var(--amber-rgb),.45)}
.ex.t-warn .ic{color:#ff9f0a}
.ex.t-err{border-color:rgba(var(--red-rgb),.5);box-shadow:0 0 24px -4px rgba(var(--red-rgb),.6)}
.ex.t-err .ic{color:var(--red)}

.dot{width:7px;height:7px;border-radius:50%;background:var(--dim);flex:none}
.dot.l-open,.dot.l-ready{background:var(--green);box-shadow:0 0 7px rgba(var(--green-rgb),.7)}
.dot.l-demo{background:var(--blue);box-shadow:0 0 7px rgba(120,156,255,.7)}
.dot.l-connecting{background:#ff9f0a;animation:pulse 1.1s cubic-bezier(.45,0,.55,1) infinite}
.dot.l-lost,.dot.l-shutdown{background:var(--red);box-shadow:0 0 7px rgba(var(--red-rgb),.7)}
/* Klipper in error: the red dot pulses with a glow, the pill border is faintly red — "something's wrong, tap here" */
.kbad:not(.ex){border-color:rgba(var(--red-rgb),.38)}
.kbad .dot{background:var(--red);animation:kbad 1.6s cubic-bezier(.45,0,.55,1) infinite}
@keyframes kbad{50%{box-shadow:0 0 0 4px rgba(var(--red-rgb),.18),0 0 10px rgba(var(--red-rgb),.9)}}
.live .dot{background:var(--coral);animation:pulse 2.4s cubic-bezier(.45,0,.55,1) infinite}
@keyframes pulse{50%{opacity:.35;box-shadow:none}}

/* Content change: old content fades out on top (absolute), new appears — the width is already springing */
.sw-enter-active{transition:opacity var(--t-mid) var(--ease-out) .06s,transform var(--t-spring) var(--spring) .06s,filter var(--t-mid) var(--ease-out) .06s}
.sw-leave-active{position:absolute;left:0;top:0;transition:opacity .14s var(--ease-out),filter .14s var(--ease-out)}
.sw-enter-from{opacity:0;transform:scale(.92);filter:blur(3px)}
.sw-leave-to{opacity:0;filter:blur(3px)}

/* 1024×600 printer screen: the header (logo + pill + tabs + STOP) has to fit on one row */
@media(max-width:1100px){.islot{--isl-max:190px}}
/* Phone: an expanded event must not cover STOP and the menu on the right (≈ 200 px with the logo) */
@media(max-width:560px){.islot{--isl-max:44vw;--isl-max-ex:calc(100vw - 206px)}.eta{display:none}}
</style>
