<script setup>
// Full-screen 3D print preview (Three.js) behind the UI.
// The demo model and real G-code render through the same code: the same visible layer pitch,
// line style, tool colours and the "printed / current layer / future layers" split.
// Rendering is on demand: while the camera is still, nothing prints and nothing changes, the loop sleeps
// (no GPU load); under an open tab panel the scene isn't redrawn at all.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { usePrinterStore } from '../../stores/printerStore'
import { useUiStore } from '../../stores/uiStore'
import { useOrbitCamera } from '../../composables/useOrbitCamera'
import { useI18n } from '../../composables/useI18n'
import { model } from '@vyron/shared/gcode/model'
import { hexToRgb } from '@vyron/shared/theme'
import { useDesignStore } from '../../stores/designStore'
import { MOBILE_QUERY } from '../../composables/useMobile'

// ---------- colours ----------
const GRAY = [0.24, 0.26, 0.29]               // future layers
const HILITE = [1, 0.93, 0.88]                // current layer
const CORAL = 0xff6b5a, ICE = 0x7cc7ff
/** Printed part: a [bottom → top] gradient per tool; T0 is the brand red. */
const TOOL_COLORS = [
  [[0.93, 0.28, 0.23], [1, 0.68, 0.62]],      // T0 red
  [[0.30, 0.47, 1.00], [0.70, 0.80, 1.00]],   // T1 blue
  [[0.25, 0.80, 0.45], [0.70, 0.95, 0.78]],   // T2 green
  [[1.00, 0.62, 0.15], [1.00, 0.85, 0.55]],   // T3 amber
  [[0.66, 0.40, 1.00], [0.86, 0.75, 1.00]],   // T4 violet
  [[0.15, 0.80, 0.85], [0.65, 0.95, 0.95]]    // T5 teal
]
const T0_VORON = TOOL_COLORS[0]
/** Glow colour of the current layer — the theme accent (Design page) */
let glowColor = CORAL

// ---------- layer look (tuned on real models together with Z_SCALE_MAX in gcode/model.js) ----------
const LAY_DIM = 0.4        // brightness of every other visible layer — crisp bands between layers
// Future (grey) layers: softer alternation, otherwise the grey part of real models is darker
// than in the demo vase (where alternation is off).
const FUT_DIM = 0.75
const AMBIENT = 0.55       // "side light": wall brightness in full shadow
const LIGHT = (() => { const x = -0.6, y = 0.8, l = Math.hypot(x, y); return [x / l, y / l] })()
const GAIN = 1.25          // compensates for darkening from alternation and shadow
/**
 * Reference visible layer pitch = as in the demo vase (0.8 mm per turn at its framing):
 * world layer pitch / camera distance. If layers are still finer after stretching Z (≤ Z_SCALE_MAX),
 * every step-th layer is drawn (LOD). Step is recomputed from the current zoom:
 * zooming in shows all layers again.
 */
const PITCH_PER_DIST = 0.0029
const VASE_WINDOW = 90     // the spiral vase's "current layer" — the last turn (~90 segments)

// ---------- work area (wireframe when idle) ----------
// Shape and size come from Klipper (printer.bed): a rectangular bed or a round one (delta, polar).
// The bed centre is the scene origin; scene Y points up, scene Z towards the viewer (= −Y of the printer).
let B = null
// A round (delta) volume is usually taller than wide — the camera sits a bit further so the top circle doesn't hit the header
const idleView = () => ({ target: [0, B.h * 0.21, 0], dist: Math.max(B.w, B.d, B.h) * (B.round ? 3.2 : 2.8) })
const HOME_ROT = { rotX: 0.45, rotY: 0.7 }
// Delta: the camera faces straight front (between towers A and B) — the tower triangle is symmetric in frame
const homeRot = () => (B && B.round ? { rotX: 0.45, rotY: 0 } : HOME_ROT)
const PULSE_MS = 1700      // "breathing" period of the current layer
const PULSE_FPS = 30       // when only the pulse moves — render at half the rate

const printer = usePrinterStore()
const ui = useUiStore()
const cv = ref(null)
const orbit = useOrbitCamera(cv, { ...HOME_ROT, dist: 650, speed: 0.007, minX: -0.1, maxX: 1.5, wheel: true, pan: true, minDist: 20, maxDist: 2200 })

