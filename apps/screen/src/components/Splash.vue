<script setup>
// Vyron Screen launch animation. It starts from the very frame the printer's boot animation ends on
// (logo centred, three dots below — install/splash, the vyron-splash service), so boot and UI read as
// one animation. Once the printer is ready: a shine sweeps the logo, VYRON appears,
// the logo flies into its place in the top bar and the UI fades in below.
// Only transform and opacity — as smooth on a GPU-less SPI screen as the prototype apps/screen/demo/boot.html.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BAND, D, HOLE, VIEWBOX } from '@vyron/shared/logo'

const props = defineProps({ ready: Boolean })
const emit = defineEmits(['done'])

const MIN_SHOW = 1200 // at least one dot cycle, so it doesn't flash when the printer answers instantly
const FLY_AT = 1350 // ms after launch: the logo starts flying to the top bar
const END_AT = 2000

const root = ref(null)
const fly = ref(null)
const launching = ref(false)
const shown = performance.now()
const timers = []
const later = (fn, ms) => timers.push(setTimeout(fn, ms))

/** Where to fly: centre and size of the top bar logo (hidden while the animation runs) */
function target() {
  const logo = document.querySelector('.tb .logo')
  const f = fly.value
  if (!logo || !f) return null
  const l = logo.getBoundingClientRect(), r = f.getBoundingClientRect()
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10
  const s = l.width / r.width
  const lift = -2.2 * rem // .mark is lifted inside .fly, at scale s
  return {
    x: l.left + l.width / 2 - (r.left + r.width / 2),
    y: l.top + l.height / 2 - (r.top + r.height / 2) - lift * s,
    s
  }
}

async function launch() {
  if (launching.value) return
  await nextTick()
  const t = target()
  if (t) {
    root.value.style.setProperty('--tx', t.x + 'px')
    root.value.style.setProperty('--ty', t.y + 'px')
    root.value.style.setProperty('--s', t.s)
  }
  launching.value = true
  later(() => document.documentElement.classList.remove('splashing'), END_AT - 60)
  later(() => emit('done'), END_AT)
}

function maybeLaunch() {
  if (!props.ready) return
  const wait = MIN_SHOW - (performance.now() - shown)
  if (wait > 0) later(launch, wait)
  else launch()
}

onMounted(() => {
  document.documentElement.classList.add('splashing')
  // The boot animation (vyron-splash) keeps drawing over X until this splash shows up: once it has
  // painted (two frames) we tell it to stop — the same picture is on screen, so there is no seam.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fetch('http://127.0.0.1:7138/painted', { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
  }))
  // Reduced motion — straight to the UI
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.remove('splashing')
    emit('done')
    return
  }
  maybeLaunch()
  // Printer doesn't answer — don't spin forever: the UI itself shows "Connecting…" or the error
  later(launch, 15000)
})
watch(() => props.ready, maybeLaunch)
onBeforeUnmount(() => {
  timers.forEach(clearTimeout)
  document.documentElement.classList.remove('splashing')
})

const half = (id, x0, x1) =>
  `<defs><clipPath id="${id}"><rect x="${x0}" y="-20" width="${x1 - x0}" height="90"/></clipPath></defs>` +
  `<path d="${BAND}" fill="var(--brand)" clip-path="url(#${id})"/>`
const MARK =
  `<svg viewBox="${VIEWBOX}">${half('sp-l', -10, 32.3)}${half('sp-r', 31.7, 80)}` +
  `<path d="${D}" fill="var(--brand)"/><path d="${HOLE}" fill="#000" fill-opacity=".38"/></svg>`
const MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}"><path d="${BAND}"/><path d="${D}"/></svg>`)}")`
const LETTERS = ['V', 'Y', 'R', 'O', 'N']
</script>

<template>
  <div ref="root" class="splash" :class="{ go: launching }" :style="{ '--mask': MASK }" aria-hidden="true">
    <div class="bg"></div>
    <div ref="fly" class="fly">
      <div class="mark">
        <span v-html="MARK"></span>
        <div class="shine"><i></i></div>
      </div>
    </div>
    <div class="dots"><b></b><b></b><b></b></div>
    <div class="word"><span v-for="(c, i) in LETTERS" :key="i" :style="{ '--i': i }">{{ c }}</span></div>
    <div class="tag">Klipper UI</div>
  </div>
</template>

<style scoped>
/* Sizes match the printer boot animation (480×320, 1rem = 10px): 11.2rem logo centred, dots 7.8rem below */
.splash{position:fixed;inset:0;z-index:1000;pointer-events:none;--ease:cubic-bezier(.32,.72,0,1)}
.bg{position:absolute;inset:0;background:#060607}
.fly{position:absolute;left:50%;top:50%;width:11.2rem;height:11.2rem;margin:-5.6rem 0 0 -5.6rem;will-change:transform}
.mark{position:absolute;inset:0;will-change:transform}
.mark span,.mark :deep(svg){position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}
.shine{position:absolute;inset:0;overflow:hidden;opacity:0;-webkit-mask:var(--mask) center/100% 100% no-repeat;mask:var(--mask) center/100% 100% no-repeat}
.shine i{position:absolute;top:-10%;bottom:-10%;left:0;width:34%;transform:translateX(-120%) skewX(-18deg);will-change:transform;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent)}
.dots{position:absolute;left:0;right:0;top:calc(50% + 7.8rem);display:flex;justify-content:center;gap:.9rem}
.dots b{width:.6rem;height:.6rem;border-radius:50%;background:rgba(255,255,255,.85);opacity:.25;animation:pulse 1.2s ease-in-out infinite}
.dots b:nth-child(2){animation-delay:.2s}
.dots b:nth-child(3){animation-delay:.4s}
.word{position:absolute;left:0;right:0;top:calc(50% + 4.6rem);display:flex;justify-content:center;
  font-size:2.4rem;font-weight:700;letter-spacing:.26em;padding-left:.26em;color:#f5f5f7}
.word span{opacity:0;will-change:transform,opacity}
.tag{position:absolute;left:0;right:0;top:calc(50% + 8rem);text-align:center;font-size:1.1rem;letter-spacing:.18em;
  text-transform:uppercase;color:#8e8e93;opacity:0}
@keyframes pulse{0%,100%{opacity:.25}35%{opacity:1}70%{opacity:.25}}

/* ===== Launch ===== */
.go .dots{animation:out .18s ease-in both}
.go .dots b{animation:none}
.go .shine{opacity:1}
.go .shine i{animation:sweep .65s var(--ease) .12s both}
.go .mark{animation:lift .42s var(--ease) .28s both}
.go .word span{animation:letter .38s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(.42s + var(--i) * .05s)}
.go .word{animation:out .22s ease-in 1.33s both}
.go .tag{animation:in .3s ease-out .76s both,out .22s ease-in 1.33s forwards}
.go .fly{animation:toBar .56s var(--ease) 1.35s both}
.go .bg{animation:out .45s ease-out 1.4s both}
@keyframes sweep{from{transform:translateX(-120%) skewX(-18deg)}to{transform:translateX(330%) skewX(-18deg)}}
@keyframes lift{from{transform:none}to{transform:translateY(-2.2rem)}}
@keyframes letter{from{opacity:0;transform:translateY(.8rem)}to{opacity:1;transform:none}}
@keyframes toBar{from{transform:none}to{transform:translate(var(--tx,-21.2rem),var(--ty,-13.1rem)) scale(var(--s,.268))}}
@keyframes in{from{opacity:0}to{opacity:1}}
@keyframes out{from{opacity:1}to{opacity:0}}
</style>

<style>
/* While the splash runs, the real top bar logo is hidden — the splash logo lands in its place */
.splashing .tb .logo{opacity:0}
</style>
