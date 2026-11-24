<script setup>
// One telemetry panel row. It reads its value itself (via get), so temperature updates re-render only the row,
// not the TransitionGroup in StatusPanel: on every group re-render Vue clones the row and forces a layout pass.
import { computed } from 'vue'
import { heatRgb } from '@vyron/shared/format'
import RollNumber from '../../ui/RollNumber.vue'

const props = defineProps({
  rowId: { type: String, required: true },
  /** id → row ({ label, value | text, suffix, decimals, quick, heat, heatRange, ok }) */
  get: { type: Function, required: true },
  open: Boolean
})
const emit = defineEmits(['toggle'])

const r = computed(() => props.get(props.rowId) || {})
// Highlight colour of hot values (nozzle 35…180°, bed 30…100°)
const glow = computed(() => (r.value.heat == null ? null : { '--heat': heatRgb(r.value.heat, ...(r.value.heatRange || [])) }))
const toggle = () => { if (r.value.quick) emit('toggle') }
</script>

<template>
  <div class="rw" :class="{ q: r.quick, on: open, hot: r.heat != null }" :style="glow"
       v-bind="r.quick ? { role: 'button', tabindex: 0, 'aria-haspopup': 'dialog', 'aria-expanded': String(open) } : {}"
       @click="toggle" @keydown.enter.space.prevent="toggle">
    <dt>{{ r.label }}</dt>
    <dd :class="{ ok: r.ok === true, warn: r.ok === false }">
      <RollNumber v-if="r.value != null" :value="r.value" :decimals="r.decimals || 0" :suffix="r.suffix" fade />
      <template v-else>{{ r.text }}</template>
    </dd>
  </div>
</template>

<style scoped>
.rw{position:relative;display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 8px;border-radius:var(--r);max-height:60px;
  transition:background-color var(--t-fast) var(--ease-out),transform var(--t-spring) var(--spring)}
/* Divider between rows — a pseudo-element so it doesn't jump during the height animation */
.rw+.rw::before{content:'';position:absolute;left:8px;right:8px;top:0;height:1px;background:rgba(255,255,255,.06)}
dt{font-size:12px;color:var(--dim);white-space:nowrap}
dd{margin:0;font-size:16px;font-weight:300;white-space:nowrap}
dd.ok{color:var(--ok-ink)}
dd.warn{color:var(--warn-ink)}

/* Interactive rows: a soft highlight, a spring press */
.rw.q{pointer-events:auto;cursor:pointer}
.rw.q:hover{background:rgba(255,255,255,.05)}
.rw.q:active{transform:scale(.97)}
.rw.q.on{background:rgba(255,255,255,.08)}
.rw.q.on::after{content:'';position:absolute;left:0;top:50%;width:3px;height:16px;margin-top:-8px;border-radius:2px;background:var(--coral)}
.rw.q:focus-visible{outline:2px solid var(--coral);outline-offset:-2px}
/* Hot values glow in a warm colour (icy → coral) */
.rw.hot dd{color:rgb(var(--heat));color:color-mix(in srgb,rgb(var(--heat)) 55%,var(--ink));text-shadow:0 0 16px rgba(var(--heat),.5);transition:color 1s var(--ease-out),text-shadow 1s var(--ease-out)}
</style>
