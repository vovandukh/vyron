// Heating — shared by Vyron Web and Vyron Screen: material presets and G-code.
// SET_HEATER_TEMPERATURE works for any Klipper heater (extruder, extruder1, heater_bed, heater_generic …),
// TURN_OFF_HEATERS turns them all off. Klipper itself rejects a target above max_temp from printer.cfg.

/** Material presets: nozzle / bed, °C — typical values for most filaments */
export const HEAT_PRESETS = [
  { id: 'pla', name: 'PLA', nozzle: 210, bed: 60 },
  { id: 'petg', name: 'PETG', nozzle: 240, bed: 80 },
  { id: 'abs', name: 'ABS', nozzle: 250, bed: 100 },
  { id: 'asa', name: 'ASA', nozzle: 260, bed: 100 }
]

/** UI upper limits (against typos; the real limit is max_temp in printer.cfg) */
export const HEAT_MAX = { nozzle: 320, bed: 130 }
export const HEAT_STEP = 5

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
/** Heater type by Klipper object name */
export const heaterKind = name => (/^extruder\d*$/.test(name) ? 'nozzle' : name === 'heater_bed' ? 'bed' : 'other')

export function heaterScript(name, target) {
  const max = HEAT_MAX[heaterKind(name)] || 150
  return `SET_HEATER_TEMPERATURE HEATER=${name} TARGET=${Math.round(clamp(Number(target) || 0, 0, max))}`
}
export const HEAT_OFF = 'TURN_OFF_HEATERS'

/** Is the preset currently "on" (targets match) */
export const presetActive = (p, nozzleTarget, bedTarget) => p.nozzle === Math.round(nozzleTarget || 0) && p.bed === Math.round(bedTarget || 0)
