<script setup>
// Camera: the camera list from Moonraker (server.webcams.list) and a player.
// Supported: WebRTC MediaMTX (WHEP), MJPEG, HLS (only where the browser plays it natively — Safari/iOS).
// The stream runs only while the tab is open and the page visible: printer Wi‑Fi is weak, extra traffic hurts.
import { ref, computed, onActivated, onDeactivated, onBeforeUnmount, watch } from 'vue'
import { usePrinterStore } from '../../stores/printerStore'
import { useI18n } from '../../composables/useI18n'
import { httpBase } from '@vyron/shared/moonraker/client'

const printer = usePrinterStore()
const { t } = useI18n()

const cams = ref([])
const loaded = ref(false)
const sel = ref(0)
const cam = computed(() => cams.value[sel.value] || null)
const state = ref('idle')            // idle | connecting | live | error | unsupported
const box = ref(null), video = ref(null)
const mjpegSrc = ref('')
let pc = null, retry = null, active = false

/** Address from the camera settings: a relative one (/webcam-rtc/cam/) is resolved against the printer's web server, not the Moonraker port */
function resolve(u) {
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  const host = String(printer.host || location.host).replace(/:7125$/, '')
  return httpBase(host) + (u.startsWith('/') ? u : '/' + u)
}

const kind = computed(() => {
  const s = (cam.value && cam.value.service) || ''
  if (s.startsWith('webrtc-mediamtx')) return 'webrtc'
  if (s.startsWith('mjpegstreamer') || s === 'uv4l-mjpeg' || s === 'ipstream') return 'mjpeg'
  if (s === 'hlsstream') return 'hls'
  return 'other'
})

// Mirror / rotation from the camera settings in Moonraker
const transform = computed(() => {
  const c = cam.value || {}
  const tr = []
  if (c.rotation) tr.push(`rotate(${c.rotation}deg)`)
  if (c.flip_horizontal) tr.push('scaleX(-1)')
  if (c.flip_vertical) tr.push('scaleY(-1)')
  return tr.join(' ') || 'none'
})

/** Camera list; while there's no Moonraker connection we don't assume there are no cameras (empty only by an answer) */
async function load() {
  if (!printer.connected) return false
  try {
    const r = await printer.call('server.webcams.list', {})
    cams.value = (r && r.webcams || []).filter(c => c.enabled !== false)
    if (sel.value >= cams.value.length) sel.value = 0
    loaded.value = true
    return true
  } catch { return false }
}

function stop() {
  recStop()   // a running recording is saved to a file
  clearTimeout(retry); retry = null
  if (pc) { try { pc.close() } catch { /* already closed */ } pc = null }
  if (video.value) { video.value.srcObject = null; video.value.removeAttribute('src') }
  mjpegSrc.value = ''
  state.value = 'idle'
}

function later() {
  if (!active) return
  state.value = 'error'
  clearTimeout(retry)
  retry = setTimeout(start, 3000)
}

/** WebRTC via WHEP (MediaMTX): offer → POST …/whep → answer */
async function startWebrtc(url) {
  const base = url.endsWith('/') ? url : url + '/'
  const p = new RTCPeerConnection()
  pc = p
  p.addTransceiver('video', { direction: 'recvonly' })
  p.ontrack = e => { if (video.value) video.value.srcObject = e.streams[0] }
  p.onconnectionstatechange = () => {
    if (pc !== p) return
    if (p.connectionState === 'connected') state.value = 'live'
    else if (p.connectionState === 'failed' || p.connectionState === 'disconnected') { stop(); later() }
  }
  await p.setLocalDescription(await p.createOffer())
  // Wait for ICE candidates (at most 2 s) to send the full SDP in one request
  await new Promise(res => {
    if (p.iceGatheringState === 'complete') return res()
    const to = setTimeout(res, 2000)
    p.onicegatheringstatechange = () => { if (p.iceGatheringState === 'complete') { clearTimeout(to); res() } }
  })
  const r = await fetch(base + 'whep', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: p.localDescription.sdp })
  if (!r.ok) throw new Error('WHEP ' + r.status)
  if (pc !== p) return
  await p.setRemoteDescription({ type: 'answer', sdp: await r.text() })
}

