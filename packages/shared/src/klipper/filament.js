// Filament change — shared by Vyron Web and Vyron Screen.
//
// If printer.cfg has LOAD_FILAMENT / UNLOAD_FILAMENT macros (as KlipperScreen and Mainsail expect), the buttons call them:
// the user knows their toolhead (bowden length, tip forming) better than we do. Without macros — a simple sequence:
//   load: feed FIL_LOAD mm slowly (filament reaches the nozzle and purges);
//   unload: extrude a little (soften the tip), then retract FIL_UNLOAD mm quickly.
// Everything is wrapped in SAVE_GCODE_STATE / RESTORE_GCODE_STATE, so the extruder mode (M82/M83) is restored —
// this matters during a paused print (M600), when the file resumes afterwards.
// Klipper refuses a single move longer than max_extrude_only_distance (50 mm by default), so long feeds are split.
// Klipper also rejects a cold nozzle itself; the UI warns beforehand.

/** Manual feed lengths, mm */
export const FIL_LENGTHS = [5, 10, 25, 50, 100]
/** Manual feed speeds, mm/s */
export const FIL_SPEEDS = [1, 2, 5, 10]
export const FIL_DEFAULT = { len: 10, speed: 5 }
/** Macro-less sequence: how much to feed on load / retract on unload */
export const FIL_LOAD = 50
export const FIL_UNLOAD = 60
/** Klipper's default lower limit (min_extrude_temp in [extruder]) */
export const MIN_EXTRUDE_TEMP = 170
const DEF_MAX_DIST = 50
const STATE = 'VYRON_FILAMENT'

/** User macros from printer.objects.list: { load: 'LOAD_FILAMENT' | null, unload: … } */
export function filamentMacros(objectList = []) {
  const has = n => objectList.some(o => o.toLowerCase() === 'gcode_macro ' + n.toLowerCase())
  return { load: has('LOAD_FILAMENT') ? 'LOAD_FILAMENT' : null, unload: has('UNLOAD_FILAMENT') ? 'UNLOAD_FILAMENT' : null }
}

/** Limits from the [extruder] settings (configfile.settings.extruder), with Klipper's defaults */
export function extruderLimits(cfg) {
  const c = cfg || {}
  return {
    maxDist: Number(c.max_extrude_only_distance) > 0 ? Number(c.max_extrude_only_distance) : DEF_MAX_DIST,
    minTemp: c.min_extrude_temp != null && Number.isFinite(Number(c.min_extrude_temp)) ? Number(c.min_extrude_temp) : MIN_EXTRUDE_TEMP
  }
}

/** Can we extrude now: Klipper reports can_extrude; without it — by temperature */
export function canExtrude(ex, minTemp = MIN_EXTRUDE_TEMP) {
  if (!ex) return false
  if (typeof ex.can_extrude === 'boolean') return ex.can_extrude
  return Number(ex.temperature) >= minTemp
}

const r2 = v => Math.round(v * 100) / 100

/** G1 lines feeding mm (negative — backwards) at speed mm/s, in chunks no longer than maxDist */
function moves(mm, speed, maxDist) {
  const out = [], f = Math.round(Math.max(0.1, speed) * 60), step = Math.max(1, maxDist - 0.5)
  let left = Math.abs(mm)
  const sign = mm < 0 ? -1 : 1
  while (left > 1e-6) {
    const d = Math.min(left, step)
    out.push('G1 E' + r2(sign * d) + ' F' + f)
    left -= d
  }
  return out
}

const wrap = lines => ['SAVE_GCODE_STATE NAME=' + STATE, 'M83', ...lines, 'RESTORE_GCODE_STATE NAME=' + STATE].join('\n')

/** Manual feed: mm > 0 extrudes, mm < 0 retracts */
export function extrudeScript(mm, speed, maxDist = DEF_MAX_DIST) {
  return wrap(moves(Number(mm) || 0, Number(speed) || FIL_DEFAULT.speed, maxDist))
}

/** Load: the user's macro or FIL_LOAD mm at 5 mm/s */
export function loadScript(macros, maxDist = DEF_MAX_DIST) {
  return macros && macros.load ? macros.load : wrap(moves(FIL_LOAD, 5, maxDist))
}

/** Unload: the user's macro, or soften the tip with 5 mm and retract FIL_UNLOAD mm at 25 mm/s */
export function unloadScript(macros, maxDist = DEF_MAX_DIST) {
  return macros && macros.unload ? macros.unload : wrap([...moves(5, 5, maxDist), ...moves(-FIL_UNLOAD, 25, maxDist)])
}
