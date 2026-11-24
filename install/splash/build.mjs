// Boot animation frames for a TFT 480×320 in framebuffer format (RGB565 little-endian, gzip).
// Source: the prototype apps/screen/demo/boot.html (?t=ms freezes a frame). The result is committed to assets/:
// nothing is rendered on the printer.
//   node install/splash/build.mjs [path to chrome]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(HERE, 'assets')
const CHROME = process.argv[2] || process.env.CHROME ||
  (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome')
const W = 480, H = 320
const STEP = 50 // 20 fps: an SPI screen at 48 MHz can't show more anyway
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vyron-splash-'))
fs.mkdirSync(OUT, { recursive: true })

let n = 0
function shot(url) {
  const f = path.join(TMP, `${n++}.png`)
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`,
    '--virtual-time-budget=400', `--screenshot=${f}`, url], { stdio: 'ignore' })
  return decodePng(f)
}

/** PNG (8 bit, RGB/RGBA, no interlace) → RGB888 */
function decodePng(file) {
  const b = fs.readFileSync(file); let p = 8, w, h, ct; const idat = []
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw new Error('png format') }
    if (type === 'IDAT') idat.push(d)
    p += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = ct === 6 ? 4 : 3, stride = w * bpp, px = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1, o = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, u = y ? px[o - stride + x] : 0, c = y && x >= bpp ? px[o - stride + x - bpp] : 0
      let v = raw[s + x]
      if (f === 1) v += a; else if (f === 2) v += u; else if (f === 3) v += (a + u) >> 1
      else if (f === 4) { const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c }
      px[o + x] = v & 255
    }
  }
  const rgb = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = px[i * bpp]; rgb[i * 3 + 1] = px[i * bpp + 1]; rgb[i * 3 + 2] = px[i * bpp + 2] }
  return rgb
}

/** RGB888 → RGB565 LE with 4×4 dithering (without it dark gradients show banding) */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
function to565(rgb) {
  const out = Buffer.alloc(W * H * 2)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, d = BAYER[(y & 3) * 4 + (x & 3)] / 16
    const r = Math.min(31, Math.floor(rgb[i * 3] / 255 * 31 + d))
    const g = Math.min(63, Math.floor(rgb[i * 3 + 1] / 255 * 63 + d))
    const b = Math.min(31, Math.floor(rgb[i * 3 + 2] / 255 * 31 + d))
    out.writeUInt16LE(r << 11 | g << 5 | b, i * 2)
  }
  return out
}

const boot = pathToFileURL(path.join(ROOT, 'apps/screen/demo/boot.html')).href
function save(name, from, to) {
  const a = []
  for (let t = from; t < to; t += STEP) a.push(to565(shot(`${boot}?native&auto=boot&t=${t}`)))
  fs.writeFileSync(path.join(OUT, name), zlib.gzipSync(Buffer.concat(a), { level: 9 }))
  console.log(name, a.length, 'frames')
}
// Intro (pieces dropping, dots appearing) and a seamless dot loop (exactly one period, 1200 ms)
save('intro.565.gz', 0, 2450)
save('loop.565.gz', 2450, 3650)
fs.rmSync(TMP, { recursive: true, force: true })
