/** Duration in seconds → "2 h 5 min" / "5 min" (via the given t). */
export function fmtDuration(sec, t) {
  const x = Math.max(0, Math.round(sec || 0))
  const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60)
  return h ? t('fmt.hm', { h, m }) : t('fmt.m', { m })
}

/** The same, compact for tight spots (the printer screen status pill): "2h 5m" / "5m". */
export function fmtDurationShort(sec, t) {
  const x = Math.max(0, Math.round(sec || 0))
  const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60)
  return h ? t('fmt.hmS', { h, m }) : t('fmt.mS', { m })
}

export const fmtTemp = v => (v == null ? '–' : Math.round(v) + '°')
export const fmtPct = v => (v == null ? '–' : Math.round(v * 100) + '%')

/**
 * Heat scale for highlights: ≤35° icy (--ice), ≥180° coral (--coral), warm amber in between
 * (mixing icy straight into coral gives a muddy pink).
 * Returns 'r,g,b' for rgba(var(--heat), α).
 */
const HEAT_STOPS = [[0, [124, 199, 255]], [0.55, [255, 184, 108]], [1, [255, 107, 90]]]
export function heatRgb(temp, cold = 35, hot = 180) {
  const k = Math.min(1, Math.max(0, ((temp ?? cold) - cold) / (hot - cold)))
  let i = 0
  while (i < HEAT_STOPS.length - 2 && k > HEAT_STOPS[i + 1][0]) i++
  const [k0, a] = HEAT_STOPS[i], [k1, b] = HEAT_STOPS[i + 1]
  const f = (k - k0) / (k1 - k0)
  return a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(',')
}
