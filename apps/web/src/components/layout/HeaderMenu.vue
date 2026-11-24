<script setup>
// Control centre (in the spirit of macOS Control Center): printer connection, demo mode and the system menu.
// Opens only with the "…" button — state in ui.cc.
import { ref, computed, watch, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { usePrinterStore } from '../../stores/printerStore'
import { useUiStore } from '../../stores/uiStore'
import { useConfirm } from '../../composables/useConfirm'
import { useI18n } from '../../composables/useI18n'
import { resolveHost } from '@vyron/shared/moonraker/client'
import { DEMO_BUILD } from '../../config'

// Demo parts (manual connection, demo switch and settings, printer screens) are separate components
// included only in the demo build: the printer build has none of this code.
const DemoTile = DEMO_BUILD ? defineAsyncComponent(() => import('./DemoTile.vue')) : null
const DemoLinks = DEMO_BUILD ? defineAsyncComponent(() => import('./DemoLinks.vue')) : null

const printer = usePrinterStore()
const ui = useUiStore()
const { ask, confirm } = useConfirm()
const { t, tm } = useI18n()

const btn = ref(null)
const onDoc = () => ui.closeCc()
const onKey = e => {
  if (e.key !== 'Escape' || !ui.cc) return
  ui.closeCc()
  btn.value?.focus()
}
onMounted(() => { document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey) })

/** The address we are (or will be) connected to — shown on the printer */
const shownHost = computed(() => printer.host || resolveHost())
/** Tile title: on the printer — the connection state itself ("Connected"), in the demo build — "Connection" */
const LINK_TITLE = { open: 'cc.connected', ready: 'cc.connected', shutdown: 'cc.connected', connecting: 'state.connecting', lost: 'state.lost' }
const linkTitle = computed(() => (DEMO_BUILD ? 'cc.connection' : LINK_TITLE[printer.link] || 'cc.notConnected'))
// ---------- menu ----------
function nav(v) { ui.go(v) }

const SYS = {
  mr: { label: 'menu.restartMoonraker', confirm: 'confirm.restartMoonraker', method: 'machine.services.restart', params: { service: 'moonraker' } },
  reboot: { label: 'menu.reboot', confirm: 'confirm.reboot', method: 'machine.reboot' },
  off: { label: 'menu.shutdown', confirm: 'confirm.shutdown', method: 'machine.shutdown' }
}
async function sys(k) {
  ui.closeCc()
  const a = SYS[k]
  if (await ask(a.confirm)) printer.call(a.method, a.params || {}).catch(() => {})
}

// Factory reset — a hidden button: only on printers prepared by the factory part (vyron_factory entry in
// the Moonraker database). The UI resets nothing itself: it creates the request folder config/vyron-factory-reset,
// which the vyron-factory-reset.path system unit picks up and runs the reset with a reboot (same as on the printer screen).
const factory = ref(false)
watch(() => printer.link, async l => {
  if (l !== 'open' && l !== 'ready') return
  try { factory.value = !!(await printer.call('server.database.get_item', { namespace: 'vyron_factory', key: 'oobe' })).value } catch { factory.value = false }
}, { immediate: true })
async function factoryReset() {
  ui.closeCc()
  if (!(await confirm('scr.factoryAsk', { okKey: 'scr.factory' }))) return
  let note = 'scr.factoryRun'
  try { await printer.call('server.files.post_directory', { path: 'config/vyron-factory-reset' }) } catch { note = 'scr.factoryFail' }
  confirm(note)
}

// The panel springs out of the "…" button.
// offsetLeft/Top rather than getBoundingClientRect: at @enter the scale from .cc-enter-from already applies.
function onEnter(el) {
  const c = ui.cc || {}
  const x = (c.x ?? el.offsetLeft + el.offsetWidth) - el.offsetLeft
  const y = (c.y ?? el.offsetTop) - el.offsetTop - 10
  el.style.transformOrigin = `${Math.round(x)}px ${Math.round(y)}px`
}
</script>

