<script setup>
// G-code view of the current print for a weak screen: pseudo-3D on a plain 2D canvas
// (no WebGL — on the CB1's SPI screen it is software-rendered and slow). Looks like Vyron Web: unprinted —
// thin grey lines, printed — the theme colour with alternating layer shades.
// Savings: grey lines are drawn once into an offscreen buffer; printed lines are added incrementally;
// a full redraw happens only on a new model, resize, theme or view change.
// The view can be rotated by finger (left/right — turn, up/down — tilt): while dragging a simplified
// model (DRAG_SEG segments) is drawn every frame, on release — full quality and back to the cheap mode.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { model } from '@vyron/shared/gcode/model'
import { hexToRgb } from '@vyron/shared/theme'
import { usePrinter } from '../store'

const MAX_SEG = 40000      // segment budget (the rest is merged into neighbours)
const DRAG_SEG = 6000      // fewer while rotating, so the CB1 keeps up with frames
const TILT_MIN = 0.3, TILT_MAX = 0.6   // tilt: depth compression (0.5 — looking down at 30°)
const SLOP = 10            // px: a smaller finger move is a tap (resistive touch jitters), not a rotation
const MAX_JOIN = 12        // mm: merged segments longer than this aren't joined (travels between islands)

const p = usePrinter()
const box = ref(null)
const cv = ref(null)
let base = null            // offscreen buffer with the grey lines
let S = null, L = null, I = null, D = null, n = 0   // screen coords, layer, source index and depth of each segment
/** "Floor" under the model: ellipse centre and semi-axes on screen */
let floor = null
// Depth: a wireframe without depth cues reads both "from above" and "from below" (Necker cube),
// so back lines are dimmer than front ones — three bands, only the opacity differs.
const BAND_ALPHA = [0.38, 0.7, 1]
let drawn = 0              // segments already painted as printed
// View: rotation around the vertical and tilt; starts as the classic isometric (45°, looking down at 30°)
let ang = -Math.PI / 4, tilt = 0.5
let colors = ['#ff6b5a', '#ff9a8c']

function readColors() {
  const cs = getComputedStyle(document.documentElement)
  const c = cs.getPropertyValue('--coral').trim() || '#ff6b5a'
  // Lighter shade for odd layers, mixed by hand (not every kiosk browser supports color-mix in canvas)
  const rgb = hexToRgb(c) || [255, 107, 90]
  colors = [c, 'rgb(' + rgb.map(v => Math.round(v + (255 - v) * 0.38)).join(',') + ')']
}

/**
 * The model's real radius on the bed (farthest point from the centre), once per model.
 * Half the bounding-box diagonal overestimates round parts by ~41% and made the model tiny.
 */
let radiusFor = null, radius = 1
function modelRadius(cx, cy) {
  if (radiusFor === model.P) return radius
  const P = model.P, N = model.N, st = Math.max(1, Math.floor(N / 30000))
  let r2 = 1
  for (let i = 0; i < N; i += st) {
    const o = i * 6, ax = P[o] - cx, ay = P[o + 1] - cy, bx = P[o + 3] - cx, by = P[o + 4] - cy
    r2 = Math.max(r2, ax * ax + ay * ay, bx * bx + by * by)
  }
  radiusFor = model.P
  radius = Math.sqrt(r2)
  return radius
}

/** Model projection into canvas coordinates (isometric with tilt), accounting for size and margin */
function project(w, h, maxSeg = MAX_SEG) {
  const P = model.P, N = model.N, b = model.bounds
  if (!P || !N || !b) { n = 0; floor = null; return }
  const step = Math.max(1, Math.ceil(N / maxSeg))
  // Height stretch as on the web, but at most 1.2: on a small screen layers blur anyway and a tall model shrinks
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, zs = Math.min(model.zScale || 1, 1.2)
  const ca = Math.cos(ang), sa = Math.sin(ang), TILT = tilt
  const cnt = Math.ceil(N / step)
  const raw = new Float32Array(cnt * 4)
  L = new Uint16Array(cnt); I = new Uint32Array(cnt); D = new Uint8Array(cnt)
  // Radius of the model's footprint on the bed — for depth bands and the floor ellipse
  const R = modelRadius(cx, cy)
  let k = 0
  const pr = (x, y, z, out, o) => {
    const dx = x - cx, dy = y - cy
    out[o] = dx * ca - dy * sa
    out[o + 1] = -z * zs + (dx * sa + dy * ca) * TILT
  }
  for (let i = 0; i < N; i += step) {
    const j = Math.min(N - 1, i + step - 1), a = i * 6, e = j * 6
    // Merge: from the start of the group's first segment to the end of its last — within a layer, no long jumps
    const same = model.Lay[i] === model.Lay[j] && Math.hypot(P[e + 3] - P[a], P[e + 4] - P[a + 1]) < MAX_JOIN * step
    const ex = same ? e : a
    pr(P[a], P[a + 1], P[a + 2], raw, k * 4)
    pr(P[ex + 3], P[ex + 4], P[ex + 5], raw, k * 4 + 2)
    L[k] = model.Lay[i]; I[k] = j
    // depth of the segment's midpoint: negative — further from the viewer, positive — closer
    const mx = (P[a] + P[ex + 3]) / 2 - cx, my = (P[a + 1] + P[ex + 4]) / 2 - cy
    const dep = mx * sa + my * ca
    D[k] = dep < -R / 3 ? 0 : dep > R / 3 ? 2 : 1
    k++
  }
  n = k
  // Frame bounds don't depend on the view (a circle of radius R around the centre, the largest tilt) —
  // the model doesn't jump or resize while rotating. The floor is an ellipse slightly wider than the footprint.
  const FR = R * 1.05, top = (model.zmax || 0) * zs
  const x0 = -FR, x1 = FR, y0 = -top - FR * TILT_MAX, y1 = FR * TILT_MAX
  // Margins: at the bottom — room for the glass bar with percent and name (the model may tuck under its top)
  const padX = w * 0.04, padT = h * 0.03, padB = h * 0.19
  const sc = Math.min((w - 2 * padX) / Math.max(1, x1 - x0), (h - padT - padB) / Math.max(1, y1 - y0))
  const ox = (w - (x1 - x0) * sc) / 2 - x0 * sc, oy = padT + (h - padT - padB - (y1 - y0) * sc) / 2 - y0 * sc
  S = raw
  for (let q = 0; q < n * 4; q += 2) { S[q] = S[q] * sc + ox; S[q + 1] = S[q + 1] * sc + oy }
  // Point (cx, cy, 0) projects to (0, 0), i.e. (ox, oy) on screen
  floor = { x: ox, y: oy, rx: FR * sc, ry: FR * TILT * sc }
}

