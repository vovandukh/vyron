// UI theme: accent colour, glass, radii, scale, background.
// Applied as CSS variables on <html> (see :root in assets/main.css — same defaults there, so without JS
// the UI looks like the "Voron" theme). --red stays semantic (STOP, errors, heat) and ignores the theme.

/** Presets: accent — the light accent (focus, active states), brand — the deeper brand colour (buttons, glow, progress). */
export const PRESETS = [
  { id: 'voron', accent: '#ff6b5a', brand: '#f03a2e' },
  { id: 'ember', accent: '#ffa04d', brand: '#f2661b' },
  { id: 'amber', accent: '#ffd25a', brand: '#e8a317' },
  { id: 'lime', accent: '#b4f05c', brand: '#5fbf2a' },
  { id: 'mint', accent: '#5ff0c0', brand: '#14b88a' },
  { id: 'cyan', accent: '#5cd6ff', brand: '#1592e6' },
  { id: 'violet', accent: '#b796ff', brand: '#7c4dff' },
  { id: 'rose', accent: '#ff7cb4', brand: '#e93d82' },
  { id: 'mono', accent: '#e9ebef', brand: '#9aa1ab' }
]

export const DEFAULT_DESIGN = {
  preset: 'voron',
  accent: '#ff6b5a',
  brand: '#f03a2e',
  /** Glass transparency, %: 0 — solid panels, 50 — default, 100 — most transparent */
  glass: 50,
  /** Blur behind glass, px */
  blur: 24,
  /** Corner rounding, % of the standard radii */
  radius: 100,
  /** UI scale, % */
  scale: 100,
  /** Hexagon grid of the background, % brightness */
  grid: 100,
  /** Background colour glow, % */
  glow: 100,
  /** UI language shared by web and printer screen ('' — nobody has chosen yet) */
  lang: '',
  /** Last change time (ms) — the newer version wins across devices */
  updated: 0
}

export const LIMITS = { glass: [0, 100], blur: [0, 40], radius: [0, 160], scale: [85, 120], grid: [0, 200], glow: [0, 200] }