// The "Reset view" button shows only when the camera has moved (a top-level ref so the template unwraps it)
const camMoved = orbit.isCameraMoved
/** No WebGL — don't show the scene canvas or the view button */
const no3d = ref(false)
const { t } = useI18n()

let renderer, scene, cam, lines = null, colAttr = null, raf = 0
B = printer.bed
const target = new THREE.Vector3(...idleView().target)
const targetGoal = target.clone()

// Geometry state
let Lit = null        // lighting of each segment (from the wall direction), computed once per model
let Sh = null         // final segment brightness for the current step
let G = null          // indices of model segments present in the geometry (ascending)
let step = 1          // LOD: every step-th layer is drawn
let painted = 0       // the done value the geometry was painted with
let hl = 0            // start of the highlighted current layer (segment index)

// On-demand rendering
let dirty = true, lastFrame = 0, lastNow = 0
const printing = computed(() => printer.printState === 'printing' && !printer.preview)

// ---------- helpers ----------
const lowerBound = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m } return lo }

function computeLight() {
  const { P, N } = model
  Lit = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const o = i * 6, dx = P[o + 3] - P[o], dy = P[o + 4] - P[o + 1], len = Math.hypot(dx, dy) || 1
    // wall normal in the XY plane; |n·L| — unsigned lighting (CW/CCW perimeter direction is unknown)
    Lit[i] = AMBIENT + (1 - AMBIENT) * Math.abs((dy / len) * LIGHT[0] - (dx / len) * LIGHT[1])
  }
}

/** Desired step for the current camera distance. */
function stepFor(dist) {
  const lh = model.layerHeight
  if (!lh) return 1                         // vase / no regular layers
  const raw = (PITCH_PER_DIST * dist) / (lh * model.zScale)
  return Math.max(1, Math.round(raw))
}

/** Start of the "current layer" for highlighting: the last step layers (so at least one is in the geometry). */
function hlStart(done) {
  if (!done || printer.preview) return done          // a file preview has no current layer
  if (!model.layerHeight) return Math.max(0, done - VASE_WINDOW)
  const Lay = model.Lay, from = Lay[done - 1] - step + 1
  let j = done - 1
  while (j > 0 && Lay[j - 1] >= from) j--
  return j
}

function colorOf(i, done, a, q) {
  const k = Sh[i]
  if (i >= done) {
    const f = GAIN * Lit[i] * (!model.layerHeight || Math.floor(model.Lay[i] / step) & 1 ? 1 : FUT_DIM)
    a[q] = GRAY[0] * f; a[q + 1] = GRAY[1] * f; a[q + 2] = GRAY[2] * f; return
  }
  if (i >= hl) {
    const h = Math.min(1, 0.8 + 0.2 * Lit[i] * GAIN)
    a[q] = HILITE[0] * h; a[q + 1] = HILITE[1] * h; a[q + 2] = HILITE[2] * h; return
  }
  const [A, B] = TOOL_COLORS[model.T[i] % TOOL_COLORS.length], z = model.P[i * 6 + 2] / model.zmax
  a[q] = (A[0] + (B[0] - A[0]) * z) * k
  a[q + 1] = (A[1] + (B[1] - A[1]) * z) * k
  a[q + 2] = (A[2] + (B[2] - A[2]) * z) * k
}

/** Repaint model segments with indices [from, to). */
function repaint(from, to, done) {
  if (!colAttr) return
  const a = colAttr.array
  for (let g = lowerBound(G, from), end = lowerBound(G, to); g < end; g++) {
    const i = G[g], o = g * 6
    colorOf(i, done, a, o)
    a[o + 3] = a[o]; a[o + 4] = a[o + 1]; a[o + 5] = a[o + 2]
  }
  colAttr.needsUpdate = true
}

/** Model segment i → scene coordinates (Y up, Z stretched by zScale). */
function segTo(out, q, i) {
  const P = model.P, o = i * 6, zs = model.zScale
  out[q] = P[o] - B.cx; out[q + 1] = P[o + 2] * zs; out[q + 2] = -(P[o + 1] - B.cy)
  out[q + 3] = P[o + 3] - B.cx; out[q + 4] = P[o + 5] * zs; out[q + 5] = -(P[o + 4] - B.cy)
}

