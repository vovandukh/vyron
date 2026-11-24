<script setup>
// Telemetry panel. A row appears only when the feature exists in the Klipper config
// and data has already arrived — no dashes. Rows animate in and out.
// Nozzle, bed, speed and fan open the quick-control popover (QuickSlider).
import { ref, computed, watch } from 'vue'
import { usePrinterStore } from '../../../stores/printerStore'
import { useUiStore } from '../../../stores/uiStore'
import { useI18n } from '../../../composables/useI18n'
import StatusRow from './StatusRow.vue'
import QuickSlider from './QuickSlider.vue'
import PrintControls from './PrintControls.vue'
import ToolPopover from './ToolPopover.vue'

const printer = usePrinterStore()
const ui = useUiStore()
const { t } = useI18n()

/** The layer shows while printing/paused and after the end (final "150 / 150"), not when idle. */
const LAYER_STATES = ['printing', 'paused', 'complete']

const rows = computed(() => {
  const p = printer, out = []
  const num = (id, label, value, o = {}) => { if (value != null && Number.isFinite(value)) out.push({ id, label, value, ...o }) }
  // One toolhead: the toolhead card under the panel shows the nozzle (as on a phone) — the row would duplicate it
  if (p.toolObjects.length > 1) num('nozzle', t('status.nozzle'), p.nozzleTemp, { suffix: '°', quick: true, heat: p.nozzleTemp })
  if (p.hasBed) num('bed', t('status.bed'), p.bedTemp, { suffix: '°', quick: true, heat: p.bedTemp, heatRange: [30, 100] })
  if (p.chamberObj) num('chamber', t('status.chamber'), p.chamberTemp, { suffix: '°' })
  num('speed', t('status.speed'), p.speedFactor == null ? null : p.speedFactor * 100, { suffix: '%', quick: true })
  if (p.hasFan) num('fan', t('status.fan'), p.fanSpeed == null ? null : p.fanSpeed * 100, { suffix: '%', quick: true })
  if (p.position) num('z', t('status.z'), Number(p.position[2]), { decimals: 1, suffix: mmSuffix.value })
  if (LAYER_STATES.includes(p.printState) && p.layerText && p.layerText !== '–') {
    const m = /^(\d+)\s*\/\s*(.+)$/.exec(p.layerText)
    out.push(m ? { id: 'layer', label: t('status.layer'), value: +m[1], suffix: ' / ' + m[2] } : { id: 'layer', label: t('status.layer'), text: p.layerText })
  }
  if (p.leveling && p.qgl != null) {
    out.push({ id: 'level', label: t(p.leveling.kind === 'ztilt' ? 'status.ztilt' : 'status.qgl'), text: t(p.qgl ? 'status.qglDone' : 'status.qglNot'), ok: p.qgl })
  }
  return out
})
// The "mm" unit from the locale ('{v} mm' → ' mm')
const mmSuffix = computed(() => t('unit.mm', { v: '' }))

// The panel template only knows the set of rows (the row key changes only when a row appears or disappears),
// while each StatusRow reads its value itself via getRow. Otherwise every temperature update would re-render
// the TransitionGroup, and Vue clones the row and forces a layout pass (hasCSSTransform).
const rowKey = computed(() => rows.value.map(r => r.id).join('|'))
const rowIds = computed(() => (rowKey.value ? rowKey.value.split('|') : []))
const getRow = id => rows.value.find(r => r.id === id)

// ---------- quick sliders: only one open at a time ----------
const panel = ref(null)
const rowEls = {}
const open = ref(null)
const toggle = id => { open.value = open.value === id ? null : id }
// The row vanished (no data / disconnect) or the tab changed — close its slider.
watch(() => rowIds.value.includes(open.value), has => { if (!has) open.value = null })
watch(() => ui.view, v => { if (v !== 'main') open.value = null })
watch(() => ui.homeTick, () => { open.value = null })   // a click on the logo closes everything
</script>

