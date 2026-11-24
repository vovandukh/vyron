<script setup>
// Bed mesh value table; the front of the bed at the bottom (rows in reverse order).
// Round bed: cells outside the circle are empty (Klipper doesn't probe them).
import { computed } from 'vue'
import { meshInside } from '@vyron/shared/klipper/bed'

const props = defineProps({
  matrix: { type: Array, required: true },
  lim: { type: Number, required: true },
  round: { type: Boolean, default: false }
})

const cells = computed(() => {
  const R = props.matrix.length
  return props.matrix.slice().reverse().flatMap((r, ri) => r.map((v, c) => {
    if (props.round && !meshInside(R - 1 - ri, c, R, r.length)) return { out: true }
    const t = v / props.lim
    return { v: v.toFixed(3), bg: t < 0 ? `rgba(80,140,255,${-t * 0.8})` : `rgba(var(--red-rgb),${t * 0.8})` }
  }))
})
</script>

<template>
  <div class="mesh" :style="{ gridTemplateColumns: `repeat(${matrix[0].length},1fr)`, '--cols': matrix[0].length }">
    <div v-for="(c, i) in cells" :key="i" :class="{ out: c.out }" :style="{ background: c.bg }">{{ c.v }}</div>
  </div>
</template>

<style scoped>
/* The font adapts to the column count (container query): otherwise a 9×9 or larger grid didn't fit at 800px
   and numbers were cut. Wide screens keep 11px. */
.mesh{display:grid;gap:4px;align-content:start;max-height:100%;overflow:auto;font-size:11px;container-type:inline-size}
.mesh div{padding:8px 2px;min-width:0;overflow:hidden;text-align:center;border:1px solid rgba(255,255,255,.05);border-radius:6px;font-weight:300;
  font-size:clamp(7px,calc((100cqw - (var(--cols) - 1) * 4px) / var(--cols) / 4.2),11px);letter-spacing:-.02em}
.mesh div.out{border-color:transparent}
@media(max-width:900px){.mesh div{padding:6px 0}}
@media(max-width:700px){.mesh{max-height:180px}}
</style>