// ---------- building ----------
function disposeLines() {
  if (lines) { scene.remove(lines); lines.geometry.dispose(); lines.material.dispose(); lines = null }
  colAttr = null
}

/** Geometry for a given step: visible layers only; the model's top layer is always visible. */
function buildGeometry(newStep) {
  disposeLines()
  const { P, N, Lay } = model
  if (!P || !N) { G = new Int32Array(0); return }
  step = newStep
  const top = model.layers.length - 1, r = ((top % step) + step) % step
  const dim = model.layerHeight ? LAY_DIM : 1
  const keep = []
  Sh = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    if (step > 1 && Lay[i] % step !== r) continue
    keep.push(i)
    // alternation is counted among VISIBLE layers, so bands stay crisp when thinned out
    Sh[i] = GAIN * Lit[i] * (Math.floor(Lay[i] / step) & 1 ? 1 : dim)
  }
  G = Int32Array.from(keep)
  const pos = new Float32Array(G.length * 6), col = new Float32Array(G.length * 6)
  for (let g = 0; g < G.length; g++) segTo(pos, g * 6, G[g])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  colAttr = new THREE.BufferAttribute(col, 3)
  geo.setAttribute('color', colAttr)
  lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }))
  scene.add(lines)
  painted = Math.min(printer.done, N)
  hl = hlStart(painted)
  repaint(0, N, painted)
  updateGlow()
  kick()
}

/** New model: framing (without the first layer's purge line/skirt — see gcode/model), lighting, geometry. */
function build() {
  if (!scene) return            // 3D unavailable or the scene was already disposed
  if (!model.P || !model.N) {
    disposeLines()
    const v = idleView()
    targetGoal.set(...v.target)
    orbit.frame({ dist: v.dist, ...homeRot() })
    updateGlow()
    kick()
    return
  }
  computeLight()
  const b = model.bounds
  if (b) {
    const h = model.zmax * model.zScale
    targetGoal.set((b.x0 + b.x1) / 2 - B.cx, h / 2, -((b.y0 + b.y1) / 2 - B.cy))
    orbit.frame({ dist: Math.max(b.x1 - b.x0, b.y1 - b.y0, h) * 2.1 + 25, ...homeRot() })
  }
  buildGeometry(stepFor(orbit.dist))
}

/** Progress changed: repaint only the changed range (printed / current layer / future). */
function paintTo(n) {
  if (!colAttr || !model.P) return
  n = Math.min(n, model.N)
  const newHl = hlStart(n)
  if (n === painted && newHl === hl) return
  const from = Math.min(painted, n, hl, newHl), to = Math.max(painted, n)
  hl = newHl
  painted = n
  repaint(from, to, n)
  updateGlow()
  kick()
}

// LOD: after a zoom change (and a short pause) rebuild the geometry with another step.
let lodAt = 0
function checkLod(now) {
  if (!model.layerHeight || !model.N) { lodAt = 0; return }
  const want = stepFor(orbit.dist)
  if (want === step) { lodAt = 0; return }
  if (!lodAt) { lodAt = now; return }
  if (now - lodAt > 200) { lodAt = 0; buildGeometry(want) }
}

// ================= scene: bed, wireframe, glow =================
const fx = { stage: null, idle: null, glowLines: null, halo: null, bedGlow: null, idleFade: 1, idleGoal: 1, mats: [] }

/** Wireframe line material; base — opacity at full visibility (multiplied by the wireframe fade). */
function lineMat(color, base) {
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: base, depthWrite: false })
  fx.mats.push({ m, base })
  return m
}
function segments(arr, mat) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  return new THREE.LineSegments(g, mat)
}
/** Text label sprite (axis labels). */
function label(text, color, size, x, y, z) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), fs = 64
  const font = `500 ${fs}px Montserrat, system-ui, sans-serif`
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + 16
  c.width = w; c.height = fs + 16
  ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'
  ctx.fillText(text, w / 2, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.minFilter = THREE.LinearFilter
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  fx.mats.push({ m, base: 1 })
  const s = new THREE.Sprite(m)
  s.scale.set((size * w) / c.height, size, 1)
  s.position.set(x, y, z)
  return s
}
/** A soft radial spot (glow) — a shared texture for the layer halo and the bed reflection. */
function glowPlane(tex) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, color: glowColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
  m.rotation.x = -Math.PI / 2
  m.visible = false
  return m
}
function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const ctx = c.getContext('2d'), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

