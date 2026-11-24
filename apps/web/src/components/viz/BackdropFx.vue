<script setup>
// Background layers under the 3D scene (above the base hexagon grid from main.css):
//  • a central glow in the heat colour of the active extruder (icy ↔ coral);
//  • a hexagon "flashlight" under the cursor — the same grid, brighter, masked around the pointer;
//  • a vignette dissolving the grid at the screen edges.
// The cursor updates only two CSS variables once per frame; on touch screens (no hover) the flashlight is off.
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { usePrinterStore } from '../../stores/printerStore'
import { heatRgb } from '@vyron/shared/format'

const printer = usePrinterStore()
const heat = computed(() => heatRgb(printer.nozzleTemp ?? 25))

const root = document.documentElement
let raf = 0, x = 0, y = 0
const onMove = e => {
  x = e.clientX; y = e.clientY
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    root.style.setProperty('--mx', x + 'px')
    root.style.setProperty('--my', y + 'px')
    root.style.setProperty('--mon', '1')
  })
}
const onLeave = () => root.style.setProperty('--mon', '0')
const hover = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches
onMounted(() => {
  if (!hover) return
  addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerleave', onLeave)
})
onBeforeUnmount(() => {
  removeEventListener('pointermove', onMove)
  document.removeEventListener('pointerleave', onLeave)
  cancelAnimationFrame(raf)
})
</script>

<template>
  <div class="fx" aria-hidden="true" :style="{ '--amb': heat }">
    <div class="amb"></div>
    <div v-if="hover" class="lamp"></div>
    <div class="vig"></div>
  </div>
</template>

<style scoped>
.fx{position:fixed;inset:0;z-index:-1;pointer-events:none}
.fx>div{position:absolute;inset:0}
/* Warm/cold glow behind the model; the colour follows the nozzle temperature */
.amb{opacity:var(--glow-k,1);background:radial-gradient(ellipse 42% 38% at 50% 58%,rgba(var(--amb),.13),rgba(var(--amb),.04) 55%,transparent 75%);transition:background 1.2s var(--ease-out)}
/* Flashlight: a brighter copy of the hexagons in the accent colour, visible only in a circle around the cursor.
   The colour is the layer background, the shape is the intersection of two masks: the hexagon grid and the circle. */
.lamp{opacity:calc(var(--mon,0) * min(1, var(--grid-k,1)));transition:opacity .6s var(--ease-out);background:rgba(var(--accent-rgb),.3);
  --hex:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='97' viewBox='0 0 56 97'%3E%3Cpath d='M28 0 56 16.17V48.5L28 64.67 0 48.5V16.17ZM28 64.67V97' fill='none' stroke='%23000' stroke-width='1'/%3E%3C/svg%3E");
  -webkit-mask-image:var(--hex),radial-gradient(circle 190px at var(--mx,50%) var(--my,50%),#000,transparent 100%);
  mask-image:var(--hex),radial-gradient(circle 190px at var(--mx,50%) var(--my,50%),#000,transparent 100%);
  -webkit-mask-size:56px 97px,100% 100%;mask-size:56px 97px,100% 100%;-webkit-mask-repeat:repeat,no-repeat;mask-repeat:repeat,no-repeat;
  -webkit-mask-composite:source-in;mask-composite:intersect}
/* Vignette: the grid sinks softly into darkness at the edges */
.vig{opacity:min(1, var(--glow-k,1));background:radial-gradient(ellipse 90% 85% at 50% 50%,transparent 58%,rgba(5,5,6,.32) 84%,rgba(5,5,6,.6) 100%)}
</style>
