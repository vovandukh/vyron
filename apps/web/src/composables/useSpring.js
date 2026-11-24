import { ref, watch, onBeforeUnmount, getCurrentInstance } from 'vue'

/** Default spring — the same as the --spring CSS variable. */
export const SPRING = { stiffness: 400, damping: 30, mass: 0.8 }

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A number that chases its target with spring physics (semi-implicit Euler, step ≤ 1/120 s).
 * Returns a ref; the target is set with set(v) or follows source (a ref or getter) automatically.
 *
 *   const z = useSpring(() => printer.position?.[2] ?? 0)
 *
 * With prefers-reduced-motion the value jumps straight to the target.
 */
export function useSpring(source, opts = {}) {
  const { stiffness, damping, mass } = { ...SPRING, ...opts }
  const precision = opts.precision ?? 0.001
  const value = ref(0), target = { v: 0 }
  let vel = 0, raf = 0, last = 0

  const step = now => {
    let dt = Math.min(0.064, (now - last) / 1000)
    last = now
    while (dt > 0) {
      const h = Math.min(dt, 1 / 120)
      const a = (-stiffness * (value.value - target.v) - damping * vel) / mass
      vel += a * h
      value.value += vel * h
      dt -= h
    }
    if (Math.abs(vel) < precision && Math.abs(value.value - target.v) < precision) {
      value.value = target.v; vel = 0; raf = 0
      return
    }
    raf = requestAnimationFrame(step)
  }

  /** New target; jump=true — no animation. */
  function set(v, jump = false) {
    v = Number(v)
    if (!Number.isFinite(v)) return
    target.v = v
    if (jump || reduced() || document.hidden) {
      cancelAnimationFrame(raf); raf = 0; vel = 0; value.value = v
      return
    }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(step) }
  }

  if (source != null) watch(source, v => set(v), { immediate: false })
  if (source != null) {
    const init = typeof source === 'function' ? source() : source.value
    set(init, true)
  }

  if (getCurrentInstance()) onBeforeUnmount(() => cancelAnimationFrame(raf))
  value.set = set
  return value
}