/** A circle of radius r at height y (in segments) */
function circle(r, y, n = 120) {
  const a = []
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2
    a.push(r * Math.cos(t0), y, -r * Math.sin(t0), r * Math.cos(t1), y, -r * Math.sin(t1))
  }
  return a
}

/** Rectangular bed: a grid every 25 mm from the origin (front-left corner), frame, volume, axes */
function stageRect() {
  const SX = B.w / 2, SZ = B.d / 2, H = B.h
  const minor = [], major = []
  for (let i = 1; i * 25 < B.w - 1; i++) { const v = -SX + i * 25; (i % 2 ? minor : major).push(v, 0, -SZ, v, 0, SZ) }
  for (let i = 1; i * 25 < B.d - 1; i++) { const v = SZ - i * 25; (i % 2 ? minor : major).push(-SX, 0, v, SX, 0, v) }
  fx.stage.add(segments(minor, lineMat(0xffffff, 0.035)))
  fx.stage.add(segments(major, lineMat(0xffffff, 0.07)))
  fx.stage.add(segments([-SX, 0, -SZ, SX, 0, -SZ, SX, 0, -SZ, SX, 0, SZ, SX, 0, SZ, -SX, 0, SZ, -SX, 0, SZ, -SX, 0, -SZ], lineMat(0xffffff, 0.16)))
  const box = []
  for (const [x, z] of [[-SX, -SZ], [SX, -SZ], [SX, SZ], [-SX, SZ]]) box.push(x, 0, z, x, H, z)
  box.push(-SX, H, -SZ, SX, H, -SZ, SX, H, -SZ, SX, H, SZ, SX, H, SZ, -SX, H, SZ, -SX, H, SZ, -SX, H, -SZ)
  fx.idle.add(segments(box, lineMat(0xffffff, 0.06)))
  axes(-SX, SZ, Math.min(70, B.w * 0.2))
}

/**
 * Round bed (delta, polar): a grid every 25 mm clipped to the circle, a brighter edge, a volume cylinder.
 * Delta gets three columns at Klipper's tower angles (A 210°, B 330°, C 90°). The origin is the centre.
 */
function stageRound() {
  const R = B.r, H = B.h
  const minor = [], major = []
  for (let k = 1; k * 25 < R - 1; k++) {
    for (const v of [k * 25, -k * 25]) {
      const half = Math.sqrt(R * R - v * v), arr = k % 2 ? minor : major
      arr.push(v, 0, -half, v, 0, half, -half, 0, v, half, 0, v)
    }
  }
  major.push(0, 0, -R, 0, 0, R, -R, 0, 0, R, 0, 0)
  fx.stage.add(segments(minor, lineMat(0xffffff, 0.035)))
  fx.stage.add(segments(major, lineMat(0xffffff, 0.07)))
  fx.stage.add(segments(circle(R, 0), lineMat(0xffffff, 0.16)))
  const vol = []
  if (B.kin !== 'polar') {   // delta (and a manually set round bed)
    // Delta: three lines rise from the round bed's edge (Klipper tower angles) and taper like a cone
    // to a smaller triangle at the top
    const at = (deg, r) => { const t = (deg * Math.PI) / 180; return [r * Math.cos(t), -r * Math.sin(t)] }
    const TOP = 0.42
    ;[210, 330, 90].forEach((deg, k, all) => {
      const [x, z] = at(deg, R), [tx, tz] = at(deg, R * TOP), [nx, nz] = at(all[(k + 1) % 3], R * TOP)
      vol.push(x, 0, z, tx, H, tz, tx, H, tz, nx, H, nz)
    })
  } else {
    // Polar: a cylinder over the bed
    vol.push(...circle(R, H, 96))
    for (const deg of [0, 90, 180, 270]) { const t = (deg * Math.PI) / 180, x = R * Math.cos(t), z = -R * Math.sin(t); vol.push(x, 0, z, x, H, z) }
  }
  fx.idle.add(segments(vol, lineMat(0xffffff, 0.06)))
  axes(0, 0, Math.min(70, R * 0.4))
}