// ---------- colours ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
export const rgbToHex = rgb => '#' + rgb.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360
  if (!s) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const f = t => {
    t = (t + 1) % 1
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k)
const shiftL = (rgb, dl) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp(l + dl, 0, 1)]) }
/** Relative luminance (WCAG) — dark button text on light accents */
function lum(rgb) {
  const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** A deeper "brand" shade for a free accent: darker and more saturated. */
export function brandFor(accentHex) {
  const rgb = hexToRgb(accentHex)
  if (!rgb) return DEFAULT_DESIGN.brand
  const [h, s, l] = rgbToHsl(rgb)
  return rgbToHex(hslToRgb([h, Math.min(1, s * 1.05 + 0.05), clamp(l - 0.12, 0.2, 0.62)]))
}

/** Exact buttons of the "Voron" theme (historical values); others are derived from accent/brand. */
const VORON_BTN = ['#ff5a4c', '#e0321f', '#ff6a5c', '#e83a27']

/** WCAG contrast of two colours (1…21). */
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

const TEXT_LIGHT = '#ffffff', TEXT_DARK = '#121214', MIN_CONTRAST = 4.5
/** Shifts lightness step by step until txt reaches MIN_CONTRAST on it (dir −1 darker, +1 lighter). */
function fitTo(rgb, txt, dir) {
  const t = hexToRgb(txt)
  let dl = 0, c = rgb
  while (contrast(c, t) < MIN_CONTRAST && dl < 0.6) { dl += 0.005; c = shiftL(rgb, dir * dl) }
  return { rgb: c, cost: dl }
}
/**
 * Primary button text (WCAG AA 4.5:1 at both gradient ends, hover included): try white and dark,
 * take the one that needs the smaller adjustment of the button colours (tie — white). Colours [hi, lo, hi-hover, lo-hover].
 */
export function pickButtonText(raw) {
  const fits = [[TEXT_LIGHT, -1], [TEXT_DARK, 1]].map(([text, dir]) => {
    const f = raw.map(c => fitTo(c, text, dir))
    return { text, btn: f.map(x => rgbToHex(x.rgb)), cost: f[0].cost + f[1].cost }
  })
  return fits[1].cost < fits[0].cost ? fits[1] : fits[0]
}

/** Computed CSS variables for design d. */
export function designVars(d) {
  const a = hexToRgb(d.accent) || hexToRgb(DEFAULT_DESIGN.accent)
  const b = hexToRgb(d.brand) || hexToRgb(DEFAULT_DESIGN.brand)
  const exact = d.accent.toLowerCase() === '#ff6b5a' && d.brand.toLowerCase() === '#f03a2e'
  const hi = mix(a, b, 0.4), lo = shiftL(b, -0.06)
  const raw = exact ? VORON_BTN.map(hexToRgb) : [hi, lo, shiftL(hi, 0.04), shiftL(lo, 0.03)]
  const { text: onBtn, btn } = pickButtonText(raw)
  const r = clamp(d.radius, ...LIMITS.radius) / 100
  return {
    '--coral': rgbToHex(a), '--accent-rgb': a.map(Math.round).join(','),
    '--brand': rgbToHex(b), '--brand-rgb': b.map(Math.round).join(','),
    '--btn-hi': btn[0], '--btn-lo': btn[1], '--btn-hi-h': btn[2], '--btn-lo-h': btn[3], '--on-btn': onBtn,
    '--glass-t': (clamp(d.glass, ...LIMITS.glass) / 50).toFixed(3),
    '--glass-blur': `blur(${clamp(d.blur, ...LIMITS.blur)}px) saturate(180%)`,
    '--r-sm': 8 * r + 'px', '--r': 11 * r + 'px', '--r-md': 14 * r + 'px', '--r-lg': 18 * r + 'px', '--r-xl': 22 * r + 'px',
    '--grid-k': (clamp(d.grid, ...LIMITS.grid) / 100).toFixed(2),
    '--glow-k': (clamp(d.glow, ...LIMITS.glow) / 100).toFixed(2)
  }
}

/** Minimum window width from which enlarging the UI is allowed */
export const UPSCALE_MIN_WIDTH = 1280
export const effectiveScale = s => { const v = clamp(Number(s) || 100, ...LIMITS.scale); return v > 100 && innerWidth < UPSCALE_MIN_WIDTH ? 100 : v }
let lastScale = 100
// Rotation / resize: recompute whether enlarging is allowed
addEventListener('resize', () => { const z = effectiveScale(lastScale); document.documentElement.style.zoom = z !== 100 ? String(z / 100) : '' })

/** Apply a design to the document (instant — also used for live preview). */
export function applyDesign(d, { layout = true } = {}) {
  const root = document.documentElement
  const vars = designVars(d)
  // Glass, blur, radius, grid and glow also as coefficients (1 = standard) so apps with their
  // own layout (Vyron Screen) can apply them their own way
  vars['--radius-k'] = (clamp(d.radius, ...LIMITS.radius) / 100).toFixed(2)
  vars['--blur-k'] = (clamp(d.blur, ...LIMITS.blur) / 24).toFixed(2)
  if (!layout) {
    // Vyron Screen: rem sizes and a fixed screen — no px radii and no web scale
    for (const k of ['--r-sm', '--r', '--r-md', '--r-lg', '--r-xl', '--glass-blur']) delete vars[k]
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    window.dispatchEvent(new CustomEvent('vyron-theme', { detail: d }))
    return
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  // Scale is zoom on the root: every px size scales, the 3D scene stays full-screen.
  // Only on wide screens: the 1024×600 / 800×480 layouts are tight, and media queries ignore zoom.
  const z = effectiveScale(d.scale)
  root.style.zoom = z !== 100 ? String(z / 100) : ''
  lastScale = d.scale
  window.dispatchEvent(new CustomEvent('vyron-theme', { detail: d }))
}

/** Languages the shared design can carry (dictionaries in locales/) */
export const DESIGN_LANGS = ['uk', 'en']

/** Normalises a stored object into a valid design (unknown keys dropped, numbers clamped). */
export function sanitizeDesign(raw) {
  const d = { ...DEFAULT_DESIGN }
  if (!raw || typeof raw !== 'object') return d
  for (const k of Object.keys(DEFAULT_DESIGN)) {
    const v = raw[k]
    if (v == null) continue
    if (k === 'accent' || k === 'brand') { if (hexToRgb(v)) d[k] = String(v).toLowerCase() }
    else if (k === 'preset') d[k] = String(v)
    else if (k === 'lang') { if (DESIGN_LANGS.includes(v)) d[k] = v }
    else if (Number.isFinite(Number(v))) d[k] = LIMITS[k] ? clamp(Number(v), ...LIMITS[k]) : Number(v)
  }
  return d
}
