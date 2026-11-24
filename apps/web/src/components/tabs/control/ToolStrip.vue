<script setup>
// Toolhead strip: exactly as many buttons as extruders found in Klipper (1…N).
// A click on a toolhead opens/closes its dropdown (ToolPopover).
// Each pill is tinted by its toolhead's heat (icy ≤35° → coral ≥180°); the active one has an outline and glow.
import { ref, watch } from 'vue'
import { usePrinterStore } from '../../../stores/printerStore'
import { useUiStore } from '../../../stores/uiStore'
import { toolNum } from '@vyron/shared/klipper/objects'
import { heatRgb } from '@vyron/shared/format'
import ToolPopover from './ToolPopover.vue'

/** Mobile layout: pills in a grid of 3 without scrolling, the toolhead menu expands below them in the flow (not on top) */
const props = defineProps({ inline: { type: Boolean, default: false } })

const printer = usePrinterStore()
const ui = useUiStore()
const cols = () => Math.min(3, printer.toolObjects.length)
/** After expanding — scroll the column so the toolhead card is fully visible */
const accEl = ref(null)
function reveal() { accEl.value?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }

const tempOf = name => (printer.st[name] || {}).temperature
const temp = name => {
  const v = tempOf(name)
  return v == null ? '—' : Math.round(v) + '°'
}
const heat = name => ({ '--heat': heatRgb(tempOf(name)) })
/** Toolhead board (EBBCan, SB2209…) — only with up to three toolheads; the main board isn't shown */
const board = name => {
  // In the three-column mobile grid the board name doesn't fit
  if (printer.toolObjects.length > 3 || (props.inline && printer.toolObjects.length === 3)) return ''
  const th = printer.toolheads[name]
  return th && th.mcu && th.mcu !== 'mcu' ? th.mcu : ''
}

/** Open menu: { name, index, anchor } or null. */
const open = ref(null)
const btns = {}

function toggle(name, index) {
  open.value = open.value && open.value.name === name ? null : { name, index, anchor: btns[name] }
}
const close = () => { open.value = null }

// The menu closes when the strip goes away: another tab, the toolhead vanished from the config, a reconnect.
watch(() => ui.view, v => { if (v !== 'main') close() })
watch(() => ui.homeTick, close)   // a click on the logo closes everything
watch(() => printer.toolObjects, list => { if (open.value && !list.includes(open.value.name)) close() })

</script>