/** Axes from the origin: X coral, Y icy; names only, no dimensions */
function axes(x0, z0, A) {
  fx.idle.add(segments([x0, 0.5, z0, x0 + A, 0.5, z0, x0 + A, 0.5, z0, x0 + A - 7, 0.5, z0 - 4, x0 + A, 0.5, z0, x0 + A - 7, 0.5, z0 + 4], lineMat(CORAL, 0.9)))
  fx.idle.add(segments([x0, 0.5, z0, x0, 0.5, z0 - A, x0, 0.5, z0 - A, x0 - 4, 0.5, z0 - A + 7, x0, 0.5, z0 - A, x0 + 4, 0.5, z0 - A + 7], lineMat(ICE, 0.9)))
  fx.idle.add(label('X', '#ff6b5a', 16, x0 + A + 12, 2, z0))
  fx.idle.add(label('Y', '#7cc7ff', 16, x0, 2, z0 - A - 12))
}

function makeStage() {
  fx.stage = new THREE.Group(); fx.idle = new THREE.Group()
  if (B.round) stageRound(); else stageRect()
  scene.add(fx.stage, fx.idle)

  // Glow: a halo at the current layer height, a warm reflection from the bed, a coral "aura" on the current layer lines
  const tex = radialTexture()
  fx.halo = glowPlane(tex); fx.bedGlow = glowPlane(tex)
  fx.bedGlow.position.y = 0.3
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
  fx.glowLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: glowColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
  fx.glowLines.visible = false
  scene.add(fx.halo, fx.bedGlow, fx.glowLines)
}

/** Update the glow geometry for the current layer/model. The pulse (opacity) is computed by the loop. */
function updateGlow() {
  if (!fx.stage) return
  const has = !!(model.P && model.N)
  fx.idleGoal = has ? 0 : 1
  const b = model.bounds
  const fw = b ? Math.max(b.x1 - b.x0, 30) : 0, fd = b ? Math.max(b.y1 - b.y0, 30) : 0
  const cx = b ? (b.x0 + b.x1) / 2 - B.cx : 0, cz = b ? -((b.y0 + b.y1) / 2 - B.cy) : 0
  // Bed reflection — under the model, brightness from the bed temperature (cold — nothing)
  const bedK = Math.min(1, Math.max(0, ((printer.bedTemp ?? 0) - 35) / 75))
  fx.bedGlow.visible = has && bedK > 0.02
  fx.bedGlow.position.set(cx, 0.3, cz)
  fx.bedGlow.scale.set(fw * 2.4, fd * 2.4, 1)
  fx.bedGlow.material.opacity = 0.28 * bedK
  // Current layer — only while printing
  const live = has && printing.value && painted > 0 && hl < painted
  fx.halo.visible = fx.glowLines.visible = live
  if (!live) return
  const zNow = model.P[(painted - 1) * 6 + 5] * model.zScale
  fx.halo.position.set(cx, zNow + 0.4, cz)
  fx.halo.scale.set(fw * 1.7, fd * 1.7, 1)
  // Current layer lines (up to a few thousand segments) — into a buffer with headroom, no reallocation per frame
  const n = painted - hl, geo = fx.glowLines.geometry
  let attr = geo.getAttribute('position')
  if (attr.array.length < n * 6) {
    attr = new THREE.BufferAttribute(new Float32Array(Math.max(n * 6, 64) * 2), 3)
    attr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', attr)
  }
  for (let i = 0; i < n; i++) segTo(attr.array, i * 6, hl + i)
  attr.needsUpdate = true
  geo.setDrawRange(0, n * 2)
  geo.computeBoundingSphere()
}