async function start() {
  stop()
  if (!active || !cam.value || document.hidden) return
  const url = resolve(cam.value.stream_url)
  state.value = 'connecting'
  try {
    if (kind.value === 'webrtc') await startWebrtc(url)
    else if (kind.value === 'mjpeg') { mjpegSrc.value = url; state.value = 'live' }
    else if (kind.value === 'hls' && video.value && video.value.canPlayType('application/vnd.apple.mpegurl')) {
      video.value.src = url; state.value = 'live'
    } else state.value = 'unsupported'
  } catch { stop(); later() }
}

// ---------- photo and recording (in the browser: the file is saved on this device) ----------
const stamp = () => {
  const d = new Date(), z = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
}
const fileBase = () => 'vyron-' + String((cam.value && cam.value.name) || 'cam').replace(/[^\w-]+/g, '_') + '-' + stamp()
function save(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

const shot = ref(false)   // a short flash after a photo
function photo() {
  const src = kind.value === 'mjpeg' ? box.value?.querySelector('img') : video.value
  const w = src && (src.videoWidth || src.naturalWidth), h = src && (src.videoHeight || src.naturalHeight)
  if (!w || !h) return
  const c = cam.value || {}, rot = ((c.rotation || 0) % 360 + 360) % 360, side = rot === 90 || rot === 270
  const cv = document.createElement('canvas')
  cv.width = side ? h : w; cv.height = side ? w : h
  const g = cv.getContext('2d')
  g.translate(cv.width / 2, cv.height / 2)
  g.rotate(rot * Math.PI / 180)
  g.scale(c.flip_horizontal ? -1 : 1, c.flip_vertical ? -1 : 1)
  g.drawImage(src, -w / 2, -h / 2, w, h)
  try {
    cv.toBlob(b => { if (b) { save(b, fileBase() + '.jpg'); shot.value = true; setTimeout(() => { shot.value = false }, 250) } }, 'image/jpeg', 0.92)
  } catch {   // MJPEG from another origin without CORS — the browser won't let us read the frame
    note.value = t('cam.photoFail'); setTimeout(() => { note.value = '' }, 4000)
  }
}
const note = ref('')

const canRecord = computed(() => kind.value === 'webrtc' && state.value === 'live' && typeof MediaRecorder !== 'undefined')
const rec = ref(null)       // { mr, chunks, t0, type }
const recSec = ref(0)
let recTimer = null
const recTime = computed(() => { const s = recSec.value; return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') })

function recStart() {
  const stream = video.value && video.value.srcObject
  if (!stream) return
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || ''
  const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
  const r = { mr, chunks: [], type: mr.mimeType || type || 'video/webm' }
  mr.ondataavailable = e => { if (e.data && e.data.size) r.chunks.push(e.data) }
  mr.onstop = () => {
    clearInterval(recTimer)
    if (r.chunks.length) save(new Blob(r.chunks, { type: r.type }), fileBase() + (r.type.includes('mp4') ? '.mp4' : '.webm'))
    if (rec.value === r) rec.value = null
  }
  mr.start(1000)
  rec.value = r
  recSec.value = 0
  recTimer = setInterval(() => { recSec.value++ }, 1000)
}
function recStop() { if (rec.value && rec.value.mr.state !== 'inactive') rec.value.mr.stop() }
const toggleRec = () => (rec.value ? recStop() : recStart())

function fullscreen() {
  const el = box.value
  if (!el) return
  if (document.fullscreenElement) document.exitFullscreen()
  else el.requestFullscreen?.()
}

const onVis = () => { if (!active) return; if (document.hidden) stop(); else start() }

onActivated(async () => {
  active = true
  document.addEventListener('visibilitychange', onVis)
  await load()   // every time: cameras may have been added or changed
  start()
})
// The page was opened straight on Camera — wait for the Moonraker connection
watch(() => printer.connected, async c => { if (c && active && await load()) start() })
onDeactivated(() => { active = false; document.removeEventListener('visibilitychange', onVis); stop() })
onBeforeUnmount(() => { active = false; document.removeEventListener('visibilitychange', onVis); stop() })
watch(sel, () => { if (active) start() })
</script>

<template>
  <section class="view cam">
    <div v-if="loaded && !cams.length" class="empty">
      <b>{{ t('cam.none') }}</b>
      <span>{{ t('cam.noneHint') }}</span>
    </div>
    <template v-else>
      <div class="bar">
        <div v-if="cams.length > 1" class="seg" role="tablist">
          <button v-for="(c, i) in cams" :key="c.uid || c.name" :class="{ on: i === sel }" @click="sel = i">{{ c.name }}</button>
        </div>
        <b v-else class="name">{{ cam && cam.name }}</b>
        <span class="chip" :class="state">{{ t('cam.state.' + state) }}</span>
        <button class="fs" :disabled="state !== 'live'" :aria-label="t('cam.photo')" :title="t('cam.photo')" @click="photo">
          <svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" /><circle cx="12" cy="13" r="3.2" /></svg>
        </button>
        <button class="fs rec" :class="{ on: rec }" :disabled="!rec && !canRecord" :aria-label="t(rec ? 'cam.recStop' : 'cam.rec')"
                :title="t(rec ? 'cam.recStop' : 'cam.rec')" @click="toggleRec">
          <svg viewBox="0 0 24 24"><circle v-if="!rec" cx="12" cy="12" r="6" /><rect v-else x="7" y="7" width="10" height="10" rx="1.5" /></svg>
          <span v-if="rec" class="rt">{{ recTime }}</span>
        </button>
        <button class="fs" :aria-label="t('cam.fullscreen')" :title="t('cam.fullscreen')" @click="fullscreen">
          <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      </div>
      <div ref="box" class="stage" @dblclick="fullscreen">
        <img v-if="kind === 'mjpeg' && mjpegSrc" :src="mjpegSrc" :style="{ transform }" alt="" @error="later">
        <video v-else ref="video" :style="{ transform }" autoplay muted playsinline />
        <div v-if="state !== 'live'" class="over">{{ t('cam.state.' + state) }}</div>
        <div v-if="shot" class="flash" />
        <div v-if="rec" class="recdot">REC {{ recTime }}</div>
        <div v-if="note" class="note">{{ note }}</div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.cam{display:flex;flex-direction:column;gap:12px}
.bar{display:flex;align-items:center;gap:10px}
.name{font-size:14px;font-weight:600}
.seg{display:flex;gap:6px;flex-wrap:wrap}
.seg .on{border-color:var(--brand);color:var(--ink)}
.chip{margin-left:auto;font:500 11px/1 var(--mono);padding:6px 10px;border-radius:999px;background:var(--surface-hi);color:var(--muted, #9aa)}
.chip.live{color:#3ddc84}
.chip.error{color:var(--red)}
.fs{display:flex;align-items:center;gap:6px;padding:7px 9px}
.rec svg{fill:var(--red);stroke:none}
.rec.on{border-color:var(--red);color:var(--red)}
.rt{font:500 11px/1 var(--mono)}
.flash{position:absolute;inset:0;background:#fff;opacity:.55;pointer-events:none;animation:fl .25s ease-out forwards}
@keyframes fl{to{opacity:0}}
.recdot{position:absolute;top:10px;left:10px;font:600 11px/1 var(--mono);color:#fff;background:rgba(220,30,30,.85);padding:5px 8px;border-radius:999px}
.note{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);font-size:12px;color:#fff;background:rgba(0,0,0,.7);padding:6px 10px;border-radius:8px}
.fs svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.stage{position:relative;flex:1;min-height:0;border-radius:var(--r);overflow:hidden;background:#000;display:grid;place-items:center}
.stage video,.stage img{width:100%;height:100%;object-fit:contain;display:block}
.over{position:absolute;inset:0;display:grid;place-items:center;color:rgba(255,255,255,.7);font-size:13px;background:rgba(0,0,0,.35)}
.empty{margin:auto;display:flex;flex-direction:column;gap:6px;align-items:center;text-align:center;max-width:420px}
.empty span{opacity:.7;font-size:13px}
/* Touch screens: photo / record / fullscreen buttons are 44 px */
@media(pointer:coarse){.fs{min-width:44px;min-height:44px;justify-content:center}}
</style>
