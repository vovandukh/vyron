// Host network from machine.system_info: interfaces and their IPv4. Wi‑Fi — wl* interfaces.

/** [{ name, ip, wifi }] without loopback or address-less interfaces (Wi‑Fi is always shown) */
export function interfaces(info) {
  const n = (info && info.network) || {}
  return Object.keys(n).filter(k => k !== 'lo').map(k => ({
    name: k,
    wifi: /^wl/.test(k),
    ip: ((n[k].ip_addresses || []).find(a => a.family === 'ipv4') || {}).address || ''
  })).filter(i => i.ip || i.wifi)
}

/** Short text for the "Wi‑Fi" row in settings: IP of the wireless interface or "not connected" */
export function wlanSummary(info) {
  const w = interfaces(info).find(i => i.wifi)
  return w ? w.ip || '—' : ''
}

/** A WIFI_SCAN macro response line: "SSID:SIGNAL:SECURITY" (colons in the SSID escaped as \:) */
export function parseScanLine(line) {
  const m = String(line).replace(/^\/\/\s*/, '').trim().match(/^((?:\\.|[^:\\])*):(\d{1,3}):(.*)$/)
  return m ? { ssid: m[1].replace(/\\(.)/g, '$1'), sig: +m[2], sec: m[3].trim() } : null
}

/** Characters that can't be passed to the WIFI_CONNECT macro (they break G-code quoting) */
export const BAD_CHARS = /["'\\{}]/