function applyFx(now, dt) {
  // Smooth fade in/out of the idle wireframe
  let anim = false
  if (Math.abs(fx.idleFade - fx.idleGoal) > 0.002) {
    fx.idleFade += (fx.idleGoal - fx.idleFade) * (1 - Math.exp(-dt * 6))
    anim = true
  } else fx.idleFade = fx.idleGoal
  // The whole wireframe (grid, frame, volume, axes) disappears when a print model is on the scene
  fx.idle.visible = fx.stage.visible = fx.idleFade > 0.01
  for (const { m, base } of fx.mats) m.opacity = base * fx.idleFade
  // "Breathing" of the current layer
  if (fx.halo.visible) {
    const p = 0.5 - 0.5 * Math.cos((now / PULSE_MS) * Math.PI * 2)
    fx.halo.material.opacity = 0.1 + 0.22 * p
    fx.glowLines.material.opacity = 0.25 + 0.5 * p
  }
  return anim
}

// ================= on-demand render loop =================
function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  renderer.setSize(innerWidth, innerHeight, false)
  cam.aspect = innerWidth / innerHeight
  // Mobile Control (MobileControl, the same MOBILE_QUERY):
  //  • phone — cards in a column at the bottom, the model lifted into the top third and pulled back a bit;
  //  • ≥640 px (unfolded Fold) — a ~380 px panel on the right, the model centred in the left part above the print card.
  const W = innerWidth, H = innerHeight
  const mobile = typeof matchMedia === 'function' && matchMedia(MOBILE_QUERY).matches
  if (mobile && W >= 640) {
    const left = W - 380 - 32                       // width of the left part
    cam.setViewOffset(W, H, Math.round((W - left) / 2 - 16), Math.round(H * 0.08), W, H)
    cam.zoom = Math.min(0.8, (left / H) / 0.62)
  } else if (mobile) {
    cam.setViewOffset(W, H, 0, Math.round(H * 0.2), W, H)
    cam.zoom = Math.min(0.78, cam.aspect / 0.62)
  } else {
    cam.clearViewOffset()
    cam.zoom = 1
  }
  cam.updateProjectionMatrix()
  kick()
}

/** Mark the frame stale and wake the loop if it sleeps. */
function kick() {
  dirty = true
  if (!raf && renderer) { lastNow = 0; raf = requestAnimationFrame(loop) }
}
orbit.wake = kick

function loop(now) {
  raf = 0
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0
  lastNow = now
  const moving = orbit.update(now)
  let tMoving = false
  if (target.distanceToSquared(targetGoal) > 0.0025) { target.lerp(targetGoal, 1 - Math.exp(-dt * 7)); tMoving = true } else target.copy(targetGoal)
  checkLod(now)
  const fading = applyFx(now, dt)
  const pulsing = fx.halo.visible
  const busy = moving || tMoving || fading || lodAt
  // A tab panel covers the scene — don't draw until it closes (watch(ui.view) wakes us).
  const covered = ui.view !== 'main'
  if (!covered && (busy || dirty || (pulsing && now - lastFrame >= 1000 / PULSE_FPS))) {
    orbit.place(cam, target)
    renderer.render(scene, cam)
    lastFrame = now
    dirty = false
  }
  // Sleep when nothing moves; the pulse during a print keeps the loop alive (30 fps).
  if (busy || (pulsing && !covered)) raf = requestAnimationFrame(loop)
}

onMounted(() => {
  // Without WebGL (a browser on a weak board without a GPU, acceleration off, an old driver) Three.js throws.
  // Then there's simply no 3D preview — the rest of the UI works as usual.
  try {
    renderer = new THREE.WebGLRenderer({ canvas: cv.value, antialias: true, alpha: true })
  } catch (e) {
    console.warn('Vyron: WebGL unavailable — 3D preview disabled', e)
    renderer = null
    no3d.value = true
    return
  }
  scene = new THREE.Scene()
  cam = new THREE.PerspectiveCamera(40, 1, 1, 6000)
  makeStage()
  addEventListener('resize', resize)
  resize()
  build()
  // Axis labels use the UI font — rebuild them once it has loaded
  document.fonts?.ready?.then(() => {
    if (!scene) return
    for (const g of [fx.stage, fx.idle, fx.halo, fx.bedGlow, fx.glowLines]) {
      scene.remove(g)
      g.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose() })
    }
    fx.mats = []
    makeStage(); updateGlow(); kick()
  })
})