/** Bed under the model: a soft light circle with a thin edge — hints that we look from above */
function drawFloor(ctx) {
  if (!floor) return
  const { x, y, rx, ry } = floor
  ctx.save()
  ctx.translate(x, y); ctx.scale(1, ry / rx)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
  g.addColorStop(0, 'rgba(255,255,255,.075)'); g.addColorStop(0.7, 'rgba(255,255,255,.035)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  ctx.beginPath(); ctx.ellipse(x, y, rx * 0.9, ry * 0.9, 0, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1; ctx.stroke()
}

function strokeRange(ctx, from, to, styleFor) {
  // Grouped by colour (layer parity) and depth: six stroke() calls, back first, then front
  for (let band = 0; band < 3; band++) {
    ctx.globalAlpha = BAND_ALPHA[band]
    for (let par = 0; par < 2; par++) {
      ctx.beginPath()
      let any = false
      for (let k = from; k < to; k++) {
        if ((L[k] & 1) !== par || D[k] !== band) continue
        const o = k * 4
        ctx.moveTo(S[o], S[o + 1]); ctx.lineTo(S[o + 2], S[o + 3]); any = true
      }
      if (any) { ctx.strokeStyle = styleFor(par); ctx.stroke() }
    }
  }
  ctx.globalAlpha = 1
}

/** How many segments (in our reduced set) are printed */
function printedCount() {
  const d = p.done
  if (!n || !d) return 0
  let lo = 0, hi = n
  while (lo < hi) { const m = (lo + hi) >> 1; if (I[m] < d) lo = m + 1; else hi = m }
  return lo
}

function full() {
  const c = cv.value, el = box.value
  if (!c || !el) return
  const dpr = window.devicePixelRatio || 1
  const w = el.clientWidth, h = el.clientHeight
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
  project(w, h)
  readColors()
  base = document.createElement('canvas')
  base.width = c.width; base.height = c.height
  const b = base.getContext('2d')
  b.scale(dpr, dpr)
  drawFloor(b)
  b.lineWidth = 1; b.lineCap = 'round'
  strokeRange(b, 0, n, par => (par ? 'rgba(160,170,190,.30)' : 'rgba(160,170,190,.20)'))
  const ctx = c.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.drawImage(base, 0, 0)
  drawn = 0
  more()
}

/** Frame while rotating: simplified model, drawn straight to the visible canvas (no buffer) */
function quick() {
  const c = cv.value, el = box.value
  if (!c || !el) return
  const dpr = window.devicePixelRatio || 1
  project(el.clientWidth, el.clientHeight, DRAG_SEG)
  const ctx = c.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawFloor(ctx)
  ctx.lineCap = 'round'
  const up = printedCount()
  ctx.lineWidth = 1
  strokeRange(ctx, up, n, par => (par ? 'rgba(160,170,190,.30)' : 'rgba(160,170,190,.20)'))
  ctx.lineWidth = 1.4
  strokeRange(ctx, 0, up, par => colors[par])
}

// ---------- finger rotation ----------
let drag = null, raf = 0, dragEnd = 0
function onDown(e) {
  if (e.button > 0 || !n) return
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, a: ang, t: tilt, moved: false }
}
function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < SLOP) return
    drag.moved = true
    try { box.value.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
  }
  ang = drag.a + dx * 0.012
  tilt = Math.min(TILT_MAX, Math.max(TILT_MIN, drag.t + dy * 0.003))
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; quick() })
}
function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return
  const moved = drag.moved
  drag = null
  if (!moved) return
  cancelAnimationFrame(raf); raf = 0
  dragEnd = performance.now()
  full()                     // full quality, then incremental drawing again
}
/** A tap right after rotating must not open Tune */
function onClick(e) { if (performance.now() - dragEnd < 400) { e.stopPropagation(); e.preventDefault() } }

/** Paint the printed part from where we stopped (or all over again if progress went back) */
function more() {
  const c = cv.value
  if (!c || !n || drag) return
  const upto = printedCount()
  if (upto < drawn) { full(); return }
  if (upto === drawn) return
  const ctx = c.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.lineWidth = 1.4; ctx.lineCap = 'round'
  strokeRange(ctx, drawn, upto, par => colors[par])
  drawn = upto
}

let ro = null
onMounted(() => {
  full()
  ro = new ResizeObserver(() => full())
  ro.observe(box.value)
})
onBeforeUnmount(() => ro && ro.disconnect())
watch(() => p.modelVer, full)
watch(() => p.design, () => full())
watch(() => p.done, more)
</script>

<template>
  <div ref="box" class="gv" aria-hidden="true" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @click.capture="onClick"><canvas ref="cv"></canvas></div>
</template>

<style scoped>
.gv{position:absolute;inset:0;overflow:hidden;touch-action:none}
canvas{display:block;width:100%;height:100%}
</style>
