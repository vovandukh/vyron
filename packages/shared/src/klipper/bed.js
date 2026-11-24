// Shape and size of the work area — from Klipper itself, nothing hard-coded.
//
// Klipper reports axis limits in the toolhead status (axis_minimum / axis_maximum: [x, y, z, e]).
// The kinematics (printer.kinematics in printer.cfg) tells whether the bed is round: on delta and polar
// the X/Y limits are a square around a circle of print_radius centred at (0, 0).

const ROUND = new Set(['delta', 'rotary_delta', 'polar'])

/** Default bed until Klipper answers (and in the demo): 350 × 350 rectangle, 330 high. */
export const DEFAULT_BED = Object.freeze({ round: false, x0: 0, x1: 350, y0: 0, y1: 350, cx: 175, cy: 175, w: 350, d: 350, r: 175, h: 330, kin: '' })

/**
 * @param {string} kinematics printer.kinematics from the settings
 * @param {{axis_minimum?: number[], axis_maximum?: number[]}} toolhead toolhead status
 * @returns {typeof DEFAULT_BED | null} null — limits not known yet
 */
export function bedShape(kinematics, toolhead) {
  const lo = toolhead && toolhead.axis_minimum, hi = toolhead && toolhead.axis_maximum
  if (!Array.isArray(lo) || !Array.isArray(hi)) return null
  const [x0, y0] = lo.map(Number), [x1, y1, zMax] = hi.map(Number)
  if (![x0, x1, y0, y1].every(Number.isFinite) || x1 - x0 < 10 || y1 - y0 < 10) return null
  const kin = String(kinematics || '').toLowerCase()
  const w = x1 - x0, d = y1 - y0
  return {
    round: ROUND.has(kin),
    x0, x1, y0, y1, w, d,
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
    r: Math.min(w, d) / 2,
    // Height for the frame: Z limit from Klipper; an implausible one (0 or thousands of mm) is replaced proportionally
    h: Number.isFinite(zMax) && zMax > 20 && zMax < 3 * Math.max(w, d) ? zMax : Math.max(w, d) * 0.9,
    kin
  }
}

// ---------- manual override (when auto-detection doesn't fit) ----------
// Stored in the Moonraker database (vyron_ui/bed): { mode: 'auto' | 'rect' | 'round', w, d, dia, h } — mm.
// Empty sizes come from auto-detection. Centre and origin stay as in Klipper.

export const BED_MODES = ['auto', 'rect', 'round']
const SIZE = [20, 3000]

export function sanitizeBedOverride(raw) {
  const o = { mode: 'auto' }
  if (!raw || typeof raw !== 'object') return o
  if (BED_MODES.includes(raw.mode)) o.mode = raw.mode
  for (const k of ['w', 'd', 'dia', 'h']) {
    const v = Number(raw[k])
    if (Number.isFinite(v) && v >= SIZE[0] && v <= SIZE[1]) o[k] = Math.round(v)
  }
  return o
}

/** Bed with the manual override o applied on top of the auto-detected one. */
export function applyBedOverride(auto, o) {
  if (!o || o.mode === 'auto') return auto
  const h = o.h || auto.h
  if (o.mode === 'round') {
    const r = (o.dia || Math.min(auto.w, auto.d)) / 2
    return { ...auto, round: true, x0: auto.cx - r, x1: auto.cx + r, y0: auto.cy - r, y1: auto.cy + r, w: 2 * r, d: 2 * r, r, h }
  }
  const w = o.w || auto.w, d = o.d || auto.d
  // Rectangular: origin is the front-left corner; from a round auto bed — around the same centre
  const x0 = auto.round ? auto.cx - w / 2 : auto.x0, y0 = auto.round ? auto.cy - d / 2 : auto.y0
  return { ...auto, round: false, x0, x1: x0 + w, y0, y1: y0 + d, w, d, cx: x0 + w / 2, cy: y0 + d / 2, r: Math.min(w, d) / 2, h }
}

/** Comparison key: rebuild the scene only when the bed really changed. */
export const bedKey = b => (b ? [b.round ? 'o' : 'r', b.x0, b.x1, b.y0, b.y1, Math.round(b.h)].join(':') : '')

/**
 * Is mesh point (row, col) of a round bed inside the circle?
 * Klipper's mesh for a round bed is a square grid around the circle; points outside aren't probed
 * but filled by extending neighbours, so they must not be shown or counted.
 */
export function meshInside(r, c, rows, cols) {
  const u = cols > 1 ? (c / (cols - 1)) * 2 - 1 : 0
  const v = rows > 1 ? (r / (rows - 1)) * 2 - 1 : 0
  return u * u + v * v <= 1 + 1e-6
}
