import { ref, onMounted, onBeforeUnmount } from 'vue'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

/**
 * Orbit camera with physics for a canvas.
 *  • drag — rotate; after release the model keeps spinning with inertia and slows down smoothly;
 *  • wheel / two-finger pinch — distance; right button, Shift+drag or two fingers — pan;
 *  • double click/tap — springs back to the home view.
 * Current values chase their targets with a spring (a lively response instead of a rigid binding).
 * The state is non-reactive — the render loop reads it: update(now) integrates the physics and returns true
 * while the camera moves (the rest of the time the scene needn't be redrawn).
 */
export function useOrbitCamera(elRef, opts) {
  const o = {
    speed: 0.007, minX: -0.1, maxX: 1.5, wheel: false, pan: false, minDist: 60, maxDist: 1600,
    stiffness: 160, damping: 24, friction: 4.2, ...opts
  }
  const home = { rotX: o.rotX, rotY: o.rotY, dist: o.dist }
  const goal = { rotX: o.rotX, rotY: o.rotY, dist: o.dist, panX: 0, panY: 0 }
  const cur = { ...goal }
  const vel = { rotX: 0, rotY: 0, dist: 0, panX: 0, panY: 0 }
  const KEYS = Object.keys(goal)
  const fling = { x: 0, y: 0 }          // angular velocity after release, rad/s
  let el = null, last = 0, dragging = false
  const ptr = new Map()                 // active pointers: id → {x, y}
  let mv = { x: 0, y: 0, t: 0 }         // smoothed drag velocity (for inertia)
  let tap = { t: 0, x: 0, y: 0 }, downAt = null, gesture = null

  /**
   * Reactive flag: the camera has moved from the home view (by user intent — goal, not the current position,
   * so the button hides right after a reset). Thresholds: 0.03 rad rotation, 3% distance, 2 units of pan.
   */
  const isCameraMoved = ref(false)
  const TAU = Math.PI * 2
  function checkMoved() {
    const dy = Math.abs(((goal.rotY - home.rotY) % TAU + TAU + Math.PI) % TAU - Math.PI)
    const m = dy > 0.03 || Math.abs(goal.rotX - home.rotX) > 0.03 ||
      Math.abs(goal.dist - home.dist) > home.dist * 0.03 || Math.hypot(goal.panX, goal.panY) > 2
    if (m !== isCameraMoved.value) isCameraMoved.value = m
  }

  const setRotX = v => { goal.rotX = clamp(v, o.minX, o.maxX) }
  const setDist = v => { goal.dist = clamp(v, o.minDist, o.maxDist) }
  const panBy = (dx, dy) => { const k = cur.dist * 0.0012; goal.panX -= dx * k; goal.panY += dy * k }

  // ---------- pointers ----------
  const pinchInfo = () => {
    const [a, b] = [...ptr.values()]
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const down = e => {
    el.setPointerCapture(e.pointerId)
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY })
    fling.x = fling.y = 0
    dragging = true
    if (ptr.size === 1) {
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() }
      gesture = o.pan && (e.button === 2 || e.shiftKey) ? 'pan' : 'rot'
      mv = { x: 0, y: 0, t: performance.now() }
    } else if (ptr.size === 2) { gesture = 'pinch'; downAt = null; Object.assign(mv, pinchInfo()) }
  }
  const move = e => {
    const p = ptr.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX; p.y = e.clientY
    if (gesture === 'pinch' && ptr.size === 2) {
      const q = pinchInfo()
      if (o.wheel && mv.d) setDist(goal.dist * (mv.d / q.d))
      if (o.pan) panBy(q.x - mv.x, q.y - mv.y)
      mv.d = q.d; mv.x = q.x; mv.y = q.y
      return
    }
    if (gesture === 'pan') { panBy(dx, dy); return }
    if (gesture !== 'rot') return
    goal.rotY -= dx * o.speed
    setRotX(goal.rotX + dy * o.speed)
    // velocity for inertia — exponentially smoothed, rad/s
    const now = performance.now(), dt = Math.max(1, now - mv.t) / 1000
    mv.x = mv.x * 0.6 + (-dx * o.speed / dt) * 0.4
    mv.y = mv.y * 0.6 + (dy * o.speed / dt) * 0.4
    mv.t = now
  }
  const up = e => {
    if (!ptr.delete(e.pointerId)) return
    const now = performance.now()
    if (ptr.size === 0) {
      dragging = false
      // Inertia only if the finger/mouse was still moving at release
      if (gesture === 'rot' && now - mv.t < 80) { fling.y = clamp(mv.x, -6, 6); fling.x = clamp(mv.y, -4, 4) }
      // Double tap: two short presses without movement close to each other
      if (downAt && now - downAt.t < 300 && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8) {
        if (now - tap.t < 340 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 30) { s.reset(); tap.t = 0 } else tap = { t: now, x: e.clientX, y: e.clientY }
      }
      gesture = null
    } else if (ptr.size === 1) {
      // one of two fingers lifted — keep rotating without a jump
      gesture = 'rot'; mv = { x: 0, y: 0, t: now }; downAt = null
    }
  }
  const wheel = e => { e.preventDefault(); setDist(goal.dist * Math.exp(e.deltaY * 0.0012)) }
  const ctx = e => { if (o.pan) e.preventDefault() }

  const s = {
    get dist() { return cur.dist },
    get rotX() { return cur.rotX },
    get rotY() { return cur.rotY },
    /** New home view (model framing) — the camera springs over to it. */
    frame({ dist, rotX, rotY } = {}) {
      if (dist != null) home.dist = clamp(dist, o.minDist, o.maxDist)
      if (rotX != null) home.rotX = rotX
      if (rotY != null) home.rotY = rotY
      s.reset()
    },
    /** Spring back to the home view (double tap). Rotation takes the shorter way. */
    reset() {
      fling.x = fling.y = 0
      const wrap = Math.round((cur.rotY - home.rotY) / TAU) * TAU
      cur.rotY -= wrap; goal.rotY = home.rotY
      goal.rotX = home.rotX; goal.dist = home.dist; goal.panX = 0; goal.panY = 0
      checkMoved()
      s.wake?.()
    },
    /** true — the camera has moved from the home view (for the "Reset view" button) */
    isCameraMoved,
    /** Physics step. true — the camera is still moving or being dragged. */
    update(now) {
      let dt = last ? Math.min(0.05, (now - last) / 1000) : 0
      last = now
      if (!dt) return dragging
      if (fling.x || fling.y) {
        goal.rotY += fling.y * dt
        const nx = goal.rotX + fling.x * dt
        setRotX(nx)
        if (goal.rotX !== nx) fling.x = 0
        const f = Math.exp(-o.friction * dt)
        fling.x *= f; fling.y *= f
        if (Math.abs(fling.x) < 0.01 && Math.abs(fling.y) < 0.01) fling.x = fling.y = 0
      }
      checkMoved()
      let moving = dragging || !!(fling.x || fling.y)
      while (dt > 0) {
        const h = Math.min(dt, 1 / 120)
        for (const k of KEYS) {
          const a = o.stiffness * (goal[k] - cur[k]) - o.damping * vel[k]
          vel[k] += a * h
          cur[k] += vel[k] * h
        }
        dt -= h
      }
      for (const k of KEYS) {
        const eps = k === 'dist' || k === 'panX' || k === 'panY' ? 0.02 : 0.0002
        if (Math.abs(goal[k] - cur[k]) > eps || Math.abs(vel[k]) > eps) moving = true
        else { cur[k] = goal[k]; vel[k] = 0 }
      }
      return moving
    },
    /** Places the camera on an orbit around t ({x,y,z}) with pan applied. */
    place(cam, t) {
      const cx = Math.cos(cur.rotX), sx = Math.sin(cur.rotX), cy = Math.cos(cur.rotY), sy = Math.sin(cur.rotY)
      const d = [cx * sy, sx, cx * cy]                 // from target to camera
      const r = [cy, 0, -sy]                           // screen "right"
      const u = [-sx * sy, cx, -sx * cy]               // screen "up" (r × −d)
      const tx = t.x + r[0] * cur.panX + u[0] * cur.panY
      const ty = t.y + u[1] * cur.panY
      const tz = t.z + r[2] * cur.panX + u[2] * cur.panY
      cam.position.set(tx + d[0] * cur.dist, ty + d[1] * cur.dist, tz + d[2] * cur.dist)
      cam.lookAt(tx, ty, tz)
    },
    /** "Wake up" callback for a render loop that sleeps when idle (set by the owner). */
    wake: null
  }

  const any = fn => e => { fn(e); s.wake?.() }
  // lostpointercapture — capture was taken away (system gesture): otherwise a "stuck" finger turns the next touch into a pinch
  const H = { pointerdown: any(down), pointermove: any(move), pointerup: any(up), pointercancel: any(up), lostpointercapture: any(up), wheel: any(wheel), contextmenu: ctx }
  // The window lost focus mid-gesture — forget all pointers, no inertia
  const onBlur = () => { if (!ptr.size) return; ptr.clear(); dragging = false; gesture = null; downAt = null }
  onMounted(() => {
    el = elRef.value
    for (const [k, fn] of Object.entries(H)) {
      if (k === 'wheel' && !o.wheel) continue
      el.addEventListener(k, fn, k === 'wheel' ? { passive: false } : undefined)
    }
    addEventListener('blur', onBlur)
  })
  onBeforeUnmount(() => {
    removeEventListener('blur', onBlur)
    if (!el) return
    for (const [k, fn] of Object.entries(H)) el.removeEventListener(k, fn)
  })

  return s
}
