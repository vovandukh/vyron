<script setup>
// Filament in the toolhead menu: Unload / Load and manual feed (length × speed, back / forward).
// Logic and G-code are shared with Vyron Screen (@vyron/shared/klipper/filament): LOAD_/UNLOAD_FILAMENT macros if present.
// Feeding goes to the active extruder, so for an inactive toolhead the buttons are disabled with a hint. During a print — only when paused.
import { computed, ref, watch } from 'vue'
import { usePrinterStore } from '../../../stores/printerStore'
import { useI18n } from '../../../composables/useI18n'
import { toolNum } from '@vyron/shared/klipper/objects'
import { FIL_LENGTHS, FIL_SPEEDS, FIL_DEFAULT, FIL_LOAD, FIL_UNLOAD, extruderLimits, canExtrude, extrudeScript, loadScript, unloadScript } from '@vyron/shared/klipper/filament'

const props = defineProps({ name: { type: String, required: true } })
const printer = usePrinterStore()
const { t, tm } = useI18n()

// Length, speed and collapsed state are remembered between menu openings
const KEY = 'vyron.filament'
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} } })()
const len = ref(FIL_LENGTHS.includes(saved.len) ? saved.len : FIL_DEFAULT.len)
const speed = ref(FIL_SPEEDS.includes(saved.speed) ? saved.speed : FIL_DEFAULT.speed)
const open = ref(saved.open !== false)
watch([len, speed, open], () => { try { localStorage.setItem(KEY, JSON.stringify({ len: len.value, speed: speed.value, open: open.value })) } catch { /* private mode */ } })

const ex = computed(() => printer.st[props.name] || {})
const lim = computed(() => printer.extruderCfg[props.name] || extruderLimits())
const hot = computed(() => canExtrude(ex.value, lim.value.minTemp))
const isActive = computed(() => !printer.canSwitchTools || props.name === printer.activeToolName)
const macros = computed(() => printer.filMacros)

/** Why the buttons are disabled (or null — allowed) */
const block = computed(() => {
  if (printer.isPrinting) return { key: 'fil.printing' }
  if (!isActive.value) return { key: 'fil.notActive', params: { i: toolNum(props.name) } }
  if (!hot.value) return { key: 'fil.cold', params: { t: ex.value.temperature == null ? '–' : Math.round(ex.value.temperature), min: lim.value.minTemp } }
  return null
})
const busy = computed(() => printer.filBusy)
const msg = ref(null)

async function go(kind) {
  if (block.value || busy.value) return
  const max = lim.value.maxDist
  const script = kind === 'load' ? loadScript(macros.value, max)
    : kind === 'unload' ? unloadScript(macros.value, max)
    : extrudeScript(kind === 'retract' ? -len.value : len.value, speed.value, max)
  msg.value = null
  try {
    await printer.runFilament(kind, script)
    msg.value = { key: 'fil.done.' + kind, params: { n: len.value } }
  } catch (e) {
    msg.value = { raw: String((e && e.message) || e).replace(/^!!\s*/, '') }
  }
}

const loadHint = computed(() => (macros.value.load ? macros.value.load : t('fil.mm', { n: FIL_LOAD })))
const unloadHint = computed(() => (macros.value.unload ? macros.value.unload : t('fil.mm', { n: FIL_UNLOAD })))
</script>

