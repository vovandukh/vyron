// Klipper objects: every extruder (any count) and toolhead board sensors.

/** Tool number from the extruder name: extruder → 0, extruder3 → 3. */
export const toolNum = name => (name === 'extruder' ? 0 : Number(String(name).slice(8)) || 0)

export function discoverTools(objectList) {
  const tools = objectList
    .filter(n => /^extruder\d*$/.test(n))
    .sort((a, b) => toolNum(a) - toolNum(b))

  // Fallback for configs without pin binding: a sensor named like ebb_t3,
  // indexed by the toolhead number.
  const nums = new Set(tools.map(toolNum))
  const boards = {}
  objectList.filter(n => /^temperature_sensor /.test(n)).forEach(n => {
    const s = n.slice(19).toLowerCase()
    if (!/ebb|can|board|head|tool/.test(s)) return
    const m = s.match(/(\d+)\D*$/)
    if (!m) return
    const i = Number(m[1])
    if (nums.has(i) && !boards[i]) boards[i] = n
  })
  return { tools, boards }
}

const BASE_OBJECTS = ['webhooks', 'print_stats', 'virtual_sdcard', 'heater_bed', 'toolhead', 'gcode_move', 'fan',
  'quad_gantry_level', 'z_tilt', 'bed_mesh']

/**
 * Chamber temperature sensor if configured: canonical names first,
 * then any temperature_sensor / heater_generic / temperature_fan with "chamber" in its name.
 */
export function findChamber(objectList) {
  for (const n of ['temperature_sensor chamber', 'heater_generic chamber', 'temperature_fan chamber']) if (objectList.includes(n)) return n
  return objectList.find(n => /^(temperature_sensor|heater_generic|temperature_fan) .*chamber/i.test(n)) || null
}

/** All MCUs: the main board 'mcu' and extra ones 'mcu EBBCan', 'mcu host'… (main board first). */
export const findMcus = objectList => objectList.filter(n => /^mcu( |$)/.test(n)).sort((a, b) => (a === 'mcu' ? -1 : b === 'mcu' ? 1 : a.localeCompare(b)))

/** MCU name for sensor_mcu: 'mcu' → 'mcu', 'mcu EBBCan' → 'EBBCan'. */
export const mcuName = obj => (obj === 'mcu' ? 'mcu' : obj.slice(4))

/**
 * Hardware temperature sensors: [{ obj, name, type, mcu }], where type is
 *   'mcu'   the MCU chip (sensor_type: temperature_mcu, board — sensor_mcu);
 *   'host'  the host CPU (sensor_type: temperature_host — also inside temperature_fan,
 *           and the 'temperature_host <name>' object Klipper registers itself);
 *   'board' a thermistor on the board itself (sensor_pin "EBBCan: PA2" + a name like EBB_NTC / board).
 * Without printer.cfg settings — by name (mcu_temp, raspberry_pi, cb1, host…).
 */
const SENSOR_OBJ = /^(temperature_sensor|temperature_fan|heater_generic) /
export function findHwSensors(objectList, settings = null) {
  const out = []
  for (const obj of objectList) {
    if (/^temperature_host /.test(obj)) { out.push({ obj, name: obj.slice(17), type: 'host', mcu: null }); continue }
    if (!SENSOR_OBJ.test(obj)) continue
    const name = obj.slice(obj.indexOf(' ') + 1)
    const cfg = settings ? settings[obj.toLowerCase()] : null
    if (cfg && cfg.sensor_type) {
      if (cfg.sensor_type === 'temperature_mcu') out.push({ obj, name, type: 'mcu', mcu: cfg.sensor_mcu || 'mcu' })
      else if (cfg.sensor_type === 'temperature_host') out.push({ obj, name, type: 'host', mcu: null })
      else {
        // Thermistor on a toolhead board: a pin of another MCU and a board-like name (not chamber or heater)
        const m = /^\s*([^:\s]+)\s*:/.exec(String(cfg.sensor_pin || ''))
        if (m && /^temperature_sensor /.test(obj) && /ntc|board|ebb|sb2209|sb2240|nhk|nitehawk|toolhead|chip/i.test(name)) out.push({ obj, name, type: 'board', mcu: m[1] })
      }
      continue
    }
    if (!/^temperature_sensor /.test(obj)) continue
    if (/raspberry|rpi|\bpi\b|cb1|cb2|host|orange|manta_host/i.test(name)) out.push({ obj, name, type: 'host', mcu: null })
    else if (/^mcu(_temp)?$|_mcu$|mcu_temp/i.test(name)) out.push({ obj, name, type: 'mcu', mcu: name.replace(/_?mcu(_temp)?$/i, '') || 'mcu' })
  }
  return out
}

/**
 * How each MCU is connected (from the [mcu …] sections of printer.cfg):
 * { 'mcu EBBCan': { kind: 'can', iface: 'can0', id: 'f3e9a0b47c21' }, mcu: { kind: 'usb', id: 'usb-Klipper_stm32…-if00' }, … }
 */
export function mcuConnections(settings, mcus) {
  const out = {}
  for (const obj of mcus) {
    const c = settings[obj.toLowerCase()]
    if (!c) continue
    if (c.canbus_uuid) out[obj] = { kind: 'can', iface: c.canbus_interface || 'can0', id: c.canbus_uuid }
    else if (c.serial) {
      const s = String(c.serial)
      if (/klipper_host_mcu/.test(s)) out[obj] = { kind: 'linux', id: s }
      else if (/\/by-id\/usb-|ttyACM|ttyUSB/.test(s)) out[obj] = { kind: 'usb', id: s.split('/').pop() }
      else out[obj] = { kind: 'uart', id: s, baud: c.baud || null }
    }
  }
  return out
}

/** Gantry levelling object: QGL (Voron 2.x) or Z-Tilt (Trident etc.). */
export function findLeveling(objectList) {
  if (objectList.includes('quad_gantry_level')) return { obj: 'quad_gantry_level', kind: 'qgl' }
  if (objectList.includes('z_tilt')) return { obj: 'z_tilt', kind: 'ztilt' }
  return null
}

/** printer.objects.subscribe payload limited to objects that actually exist. */
export function subscriptionObjects(objectList, tools, boards, extra = []) {
  const names = [...BASE_OBJECTS, findChamber(objectList), ...tools, ...Object.values(boards), ...extra].filter(Boolean)
  const objects = {}
  names.forEach(n => { if (objectList.includes(n)) objects[n] = null })
  return objects
}

export const STATE_KEYS = {
  printing: 'state.printing', paused: 'state.paused', standby: 'state.standby',
  complete: 'state.complete', cancelled: 'state.cancelled', error: 'state.error'
}
