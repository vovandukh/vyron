// Finger scrolling on the printer screen — the same for touch and "mouse".
//
// The resistive touchscreen (TFT35, XPT2046) often arrives in Chromium under X11 as a mouse: the browser
// doesn't scroll on mouse drag, and lifting the finger becomes a click on the item below. So we handle it:
//   * the finger moved less than SLOP — a tap, the click goes through;
//   * beyond that — a scroll: the nearest scrollable container follows the finger (with light inertia),
//     and the click that arrives after release is swallowed so the item under the finger doesn't open.
// Native panning is off (touch-action: none in styles.css) so real touch doesn't scroll twice.

const SLOP = 10          // px: resistive touch jitter below this is still a tap
const FRICTION = 0.92    // inertia: fraction of velocity kept per frame (~16 ms)
const MIN_V = 0.05       // px/ms: stop below this

function scrollable(el) {
  for (; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY
      if (oy === 'auto' || oy === 'scroll') return el
    }
  }
  return null
}

export function installDragScroll() {
  let box = null, id = null, y0 = 0, top0 = 0, dragging = false
  let lastY = 0, lastT = 0, v = 0, raf = 0

  const stopInertia = () => { cancelAnimationFrame(raf); raf = 0 }

  addEventListener('pointerdown', e => {
    if (e.button > 0) return
    stopInertia()
    box = scrollable(e.target)
    id = e.pointerId; y0 = lastY = e.clientY; lastT = e.timeStamp; v = 0; dragging = false
    top0 = box ? box.scrollTop : 0
  }, { capture: true, passive: true })

  addEventListener('pointermove', e => {
    if (e.pointerId !== id || !box) return
    const dy = e.clientY - y0
    if (!dragging && Math.abs(dy) < SLOP) return
    if (!dragging) {
      dragging = true
      document.documentElement.classList.add('dragging')   // cancels the "pressed" button under the finger
      y0 = e.clientY; top0 = box.scrollTop                  // no jump by SLOP
    }
    box.scrollTop = top0 - (e.clientY - y0)
    const dt = e.timeStamp - lastT
    if (dt > 0) v = 0.8 * ((lastY - e.clientY) / dt) + 0.2 * v
    lastY = e.clientY; lastT = e.timeStamp
  }, { capture: true, passive: true })

  function end(e) {
    if (e.pointerId !== id) return
    id = null
    if (!dragging) { box = null; return }
    document.documentElement.classList.remove('dragging')
    // The click right after release is part of the scroll gesture, not a tap
    const kill = ev => { ev.stopPropagation(); ev.preventDefault() }
    addEventListener('click', kill, { capture: true, once: true })
    setTimeout(() => removeEventListener('click', kill, { capture: true }), 80)
    // Inertia
    const el = box
    let t = performance.now()
    if (e.timeStamp - lastT > 80) v = 0   // the finger stopped before release
    const step = now => {
      const dt = now - t; t = now
      el.scrollTop += v * dt
      v *= Math.pow(FRICTION, dt / 16)
      raf = Math.abs(v) > MIN_V ? requestAnimationFrame(step) : 0
    }
    if (Math.abs(v) > MIN_V) raf = requestAnimationFrame(step)
    box = null; dragging = false
  }
  addEventListener('pointerup', end, { capture: true, passive: true })
  addEventListener('pointercancel', end, { capture: true, passive: true })
}