<template>
  <!-- Right column: the data panel and (with one toolhead) the toolhead card below it -->
  <div class="rcol">
  <Transition name="pn">
    <div v-if="rowIds.length" ref="panel" class="st glass">
      <TransitionGroup tag="dl" name="rw" class="dl">
        <StatusRow v-for="id in rowIds" :key="id" :ref="c => { if (c) rowEls[id] = c.$el }"
                   :row-id="id" :get="getRow" :open="open === id" @toggle="toggle(id)" />
      </TransitionGroup>
      <!-- Print controls: only while printing / paused (not during a 3D preview of another file) -->
      <Transition name="pcx">
        <PrintControls v-if="printer.printBusy && !printer.preview" />
      </Transition>
    </div>
  </Transition>
  <!-- Wrapper: ToolPopover has several root nodes, so a class on the component itself isn't applied —
       and without pointer-events:auto the card inherits none from the column and isn't clickable -->
  <div v-if="printer.toolCount === 1" class="head"><ToolPopover :name="printer.toolObjects[0]" :index="0" inline /></div>
  </div>
  <Transition name="qs">
    <QuickSlider v-if="open && rowEls[open]" :key="open" :kind="open" :anchor="rowEls[open]" :panel="panel" @close="open = null" />
  </Transition>
</template>

<style scoped>
/* Right column: if the toolhead card doesn't fit vertically the column scrolls by itself, the rest of the screen is untouched */
.rcol{position:fixed;top:calc(var(--hb,72px) + 16px);right:36px;bottom:16px;width:min(268px,40vw);display:flex;flex-direction:column;gap:10px;z-index:3;
  overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;pointer-events:none}
.rcol::-webkit-scrollbar{display:none}
/* The bottom of the column fades out — shows the toolhead card can be scrolled (on 1024×600 / 800×480) */
.rcol{-webkit-mask-image:linear-gradient(#000 calc(100% - 22px),transparent);mask-image:linear-gradient(#000 calc(100% - 22px),transparent);padding-bottom:18px}
.rcol>*{flex-shrink:0}
.st{position:relative;margin:0;padding:6px 10px;text-align:left;pointer-events:none;border-radius:var(--r-lg)}
.head{pointer-events:auto;border-radius:var(--r-lg)}
/* The toolhead card is narrower than on a phone: compact fields and buttons */
.head :deep(.body){padding:12px;gap:8px}
.head :deep(.temp){font-size:24px}
.head :deep(button),.head :deep(input){padding:7px 9px;font-size:12px}
.head :deep(.pre button){padding:5px 0}
.dl{display:grid;margin:0}
/* Rows appearing/disappearing: height + opacity */
.rw-enter-active,.rw-leave-active{transition:max-height var(--t-mid) var(--ease-out),opacity var(--t-mid) var(--ease-out),padding var(--t-mid) var(--ease-out);overflow:hidden}
.rw-enter-from,.rw-leave-to{max-height:0;opacity:0;padding-top:0;padding-bottom:0}
.pn-enter-active,.pn-leave-active{transition:opacity var(--t-mid) var(--ease-out),transform var(--t-spring) var(--spring)}
.pn-enter-from,.pn-leave-to{opacity:0;transform:translateY(-6px) scale(.98)}

/* Print controls block — under a thin divider; appears/disappears by height */
.st .pc{border-top:1px solid rgba(255,255,255,.06);margin-top:2px;max-height:120px}
.pcx-enter-active,.pcx-leave-active{transition:max-height var(--t-spring) var(--spring),opacity var(--t-mid) var(--ease-out),padding var(--t-mid) var(--ease-out);overflow:hidden}
.pcx-enter-from,.pcx-leave-to{max-height:0;opacity:0;padding-top:0;padding-bottom:0}

/* Slider popover: a spring scale from the row */
.qs-enter-active{transition:transform var(--t-spring) var(--spring),opacity var(--t-fast) var(--ease-out)}
.qs-leave-active{transition:transform .16s var(--ease-out),opacity .14s var(--ease-out)}
.qs-enter-from{opacity:0;transform:scale(.8)}
.qs-leave-to{opacity:0;transform:scale(.94)}

@media(max-width:700px){.rcol{top:auto;bottom:140px;right:14px;width:min(268px,62vw)}}
/* Short screens (800×480): compact rows so the block doesn't slide under the toolhead strip */
@media(max-height:540px){.st{padding:4px 8px}.rw{padding:5px 8px}dd{font-size:14px}dt{font-size:11px}}
</style>
