// Auto-detection of BTT Eddy probes (probe_eddy_current) and their binding to toolheads.
//
// Binding:
//  1. the probe's i2c_mcu matches a toolhead board MCU (e.g. Eddy on SB2209) → that toolhead;
//  2. otherwise (a separate CAN/USB node [mcu eddy] or the main board) → T0 (first toolhead).
// Runtime object names from printer.objects.list are matched case-insensitively —
// configfile.settings has section names in lower case.

const lc = s => String(s).toLowerCase()

/**
 * @returns { [toolName]: Eddy[] }
 * Eddy = { name, probeObj, tempProbeObj, chipObj, canStatsObj, mcu, mcuObj, link: 'can'|'usb'|'shared'|'main',
 *          canbusUuid, canbusInterface, serial, sensorType, frequency }
 */
export function detectEddy(settings, tools, toolheads, objectList) {
  const byLc = new Map(objectList.map(o => [lc(o), o]))
  const resolve = sec => byLc.get(lc(sec)) || null
  const sections = Object.keys(settings || {})
  const out = {}
  if (!tools.length) return out

  for (const sec of sections.filter(s => s.startsWith('probe_eddy_current '))) {
    const cfg = settings[sec] || {}
    const name = sec.slice(19)
    const mcuKey = lc(cfg.i2c_mcu || 'mcu')
    const mcuSec = mcuKey === 'mcu' ? 'mcu' : 'mcu ' + mcuKey
    const mcuCfg = settings[mcuSec] || {}

    // 1) same MCU as the toolhead board
    let tool = tools.find(t => toolheads[t] && lc(toolheads[t].mcu) === mcuKey)
    const shared = !!tool
    // 2) separate node or the main board → T0
    if (!tool) tool = tools[0]

    // Chip temperature of the probe's MCU: temperature_sensor with sensor_mcu = this MCU (temperature_mcu)
    const chipSec = mcuKey === 'mcu' ? null : sections.find(s => s.startsWith('temperature_sensor ') &&
      settings[s].sensor_type === 'temperature_mcu' && lc(settings[s].sensor_mcu || '') === mcuKey)

    const eddy = {
      name: (resolve(sec) || sec).slice(19) || name,
      probeObj: resolve(sec),
      tempProbeObj: resolve('temperature_probe ' + name),
      chipObj: chipSec ? resolve(chipSec) : null,
      canStatsObj: mcuKey === 'mcu' ? null : resolve('canbus_stats ' + mcuKey),
      mcu: mcuKey === 'mcu' ? 'mcu' : (resolve(mcuSec) || mcuSec).slice(4),
      mcuObj: resolve(mcuSec),
      link: shared ? 'shared' : mcuCfg.canbus_uuid ? 'can' : mcuKey !== 'mcu' && mcuCfg.serial ? 'usb' : 'main',
      canbusUuid: mcuCfg.canbus_uuid || null,
      canbusInterface: mcuCfg.canbus_interface || null,
      serial: mcuKey !== 'mcu' ? mcuCfg.serial || null : null,
      sensorType: cfg.sensor_type || null,
      frequency: Number(cfg.frequency) || null
    }
    if (!eddy.probeObj) continue
    ;(out[tool] = out[tool] || []).push(eddy)
  }
  return out
}

/** Eddy runtime objects to subscribe to. With a shared MCU the toolhead board is already subscribed. */
export function eddyObjects(map) {
  const names = new Set()
  for (const list of Object.values(map || {})) for (const e of list) {
    ;[e.probeObj, e.tempProbeObj, e.chipObj, e.canStatsObj, e.link !== 'main' ? e.mcuObj : null].forEach(n => n && names.add(n))
  }
  return [...names]
}
