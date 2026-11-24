// Model of the current print. The large typed arrays deliberately live outside Vue reactivity;
// the store only keeps a version counter and the progress index.

export const BED = [350, 350]

// Visual layer pitch: thin layers (0.2 mm) blur together in the preview, so Z is stretched until the
// visible pitch is ~LAYER_PITCH mm, but never more than Z_SCALE_MAX times — the model stays recognisable.
// Layers ≥ LAYER_PITCH keep scale 1. Tuned on real prints (0.2 mm, 15–100 layers): ×1.6 reads as
// separate layers, ×2+ visibly stretches the model. Works together with the alternating shading in PrintPreview3D.
const LAYER_PITCH = 0.5
const Z_SCALE_MAX = 1.6

export const model = {
  P: null,       // Float32Array of segments
  F: null,       // byte offset of each segment's end
  N: 0,
  Lay: null,     // layer index of each segment
  T: null,       // tool (T0…TN) of each segment
  layers: [],    // sorted unique layer heights (×100)
  zmax: 1,
  zScale: 1,     // visual Z scale for the 3D preview
  layerHeight: 0,
  bounds: null   // {x0,x1,y0,y1}
}

/** Median layer height (mm) from the sorted heights ×100. */
function medianLayerHeight(layers) {
  const d = []
  for (let i = 1; i < layers.length; i++) {
    const h = (layers[i] - layers[i - 1]) / 100
    if (h >= 0.02 && h <= 2) d.push(h)
  }
  if (!d.length) return 0
  d.sort((a, b) => a - b)
  return d[d.length >> 1]
}

/**
 * XY bounds for framing the camera. The first layer is ignored (when there are ≥ 3): it holds the purge line
 * at the bed edge, skirt and brim, which would otherwise shift the centre and shrink the part in frame.
 */
function frameBounds(P, N, Lay, nLayers) {
  const skipFirst = nLayers >= 3
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9
  for (let i = 0; i < N; i++) {
    if (skipFirst && Lay[i] === 0) continue
    const o = i * 6
    x0 = Math.min(x0, P[o], P[o + 3]); x1 = Math.max(x1, P[o], P[o + 3])
    y0 = Math.min(y0, P[o + 1], P[o + 4]); y1 = Math.max(y1, P[o + 1], P[o + 4])
  }
  return x1 >= x0 ? { x0, x1, y0, y1 } : null
}

/** P, F — segments and byte offsets; T — tool of each segment (optional, defaults to T0). */
export function loadModel(P, F, T) {
  const N = F.length
  let zmax = 0.001
  const zs = new Set()
  for (let i = 0; i < N; i++) {
    const o = i * 6
    zmax = Math.max(zmax, P[o + 2], P[o + 5])
    zs.add(Math.round(P[o + 5] * 100))
  }
  const layers = [...zs].sort((a, b) => a - b)
  const map = new Map(layers.map((z, i) => [z, i]))
  const Lay = new Uint16Array(N)
  for (let i = 0; i < N; i++) Lay[i] = map.get(Math.round(P[i * 6 + 5] * 100))
  const layerHeight = medianLayerHeight(layers)
  const zScale = layerHeight ? Math.min(Z_SCALE_MAX, Math.max(1, LAYER_PITCH / layerHeight)) : 1
  const bounds = N ? frameBounds(P, N, Lay, layers.length) || frameBounds(P, N, Lay, 0) : null
  Object.assign(model, { P, F, N, Lay, T: T && T.length === N ? T : new Uint8Array(N), layers, zmax, zScale, layerHeight, bounds })
}

/** Segments printed before byte offset pos. */
export function indexForPos(pos) {
  const F = model.F
  if (!F) return 0
  let lo = 0, hi = model.N
  while (lo < hi) { const m = (lo + hi) >> 1; if (F[m] <= pos) lo = m + 1; else hi = m }
  return lo
}

export function segEnd(i) {
  const o = i * 6, P = model.P
  return [P[o + 3], P[o + 4], P[o + 5]]
}

/** "layer / total" computed from the model when Klipper doesn't report the layer. */
export function layerLabel(done) {
  if (!model.P || !model.N || !done) return '–'
  const z = Math.round(model.P[(done - 1) * 6 + 5] * 100), lz = model.layers
  let lo = 0, hi = lz.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (lz[m] < z) lo = m + 1; else hi = m }
  return lo + 1 + ' / ' + lz.length
}