<template>
  <!-- Several toolheads — a row of glass pills: ● T0 205° | EBBCan ⌄ (board shown with up to three, otherwise the row doesn't fit).
       One toolhead — no strip: its card sits under the data panel (StatusPanel / MobileControl). -->
  <div v-if="printer.toolObjects.length > 1" class="tools" :class="{ many: printer.toolObjects.length > 3, inl: inline }"
       :style="inline ? { gridTemplateColumns: `repeat(${cols()}, minmax(0, 1fr))` } : null">
    <button v-for="(name, i) in printer.toolObjects" :key="name" :ref="el => { if (el) btns[name] = el }" type="button" class="pill glass"
            :class="{ active: name === printer.activeToolName, open: open && open.name === name }" :style="heat(name)"
            :title="name" aria-haspopup="dialog" :aria-expanded="String(!!(open && open.name === name))"
            @click="toggle(name, i)">
      <i class="hd" aria-hidden="true"></i>
      <b>T{{ toolNum(name) }}</b>
      <span class="tp">{{ temp(name) }}</span>
      <span v-if="board(name)" class="bd">{{ board(name) }}</span>
      <svg class="cv" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></svg>
    </button>
  </div>
  <ToolPopover v-if="open && !inline" :key="open.name" :name="open.name" :index="open.index" :anchor="open.anchor" @close="close" />
  <!-- Mobile: an accordion — the toolhead card smoothly pushes the content below the pills -->
  <Transition v-if="inline" name="acc" @after-enter="reveal">
    <div v-if="open" ref="accEl" class="acc">
      <div class="acc-in">
        <Transition name="accx" mode="out-in">
          <ToolPopover :key="open.name" :name="open.name" :index="open.index" inline />
        </Transition>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Row of toolhead pills centred above the bottom of the screen; scrolls sideways if it doesn't fit */
.tools{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;display:flex;gap:8px;z-index:4;padding:6px;max-width:94vw;overflow-x:auto;scrollbar-width:none}
.tools::-webkit-scrollbar{display:none}
.pill{flex:none;display:flex;align-items:center;gap:8px;height:40px;padding:0 12px 0 11px;border-radius:999px;font:inherit;font-size:12.5px;color:var(--ink);cursor:pointer;
  transition:transform var(--t-spring) var(--spring),border-color var(--t-mid) var(--ease-out),box-shadow 1s var(--ease-out),background-color var(--t-fast) var(--ease-out)}
.pill:hover{background-color:rgba(40,40,44,.75)}
.pill:active{transform:scale(.96)}
/* Active toolhead: a thin outline and glow in its heat colour */
.pill.active{border-color:rgba(var(--heat),.55);box-shadow:0 0 0 1px rgba(var(--heat),.25),0 8px 22px -8px rgba(var(--heat),.7),var(--glass-shadow)}
.pill.open{border-color:rgba(255,255,255,.45)}
.hd{width:8px;height:8px;border-radius:50%;background:rgb(var(--heat));opacity:.55;transition:background-color 1s var(--ease-out),opacity var(--t-mid) var(--ease-out)}
.active .hd{opacity:1;box-shadow:0 0 8px rgba(var(--heat),.9)}
.pill b{font-weight:600}
.tp{color:rgb(var(--heat));color:color-mix(in srgb,rgb(var(--heat)) 75%,var(--dim));transition:color 1s var(--ease-out)}
.active .tp{color:rgb(var(--heat))}
.bd{padding-left:8px;border-left:1px solid rgba(255,255,255,.12);color:var(--dim)}
.cv{width:13px;height:13px;fill:none;stroke:var(--dim);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;transition:transform var(--t-spring) var(--spring)}
.open .cv{transform:rotate(180deg)}
.pill:focus-visible{outline:2px solid var(--coral);outline-offset:2px}
/* Many toolheads: more compact, no chevron */
.many .pill{gap:6px;padding:0 11px 0 10px}
.many .cv{display:none}
@media(max-width:900px){.pill{height:36px;font-size:12px;gap:6px;padding:0 10px}}
/* ---------- mobile grid: 3 per row, no scrolling ---------- */
.tools.inl{position:relative;left:auto;bottom:auto;transform:none;max-width:none;width:100%;display:grid;gap:8px;padding:2px 0;overflow:visible}
.inl .pill{width:100%;min-width:0;justify-content:center;height:40px;padding:0 8px}
.inl .bd{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.inl.many .cv,.inl .cv{display:block}
/* Narrow phone: at half width the board name would just be cut to "EBB…" */
@media(max-width:420px){.inl .bd{display:none}}
/* Accordion: height 0fr → 1fr (grid trick), the content fades in smoothly */
.acc{display:grid;grid-template-rows:1fr;margin-top:8px}
.acc-in{min-height:0;overflow:hidden}
.acc-enter-active,.acc-leave-active{transition:grid-template-rows var(--t-spring) var(--spring),margin-top var(--t-spring) var(--spring),opacity var(--t-mid) var(--ease-out)}
.acc-enter-from,.acc-leave-to{grid-template-rows:0fr;margin-top:0;opacity:0}
/* Switching between toolheads inside an open accordion */
.accx-enter-active,.accx-leave-active{transition:opacity .16s var(--ease-out)}
.accx-enter-from,.accx-leave-to{opacity:0}

/* The strip is lifted only on narrow screens where it would otherwise cover the big "100%" on the left. */
@media(max-width:700px){.tools:not(.inl){bottom:62px}}
</style>
