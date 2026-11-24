// Vyron logo — a solid V with a triangular "D" inside: round bowl on the right and a recessed
// triangular notch. V for Vyron, D for the author's initial.
// Exact geometry: the edges of D and the notch run parallel to the arms of V (slope 25/46), the bowl of D
// is an arc touching both edges. 64×48 grid, centred in the VIEWBOX square. One geometry for header, screen and favicon.

export const VIEWBOX = '-3 -11 70 70'

/** V — the solid band */
export const BAND = 'M1 1H10L32 41.5 54 1H63L38 47H26Z'
/** "D" without the notch */
export const D = 'M16 1H40.4A4.5 4.5 0 0 1 44.37 7.67L32 30.4Z'
/** Notch in "D" — filled with a darker shade, as if recessed */
export const HOLE = 'M27 6.5H37L32 15.7Z'

let seq = 0

/**
 * Logo as an SVG string. color — any CSS colour, including 'var(--brand)' (for inline SVG).
 * fx — subtle shadows and depth (header and screen); without fx — the flat favicon version.
 */
export function logoSvg(color = '#f03a2e', { fx = false } = {}) {
  const f = `style="fill:${color}"`
  if (!fx) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}">` +
      `<path d="${BAND}" ${f}/><path d="${D}" ${f}/><path d="${HOLE}" fill="#000" fill-opacity=".38"/></svg>`
  }
  const u = 'vy' + (++seq)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" style="overflow:visible;display:block;width:100%;height:100%">` +
    '<defs>' +
    // Soft shadow slightly downwards — the mark lifts off the background a little
    `<filter id="${u}s" x="-25%" y="-25%" width="150%" height="160%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#000" flood-opacity=".45"/></filter>` +
    // Depth of V: darker at the bottom
    `<linearGradient id="${u}b" x1="0" y1="1" x2="0" y2="47" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>` +
    // Highlight in the centre of D
    `<radialGradient id="${u}h" cx="32" cy="12" r="18" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    // Recessed notch: darker at the top (inner shadow), lighter towards the bottom
    `<linearGradient id="${u}v" x1="0" y1="6.5" x2="0" y2="15.7" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>` +
    '</defs>' +
    `<g filter="url(#${u}s)"><path d="${BAND}" ${f}/><path d="${BAND}" fill="url(#${u}b)"/></g>` +
    `<g filter="url(#${u}s)"><path d="${D}" ${f}/><path d="${D}" fill="url(#${u}h)"/></g>` +
    `<path d="${HOLE}" fill="url(#${u}v)"/>` +
    '</svg>'
}

export const logoDataUri = color => 'data:image/svg+xml,' + encodeURIComponent(logoSvg(color))