<template>
  <section class="fil" :class="{ closed: !open }">
    <button class="fh" :aria-expanded="String(open)" @click="open = !open">
      <span>{{ t('fil.title') }}</span>
      <small v-if="block" class="warn">{{ tm(block) }}</small>
      <svg viewBox="0 0 16 16" class="chev"><path d="M4.5 6.5 8 10l3.5-3.5" /></svg>
    </button>
    <template v-if="open">
      <div class="big">
        <button :disabled="!!block || !!busy" :title="unloadHint" @click="go('unload')">
          <i v-if="busy === 'unload'" class="spin"></i>
          <span>{{ t('fil.unload') }}<small>{{ unloadHint }}</small></span>
        </button>
        <button :disabled="!!block || !!busy" :title="loadHint" @click="go('load')">
          <i v-if="busy === 'load'" class="spin"></i>
          <span>{{ t('fil.load') }}<small>{{ loadHint }}</small></span>
        </button>
      </div>

      <div class="opt" role="radiogroup" :aria-label="t('fil.len')">
        <span class="ol">{{ t('fil.len') }}</span>
        <button v-for="v in FIL_LENGTHS" :key="v" role="radio" :aria-checked="String(len === v)" :class="{ on: len === v }" @click="len = v">{{ v }}</button>
      </div>
      <div class="opt" role="radiogroup" :aria-label="t('fil.speed')">
        <span class="ol">{{ t('fil.speed') }}</span>
        <button v-for="v in FIL_SPEEDS" :key="v" role="radio" :aria-checked="String(speed === v)" :class="{ on: speed === v }" @click="speed = v">{{ v }}</button>
      </div>
      <div class="man">
        <button :disabled="!!block || !!busy" @click="go('retract')">
          <i v-if="busy === 'retract'" class="spin"></i>{{ t('fil.retract', { n: len }) }}
        </button>
        <button :disabled="!!block || !!busy" @click="go('extrude')">
          <i v-if="busy === 'extrude'" class="spin"></i>{{ t('fil.extrude', { n: len }) }}
        </button>
      </div>
      <div v-if="msg" class="fm" :class="{ bad: msg.raw }">{{ tm(msg) }}</div>
    </template>
  </section>
</template>

<style scoped>
.fil{display:grid;gap:7px;padding-top:9px;border-top:1px solid var(--line);min-width:0}
/* The same buttons as in the toolhead menu (its styles are scoped and don't reach here) */
.fil button{background:var(--surface-hi);border:1px solid var(--field-bd);color:var(--ink);font:inherit;font-size:12px;border-radius:var(--r);padding:7px 10px;min-width:0;
  cursor:pointer;transition:transform var(--t-spring) var(--spring),background-color var(--t-fast) var(--ease-out)}
.fil button:active:not(:disabled){transform:scale(.95)}
.fil button:hover:not(:disabled){background-color:rgba(255,255,255,.1)}
.fil button:disabled{opacity:.35;cursor:not-allowed}
.fil .fh{display:flex;align-items:center;gap:8px;width:100%;padding:2px 0;background:transparent;border:0;text-align:left;font-size:12px;font-weight:600;letter-spacing:.04em}
.fil .fh:hover:not(:disabled){background:transparent}
.fh .warn{flex:1;min-width:0;font-weight:400;letter-spacing:0;color:var(--warn-ink);font-size:11px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fh span{flex:none}
.fh .warn + .chev{margin-left:0}
.chev{flex:none;margin-left:auto;width:14px;height:14px;fill:none;stroke:var(--dim);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:transform var(--t-fast) var(--ease-out)}
.closed .chev{transform:rotate(-90deg)}
.big{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px}
.fil .big button{display:flex;align-items:center;justify-content:center;gap:7px;padding:7px 8px}
.big svg{flex:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.big span{display:grid;gap:1px;min-width:0;font-weight:600;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.big small{font-weight:400;font-size:10.5px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.opt{display:flex;align-items:center;gap:4px}
.ol{flex:none;width:64px;line-height:1.2;color:var(--dim);font-size:11px}
.fil .opt button{flex:1;min-width:0;padding:5px 0;font-variant-numeric:tabular-nums}
.fil .opt button.on{background:rgba(var(--accent-rgb),.16);border-color:rgba(var(--accent-rgb),.55);color:var(--ink)}
.man{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px}
.man button,.big button{position:relative}
.fm{color:var(--dim);font-size:11px}
.fm.bad{color:var(--danger-ink)}
.spin{flex:none;width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:var(--coral);animation:fspin .8s linear infinite;display:inline-block;vertical-align:-2px;margin-right:6px}
.big .spin{margin-right:0}
@keyframes fspin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}}
@media(max-height:540px){.fil{gap:5px;padding-top:6px}.fil .big button{padding:5px 9px}.fil .opt button{padding:3px 0}}
</style>
