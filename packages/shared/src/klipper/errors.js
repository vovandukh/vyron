// Klipper error recognition: raw text ("!! Move out of range…", state_message after shutdown) →
// a human description for the UI. Returns { id, cat, params, head, body }:
//   id     — translation key: kerr.<id>.t (title) and kerr.<id>.h (what to check, lines split by \n);
//   cat    — category for icon and colour: mcu | heat | config | motion | probe | driver | estop | macro | generic;
//   params — title placeholders ({mcu}, {heater}, {axis}…);
//   head   — first line of the original message (without "!!"), body — the rest (Klipper's own explanation).

/** Patterns from the most specific to the most general. m is the exec result the params come from. */
const RULES = [
  { id: 'estop', cat: 'estop', re: /M112|emergency stop/i },
  { id: 'mcuLost', cat: 'mcu', re: /Lost communication with MCU '([^']+)'/i, p: m => ({ mcu: m[1] }) },
  { id: 'mcuConnect', cat: 'mcu', re: /mcu '([^']+)': Unable to (?:connect|open)|Unable to open (?:serial port|CAN)/i, p: m => ({ mcu: m[1] || 'mcu' }) },
  { id: 'mcuProtocol', cat: 'mcu', re: /protocol error|MCU Protocol/i, p: (m, s) => ({ mcu: mcuOf(s) }) },
  { id: 'timer', cat: 'mcu', re: /Timer too close|Rescheduled timer in the past|Missed scheduling of next|Stepper too far in past|Move queue overflow/i, p: (m, s) => ({ mcu: mcuOf(s) }) },
  { id: 'heaterRate', cat: 'heat', re: /Heater (\S+) not heating at expected rate/i, p: m => ({ heater: m[1] }) },
  { id: 'adc', cat: 'heat', re: /ADC out of range|thermocouple|MAX318\d\d|MAX6675/i },
  // Driver name is matched separately: in "Unable to read tmc uart 'stepper_x'" the unquoted alternative would win first
  { id: 'tmc', cat: 'driver', re: /TMC '[^']+'|tmc (?:uart|spi) '[^']+'|Unable to (?:read|write) tmc/i, p: (m, s) => ({ drv: (/tmc(?: uart| spi)? '([^']+)'/i.exec(s) || [])[1] || 'TMC' }) },
  { id: 'notHomed', cat: 'motion', re: /Must home|home axis first/i },
  { id: 'range', cat: 'motion', re: /Move out of range/i },
  { id: 'cold', cat: 'heat', re: /Extrude below minimum temp/i },
  { id: 'extLong', cat: 'motion', re: /Extrude only move too long/i },
  // Probe before endstops: "No trigger on probe after full movement" would otherwise hit the endstop rule
  { id: 'probePre', cat: 'probe', re: /Probe triggered prior to movement/i },
  { id: 'probeNone', cat: 'probe', re: /No trigger on probe after full movement/i },
  // "still triggered" — the endstop never releases (the opposite of "no trigger"), hence its own description
  { id: 'endstopStuck', cat: 'motion', re: /Endstop (\S+) still triggered/i, p: m => ({ axis: m[1] }) },
  { id: 'endstop', cat: 'motion', re: /No trigger on (\S+) after full movement/i, p: m => ({ axis: m[1] }) },
  { id: 'probeTol', cat: 'probe', re: /Probe samples exceed|samples_tolerance/i },
  { id: 'leveling', cat: 'probe', re: /Too many retries|Retries: \d+\/\d+.*(?:exceed|range)/i },
  { id: 'config', cat: 'config', re: /Option '[^']+' in section|Section '[^']+' is not a valid|Unknown pin chip name|Unable to parse option|pin \S+ used multiple times|Config error|Unable to open config file|is not a valid config section|must be specified|Error loading template/i },
  { id: 'macro', cat: 'macro', re: /Error evaluating '([^':]+)/i, p: m => ({ macro: m[1].replace(/^gcode_macro /, '') }) },
  { id: 'unknownCmd', cat: 'macro', re: /Unknown command:\s*"?([^"\s]+)/i, p: m => ({ cmd: m[1] }) },
  { id: 'shutdownNow', cat: 'estop', re: /Printer is shutdown|Klipper reports: SHUTDOWN/i }
]

/** MCU name from "MCU 'EBBCan' shutdown: …" (main board by default). */
function mcuOf(s) {
  const m = /mcu '([^']+)'/i.exec(s)
  return m ? m[1] : 'mcu'
}

/** Strips "!! " from every line and extra blank lines. */
export function cleanMessage(raw) {
  return String(raw || '').split('\n').map(l => l.replace(/^!!\s?/, '').trimEnd()).join('\n').trim()
}

export function classify(raw) {
  const text = cleanMessage(raw)
  const nl = text.indexOf('\n')
  const head = (nl < 0 ? text : text.slice(0, nl)).trim()
  const body = nl < 0 ? '' : text.slice(nl + 1).trim()
  for (const r of RULES) {
    const m = r.re.exec(text)
    if (m) return { id: r.id, cat: r.cat, params: r.p ? r.p(m, text) : {}, head, body }
  }
  return { id: 'generic', cat: 'generic', params: {}, head, body }
}

/** G-code error in the response stream: a line starting with "!!". */
export const isGcodeError = line => /^!!/.test(String(line || ''))
