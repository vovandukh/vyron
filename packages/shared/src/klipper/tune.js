// Live tuning during a print — shared by Vyron Web and Vyron Screen.
//   Z offset (babystep): SET_GCODE_OFFSET Z_ADJUST=… MOVE=1 — the head moves at once, lasts until the print ends
//   Speed: M220 S<%>   Flow: M221 S<%>   Part fan: M106 S<0…255>
// Values come from Klipper's gcode_move (homing_origin, speed_factor, extrude_factor) and fan (speed).

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/** Klipper objects to subscribe to: { object: [fields] } */
export const TUNE_OBJECTS = { gcode_move: ['homing_origin', 'speed_factor', 'extrude_factor'], fan: ['speed'] }

/** Button steps: Z in mm, the rest in percent */
export const TUNE_STEPS = { z: [0.01, 0.05], speed: 5, flow: 1, fan: 10 }
export const TUNE_LIMITS = { speed: [10, 300], flow: [50, 150], fan: [0, 100], z: [-2, 2] }

/** Current values from Klipper objects (st — merged printer.objects state) */
export function tuneValues(st) {
  const g = (st && st.gcode_move) || {}, f = (st && st.fan) || {}
  const ho = g.homing_origin || []
  return {
    z: Number(ho[2]) || 0,
    speed: Math.round((g.speed_factor == null ? 1 : g.speed_factor) * 100),
    flow: Math.round((g.extrude_factor == null ? 1 : g.extrude_factor) * 100),
    fan: f.speed == null ? null : Math.round(f.speed * 100)
  }
}

/** "+0.025" — always signed, three decimals (the 0.005 step is visible) */
export const fmtZ = z => (z > 0 ? '+' : z < 0 ? '−' : '') + Math.abs(z).toFixed(3)

/**
 * G-code for a change. kind: 'z' (v — increment, mm), 'zreset', 'speed' | 'flow' | 'fan' (v — new value, %).
 * Values are clamped to safe limits.
 */
export function tuneScript(kind, v) {
  switch (kind) {
    case 'z': return `SET_GCODE_OFFSET Z_ADJUST=${clamp(Number(v), -0.5, 0.5).toFixed(3)} MOVE=1`
    case 'zreset': return 'SET_GCODE_OFFSET Z=0 MOVE=1'
    case 'speed': return `M220 S${Math.round(clamp(v, ...TUNE_LIMITS.speed))}`
    case 'flow': return `M221 S${Math.round(clamp(v, ...TUNE_LIMITS.flow))}`
    case 'fan': return `M106 S${Math.round(clamp(v, ...TUNE_LIMITS.fan) * 2.55)}`
    default: return null
  }
}

/** Demo only: how the state changes after a command (no printer) */
export function tunePatch(st, kind, v) {
  const t = tuneValues(st), g = (st && st.gcode_move) || {}
  const ho = (g.homing_origin || [0, 0, 0, 0]).slice()
  switch (kind) {
    case 'z': ho[2] = clamp(t.z + Number(v), ...TUNE_LIMITS.z); return { gcode_move: { homing_origin: ho } }
    case 'zreset': ho[2] = 0; return { gcode_move: { homing_origin: ho } }
    case 'speed': return { gcode_move: { speed_factor: clamp(v, ...TUNE_LIMITS.speed) / 100 } }
    case 'flow': return { gcode_move: { extrude_factor: clamp(v, ...TUNE_LIMITS.flow) / 100 } }
    case 'fan': return { fan: { speed: clamp(v, ...TUNE_LIMITS.fan) / 100 } }
    default: return {}
  }
}