/**
 * The theme changed: T0 (the printed part of a single toolhead) goes from the brand colour to the light accent,
 * the current layer glow uses the accent. The X/Y axes stay semantic (red X, light-blue Y).
 */
function onTheme(e) {
  const d = e.detail || {}, acc = hexToRgb(d.accent), br = hexToRgb(d.brand)
  if (!acc || !br) return
  const voron = d.accent === '#ff6b5a' && d.brand === '#f03a2e'
  TOOL_COLORS[0] = voron ? T0_VORON : [br.map(v => v / 255), acc.map(v => (v + (255 - v) * 0.45) / 255)]
  glowColor = voron ? CORAL : new THREE.Color(d.accent).getHex()
  for (const m of [fx.halo, fx.bedGlow, fx.glowLines]) m?.material?.color.set(glowColor)
  if (colAttr && model.P) repaint(0, model.N, painted)
  if (renderer) kick()
}
addEventListener('vyron-theme', onTheme)
onTheme({ detail: useDesignStore().d })   // the theme is already applied before the scene mounts

onBeforeUnmount(() => {
  removeEventListener('vyron-theme', onTheme)
  cancelAnimationFrame(raf)
  removeEventListener('resize', resize)
  disposeLines()
  scene?.traverse(o => {
    o.geometry?.dispose?.()
    if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.() }
  })
  renderer?.dispose()
  scene = null
})

/** New bed: rebuild the wireframe and model coordinates */
function rebuildStage() {
  B = printer.bed
  if (!scene) return
  for (const g of [fx.stage, fx.idle, fx.halo, fx.bedGlow, fx.glowLines]) {
    if (!g) continue
    scene.remove(g)
    g.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose() })
  }
  fx.mats = []
  makeStage()
  build()
}
watch(() => printer.bed, rebuildStage)
watch(() => printer.modelVersion, build)
watch(() => printer.done, paintTo)
watch(printing, () => { updateGlow(); kick() })
watch(() => Math.round((printer.bedTemp ?? 0) / 5), () => { updateGlow(); kick() })
watch(() => ui.view, kick)
</script>

<template>
  <canvas v-show="!no3d" ref="cv" class="bg3d"></canvas>
  <!-- Reset view: appears when the camera has moved; a double click/tap on the scene works too -->
  <Transition name="rv">
    <button v-if="camMoved && !no3d && ui.view === 'main'" type="button" class="rv glass" :title="t('view.reset')" :aria-label="t('view.reset')" @click="orbit.reset()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v3.7h3.7" /><circle cx="12" cy="12" r="2.2" /></svg>
    </button>
  </Transition>
</template>

<style scoped>
.bg3d{position:fixed;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
.bg3d:active{cursor:grabbing}
/* Bottom right corner: free at 1440/1024/800 — doesn't cover the model, jog, "%" or telemetry */
.rv{position:fixed;right:32px;bottom:24px;z-index:4;width:42px;height:42px;padding:0;border-radius:50%;display:grid;place-items:center;color:var(--ink);cursor:pointer;
  transition:transform var(--t-spring) var(--spring),color var(--t-fast) var(--ease-out),box-shadow var(--t-mid) var(--ease-out)}
.rv svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.rv:hover{color:var(--coral);box-shadow:var(--glass-shadow),0 0 18px -4px rgba(var(--accent-rgb),.55)}
.rv:active{transform:scale(.92)}
.rv:focus-visible{outline:2px solid var(--coral);outline-offset:3px}
.rv-enter-active{transition:transform var(--t-spring) var(--spring),opacity var(--t-fast) var(--ease-out)}
.rv-leave-active{transition:transform .2s var(--ease-out),opacity .16s var(--ease-out)}
.rv-enter-from,.rv-leave-to{opacity:0;transform:scale(.6)}
@media(max-width:900px){.rv{right:16px;bottom:16px}}
/* Narrow screens: telemetry is bottom right — the button sits in the free top corner under the header */
@media(max-width:700px){.rv{bottom:auto;top:calc(var(--hb,72px) + 12px)}}
</style>
