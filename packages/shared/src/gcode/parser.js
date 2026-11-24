// G-code parser for the 3D preview.
// Returns extrusion segments P (x0,y0,z0,x1,y1,z1 per segment), F — UTF-8 byte offset of the end of each
// segment's line (matches virtual_sdcard.file_position in Moonraker) and T — the tool of each segment
// (T0…TN or ACTIVATE_EXTRUDER EXTRUDER=extruderN).

const NON_ASCII = /[^\x00-\x7f]/

export function parseGcode(text) {
  const out = [], off = [], tools = [], enc = new TextEncoder()
  let x = 0, y = 0, z = 0, e = 0, abs = true, eabs = true, byteOff = 0, tool = 0
  for (const ln of text.split('\n')) {
    // Byte length: ASCII lines (almost all of them) skip the costly TextEncoder.
    byteOff += (NON_ASCII.test(ln) ? enc.encode(ln).length : ln.length) + 1
    const c = ln.split(';')[0].trim()
    if (!c) continue
    const w = c.split(/\s+/), g = w[0].toUpperCase()
    if (g[0] === 'T' && /^T\d+$/.test(g)) { tool = Number(g.slice(1)); continue }
    if (g === 'ACTIVATE_EXTRUDER') {
      const m = c.match(/EXTRUDER=extruder(\d*)/i)
      if (m) tool = Number(m[1] || 0)
      continue
    }
    if (g === 'G90') { abs = true; continue }
    if (g === 'G91') { abs = false; continue }
    if (g === 'M82') { eabs = true; continue }
    if (g === 'M83') { eabs = false; continue }
    if (g === 'G92') {
      for (const t of w) if (t[0]?.toUpperCase() === 'E') e = parseFloat(t.slice(1)) || 0
      continue
    }
    if (g !== 'G0' && g !== 'G1') continue
    let nx = x, ny = y, nz = z, ne = e
    for (let i = 1; i < w.length; i++) {
      const v = parseFloat(w[i].slice(1))
      if (!Number.isFinite(v)) continue
      const k = w[i][0].toUpperCase()
      if (k === 'X') nx = abs ? v : x + v
      else if (k === 'Y') ny = abs ? v : y + v
      else if (k === 'Z') nz = abs ? v : z + v
      else if (k === 'E') ne = eabs ? v : e + v
    }
    if (ne > e && (nx !== x || ny !== y)) { out.push(x, y, z, nx, ny, nz); off.push(byteOff); tools.push(tool) }
    x = nx; y = ny; z = nz; e = ne
  }
  return { P: Float32Array.from(out), F: off, T: Uint8Array.from(tools), total: byteOff }
}