<template>
  <div class="mnu">
    <button ref="btn" class="mbtn" aria-haspopup="dialog" :aria-expanded="String(!!ui.cc)" :aria-label="t('cc.open')"
            @click.stop="ui.toggleCc($event.currentTarget)">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="19" cy="12" r="1.7" fill="currentColor" /></svg>
    </button>

    <Transition name="cc" @enter="onEnter">
      <div v-if="ui.cc" class="cc glass" role="dialog" :aria-label="t('cc.title')" :style="{ top: ui.cc.y + 10 + 'px' }" @click.stop>
        <section class="tile">
          <div class="tile-hd">
            <span class="dot" :class="'l-' + printer.link"></span>
            <b>{{ t(linkTitle) }}</b>
            <span class="st">{{ tm(printer.stateLabel) }}</span>
          </div>
          <!-- On the printer the UI takes the address from the page itself — we only show it; manual connection and demo live in the demo build -->
          <component :is="DemoTile" v-if="DemoTile" />
          <div v-else class="hostRo">
            <small>{{ t('cc.address') }}</small>
            <b :title="shownHost">{{ shownHost || t('island.noHost') }}</b>
          </div>
        </section>

        <div class="list" role="menu">
          <component :is="DemoLinks" v-if="DemoLinks" />
          <button role="menuitem" @click="nav('set')">{{ t('menu.settings') }}</button>
          <button role="menuitem" @click="nav('upd')">{{ t('menu.updates') }}</button>
          <button role="menuitem" @click="nav('net')">{{ t('menu.net') }}</button>
          <hr>
          <button v-for="(a, k) in SYS" :key="k" role="menuitem" :disabled="printer.isPrinting" @click="sys(k)">{{ t(a.label) }}</button>
          <template v-if="factory">
            <hr>
            <button role="menuitem" class="danger" :disabled="printer.isPrinting" @click="factoryReset">{{ t('scr.factory') }}</button>
          </template>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.mnu{position:relative;pointer-events:auto}
.mbtn{background:rgba(20,20,22,calc(1 - 0.4 * var(--glass-t,1)));border:1px solid;border-color:var(--edge-hi) var(--edge-lo) var(--edge-lo) var(--edge-hi);color:var(--ink);position:relative;width:34px;height:34px;border-radius:50%;cursor:pointer;display:grid;place-items:center;
  transition:transform var(--t-spring) var(--spring),color var(--t-fast) var(--ease-out),background-color var(--t-fast) var(--ease-out)}
.mbtn:hover{color:var(--coral);background:rgba(40,40,44,.7)}
.mbtn:active{transform:scale(.9)}
.mbtn[aria-expanded="true"]{color:var(--coral);background:rgba(255,255,255,.1)}

/* ---------- panel ---------- */
.cc{position:fixed;right:32px;width:min(320px,calc(100vw - 32px));max-height:calc(100vh - 90px);overflow:auto;padding:10px;border-radius:var(--r-xl);display:grid;grid-template-columns:minmax(0,1fr);gap:8px;z-index:30;text-align:left;color:var(--ink);font-size:13px;letter-spacing:0}
.tile{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.05);border-radius:16px;padding:12px;display:grid;gap:10px}
.tile-hd{display:flex;align-items:center;gap:8px;font-size:13px}
.tile-hd b{font-weight:600}
.tile-hd .st{margin-left:auto;color:var(--dim);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}
.dot{width:8px;height:8px;border-radius:50%;background:var(--dim);flex:none}
.dot.l-open,.dot.l-ready{background:var(--green);box-shadow:0 0 8px rgba(var(--green-rgb),.6)}
.dot.l-demo{background:var(--blue);box-shadow:0 0 8px rgba(120,156,255,.6)}
.dot.l-connecting{background:#ff9f0a;animation:blink 1.1s cubic-bezier(.45,0,.55,1) infinite}
.dot.l-lost,.dot.l-shutdown{background:var(--red);box-shadow:0 0 8px rgba(var(--red-rgb),.6)}
@keyframes blink{50%{opacity:.3}}

/* Read-only printer address (printer build) */
.hostRo{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:9px 11px;border-radius:var(--r);background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.06)}
.hostRo small{color:var(--dim);font-size:11px;white-space:nowrap}
.hostRo b{font:500 13px/1.2 var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}

.list{display:grid;gap:1px;padding:2px}
.list button{background:none;border:0;color:var(--ink);font:inherit;font-size:13px;text-align:left;padding:10px 12px;border-radius:var(--r);cursor:pointer;
  transition:background-color var(--t-fast) var(--ease-out),transform var(--t-spring) var(--spring)}
.list button:hover:not(:disabled){background:rgba(255,255,255,.07)}
.list button:active:not(:disabled){transform:scale(.98);background:rgba(255,255,255,.1)}
.list button:disabled{opacity:.35;cursor:not-allowed}
.list button.danger{color:var(--red)}
.list hr{border:0;border-top:1px solid rgba(255,255,255,.07);margin:4px 8px;width:auto}
.mbtn:focus-visible,.list button:focus-visible{outline:2px solid var(--coral);outline-offset:2px}

/* Enter — a scale spring from the source button; leave — short and without overshoot */
.cc-enter-active{transition:transform var(--t-spring) var(--spring),opacity var(--t-fast) var(--ease-out)}
.cc-leave-active{transition:transform .2s var(--ease-out),opacity .16s var(--ease-out)}
.cc-enter-from{opacity:0;transform:scale(.55)}
.cc-leave-to{opacity:0;transform:scale(.9)}

@media(max-width:900px){.cc{right:16px}}
/* Touch screens: 44×44 hit area without changing the look */
@media(pointer:coarse){.mbtn::before{content:'';position:absolute;inset:-5px;border-radius:50%}}
</style>
