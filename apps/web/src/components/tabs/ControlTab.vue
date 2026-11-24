<script setup>
// Control: elements over the 3D scene. Hidden whenever any other panel is open.
import { usePrinterStore } from '../../stores/printerStore'
import { useI18n } from '../../composables/useI18n'
import StatusPanel from './control/StatusPanel.vue'
import JogControls from './control/JogControls.vue'
import TuneControls from './control/TuneControls.vue'
import ToolStrip from './control/ToolStrip.vue'
import RollNumber from '../ui/RollNumber.vue'
import MobileControl from './control/MobileControl.vue'
import { useMobile } from '../../composables/useMobile'
import { computed } from 'vue'
import { fmtDuration } from '@vyron/shared/format'

const printer = usePrinterStore()
const { t, tm } = useI18n()
/** Phone / portrait up to 900 px — a separate mobile screen (MobileControl) */
const mobile = useMobile()

// Current print card under the percent: file name and summary — elapsed, left, layer, filament
const job = computed(() => {
  const ps = printer.st.print_stats || {}
  if (!printer.printBusy && ps.state !== 'complete') return null
  const name = String(ps.filename || '').replace(/^.*\//, '').replace(/\.gcode$/i, '')
  const time = [], more = []
  if (ps.print_duration > 0) time.push(t('job.elapsed', { t: fmtDuration(ps.print_duration, t) }))
  if (printer.etaSeconds != null) time.push(t('eta.left', { t: fmtDuration(printer.etaSeconds, t) }))
  if (printer.layerText && printer.layerText !== '–') more.push(t('job.layer', { l: printer.layerText }))
  if (ps.filament_used > 0) more.push(t('job.fil', { m: (ps.filament_used / 1000).toFixed(1) }))
  return { name, lines: [time.join(' · '), more.join(' · ')].filter(Boolean) }
})
</script>

<template>
  <div class="control">
    <!-- 3D preview of a file from history: the scene isn't showing the current print -->
    <div v-if="printer.preview" class="pv" role="status">
      <span class="pv-tag">3D</span>
      <span class="pv-name" :title="printer.preview.name">{{ printer.preview.name }}</span>
      <span v-if="printer.preview.loading" class="pv-dim">{{ t('preview.loading') }}</span>
      <span v-else-if="printer.preview.error" class="pv-err">{{ t('preview.error', { msg: printer.preview.error }) }}</span>
      <button @click="printer.closePreview()">{{ t('preview.close') }}</button>
    </div>
    <MobileControl v-if="mobile" />
    <template v-else>
      <StatusPanel />
      <!-- During a print, live tuning replaces motion (Z offset, speed, flow, fan) -->
      <TuneControls v-if="printer.printBusy" />
      <JogControls v-else />
      <!-- Percent and print summary — one column from the bottom: a longer summary lifts the percent by itself -->
      <div class="bl" :class="{ hj: job }">
        <div class="pct"><RollNumber :value="printer.progressPct" fade /><small>%</small></div>
        <div v-if="job" class="job">
          <b :title="job.name">{{ job.name }}</b>
          <span v-for="(l, i) in job.lines" :key="i">{{ l }}</span>
        </div>
      </div>
      <div v-if="!job" class="meta">{{ tm(printer.meta) }}</div>
      <ToolStrip />
    </template>
  </div>
</template>

<style scoped>
/* Size and width are limited by the distance to the centred toolhead strip (~450px for 6 toolheads), so "100%"
   and a long file name don't slide under it. */
.bl{position:fixed;left:32px;bottom:55px;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.bl.hj{bottom:20px}
.pct{position:relative;display:flex;align-items:baseline;font-size:clamp(70px,min(16vw,calc((50vw - 270px) / 2)),130px);font-weight:200;line-height:1;letter-spacing:-.04em;pointer-events:none;--rn-h:1.04em}
/* Anodised metal: a vertical gradient on each odometer digit (each cell is its own "plate") */
.pct :deep(.rn-strip>span),.pct :deep(.rn-fv){background:linear-gradient(180deg,#ffffff 0%,#eef0f3 34%,#b9bec6 72%,#8a9099 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
/* Soft warm glow behind (a separate layer, no costly filter on large text) */
.pct::before{content:'';position:absolute;left:-18%;right:-30%;top:-10%;bottom:-25%;z-index:-1;border-radius:50%;
  background:radial-gradient(closest-side,rgba(var(--brand-rgb),.16),rgba(var(--brand-rgb),.05) 60%,transparent)}
.pct small{font-size:.3em;color:var(--brand);margin-left:5px;text-shadow:0 0 18px rgba(var(--brand-rgb),.6)}
.job{display:grid;gap:3px;padding-left:4px;max-width:max(190px,min(40vw,calc(50vw - 310px)))}
.job b{font-size:15px;font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.job span{font-size:12px;line-height:1.35;color:var(--dim)}
.meta{position:fixed;left:36px;bottom:24px;color:var(--dim);font-size:12px;pointer-events:none;max-width:min(40vw,calc(50vw - 280px));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(max-width:900px){.bl,.bl.hj{left:16px;bottom:24px}.pct{font-size:70px}.meta,.job{display:none}}
/* Short screens (1024×600): smaller percent so it doesn't meet the card on the left */
@media(max-height:700px) and (min-width:901px){.pct{font-size:clamp(60px,14vh,96px)}}
@media(max-width:560px){.bl,.bl.hj{bottom:12px}.pct{font-size:54px}}
.pv{position:fixed;top:calc(var(--hb,72px) + 12px);left:50%;transform:translateX(-50%);z-index:4;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 32px));padding:6px 6px 6px 10px;background:rgba(10,10,11,.88);border:1px solid var(--line);border-radius:9px;backdrop-filter:blur(10px);font-size:12px}
.pv-tag{flex:none;font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--brand);border:1px solid rgba(var(--brand-rgb),.6);border-radius:4px;padding:1px 5px}
.pv-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.pv-dim{color:var(--dim);white-space:nowrap}
.pv-err{color:var(--red);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.pv button{flex:none;background:rgba(10,10,11,.5);border:1px solid var(--line);color:var(--ink);font:inherit;font-size:12px;border-radius:7px;padding:6px 10px;cursor:pointer}
.pv button:hover{border-color:var(--brand)}
@media(max-width:700px){.pv{top:calc(var(--hb,72px) + 6px)}}
</style>
