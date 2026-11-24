<script setup>
// Odometer: every digit is a vertical 0…9 strip that rolls smoothly to the new value
// (transform with soft easing and no overshoot; the GPU animates, Vue re-renders only when the number changes).
// The cell edges fade out (mask), so a digit rolling in or out isn't cut in half.
// Digits are keyed from the end of the number, so a new digit (99 → 100) doesn't shift the others' animation.
// The value updates at most once per `throttle` ms: with frequent updates
// (the demo — every 40 ms) the digits would never settle and would look blurred.
import { ref, computed, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  value: { type: Number, default: null },
  decimals: { type: Number, default: 0 },
  suffix: { type: String, default: '' },
  // At most once per 0.8 s: the roll (~0.35 s) finishes and the digit stands sharp
  throttle: { type: Number, default: 800 },
  // Large numbers (print percent): the whole number cross-fades instead of rolling — at a large size
  // the strip's in-between frames show as "ghosts"
  fade: { type: Boolean, default: false }
})

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

// ---------- throttling (first value at once, then at most once per throttle, the last one is never lost) ----------
const shown = ref(props.value)
let last = 0, timer = 0
watch(() => props.value, v => {
  const wait = props.throttle - (Date.now() - last)
  clearTimeout(timer)
  if (wait <= 0) { shown.value = v; last = Date.now() } else timer = setTimeout(() => { shown.value = props.value; last = Date.now() }, wait)
})
onBeforeUnmount(() => clearTimeout(timer))

const chars = computed(() => {
  const v = shown.value
  if (v == null || !Number.isFinite(v)) return []
  const s = v.toFixed(props.decimals)
  const n = s.length
  return [...s].map((c, i) => ({ c, key: n - i, d: c >= '0' && c <= '9' ? +c : null }))
})
const label = computed(() => (chars.value.length ? chars.value.map(x => x.c).join('') + props.suffix : ''))
</script>

<template>
  <!-- The real value as invisible text: screen readers read it and copying takes it
       (otherwise all the 0…9 strips would be copied). The strips themselves can't be selected. -->
  <span v-if="fade" class="rn rn-f">
    <span class="rn-txt">{{ label }}</span>
    <Transition name="rnf"><span :key="label" class="rn-fv" aria-hidden="true">{{ chars.map(x => x.c).join('') }}</span></Transition>
    <span v-if="suffix && chars.length" class="rn-sfx" aria-hidden="true">{{ suffix }}</span>
  </span>
  <span v-else class="rn">
    <span class="rn-txt">{{ label }}</span>
    <span v-for="ch in chars" :key="ch.key" class="rn-ch" aria-hidden="true">
      <span v-if="ch.d != null" class="rn-strip" :style="{ transform: `translateY(${-ch.d * 10}%)` }">
        <span v-for="d in DIGITS" :key="d">{{ d }}</span>
      </span>
      <template v-else>{{ ch.c }}</template>
    </span>
    <span v-if="suffix && chars.length" class="rn-sfx" aria-hidden="true">{{ suffix }}</span>
  </span>
</template>

<style scoped>
.rn{position:relative;display:inline-flex;align-items:baseline;white-space:nowrap;font-variant-numeric:tabular-nums}
.rn-ch,.rn-sfx,.rn-fv{-webkit-user-select:none;user-select:none}
.rn-txt{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
/* Cross-fade: old and new number in one grid cell, one fades out, the other in */
.rn-f{display:inline-grid;grid-auto-flow:column;align-items:baseline}
.rn-f > .rn-fv{grid-area:1 / 1;display:inline-block}
.rnf-enter-active,.rnf-leave-active{transition:opacity .45s ease,filter .45s ease}
.rnf-enter-from,.rnf-leave-to{opacity:0;filter:blur(2px)}
@media (prefers-reduced-motion:reduce){.rnf-enter-active,.rnf-leave-active{transition:none}}
/* Cell height = line-height; the 10-digit strip moves by 10% per digit */
.rn-ch{position:relative;display:inline-block;height:var(--rn-h,1.15em);line-height:var(--rn-h,1.15em);overflow:hidden;vertical-align:bottom;
  -webkit-mask-image:linear-gradient(180deg,transparent 0,#000 14%,#000 86%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 14%,#000 86%,transparent 100%)}
.rn-strip{display:flex;flex-direction:column;transition:transform .36s cubic-bezier(.22,.9,.3,1);will-change:transform}
@media (prefers-reduced-motion:reduce){.rn-strip{transition:none}}
.rn-strip>span{display:block;height:var(--rn-h,1.15em);text-align:center}
/* white-space:pre — so a leading space in the suffix (" mm", " / 150") isn't eaten */
.rn-sfx{display:inline-block;height:var(--rn-h,1.15em);line-height:var(--rn-h,1.15em);vertical-align:bottom;white-space:pre}
</style>
