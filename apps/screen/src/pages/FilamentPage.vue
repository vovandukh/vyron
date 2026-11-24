<script setup>
// Filament on the printer screen: heat the nozzle with a preset, Unload / Load, manual feed.
// G-code and checks are shared with Vyron Web (@vyron/shared/klipper/filament): LOAD_/UNLOAD_FILAMENT macros if present.
// During a print — only when paused (filament change mid-print, M600).
import { computed, ref, watch } from 'vue'
import { HEAT_PRESETS } from '@vyron/shared/klipper/heat'
import { FIL_LENGTHS, FIL_SPEEDS, FIL_DEFAULT, FIL_LOAD, FIL_UNLOAD, canExtrude, extrudeScript, loadScript, unloadScript } from '@vyron/shared/klipper/filament'
import { usePrinter } from '../store'
import { t } from '../i18n'
import Icon from '../components/Icon.vue'

const p = usePrinter()
const KEY = 'vyron.filament'
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} } })()
const len = ref(FIL_LENGTHS.includes(saved.len) ? saved.len : FIL_DEFAULT.len)
const speed = ref(FIL_SPEEDS.includes(saved.speed) ? saved.speed : FIL_DEFAULT.speed)
watch([len, speed], () => { try { localStorage.setItem(KEY, JSON.stringify({ ...saved, len: len.value, speed: speed.value })) } catch { /* no storage */ } })

const ex = computed(() => p.st.extruder || {})
const now = computed(() => (ex.value.temperature == null ? '–' : Math.round(ex.value.temperature)))
const target = computed(() => Math.round(ex.value.target || 0))
const hot = computed(() => canExtrude(ex.value, p.filLim.minTemp))
const block = computed(() => {
  if (p.printState === 'printing') return t('fil.printing')
  if (!hot.value) return t('fil.cold', { t: now.value, min: p.filLim.minTemp })
  return ''
})
const done = ref('')
const NOZZLE = [...new Set(HEAT_PRESETS.map(x => x.nozzle))]
const macroList = computed(() => [p.filMacros.unload, p.filMacros.load].filter(Boolean).join(', '))

async function go(kind) {
  if (block.value || p.filBusy) return
  const max = p.filLim.maxDist
  const script = kind === 'load' ? loadScript(p.filMacros, max)
    : kind === 'unload' ? unloadScript(p.filMacros, max)
    : extrudeScript(kind === 'retract' ? -len.value : len.value, speed.value, max)
  done.value = ''
  if (await p.filament(kind, script)) done.value = t('fil.done.' + kind, { n: len.value })
}
</script>

<template>
  <div class="page set">
    <h1>{{ t('scr.page.filament') }}</h1>

    <div class="grp noz">
      <span class="ti" :class="{ hot: target > 0 }"><Icon name="nozzle" size="1.8rem" /></span>
      <span class="nm"><span class="lbl">{{ t('scr.filNozzle') }}</span><b class="now">{{ now }}<i>°</i><small v-if="target"> / {{ target }}°</small></b></span>
      <span class="pre">
        <button v-for="v in NOZZLE" :key="v" type="button" class="chip tap" :class="{ on: target === v }" @click="p.setTemp('extruder', v)">{{ v }}°</button>
        <button type="button" class="chip tap" :disabled="!target" :aria-label="t('qs.off')" @click="p.setTemp('extruder', 0)"><Icon name="power" size="1.5rem" :stroke="2.2" /></button>
      </span>
    </div>

    <div class="big">
      <button type="button" class="bb tap" :disabled="!!block || !!p.filBusy" @click="go('unload')">
        <i v-if="p.filBusy === 'unload'" class="spin"></i><Icon v-else name="up" size="2rem" :stroke="2.4" />
        <span><b>{{ t('fil.unload') }}</b><small>{{ p.filMacros.unload || t('fil.mm', { n: FIL_UNLOAD }) }}</small></span>
      </button>
      <button type="button" class="bb tap" :disabled="!!block || !!p.filBusy" @click="go('load')">
        <i v-if="p.filBusy === 'load'" class="spin"></i><Icon v-else name="down" size="2rem" :stroke="2.4" />
        <span><b>{{ t('fil.load') }}</b><small>{{ p.filMacros.load || t('fil.mm', { n: FIL_LOAD }) }}</small></span>
      </button>
    </div>

    <div class="grp man">
      <div class="opt"><span class="ol">{{ t('fil.mmUnit') }}</span>
        <button v-for="v in FIL_LENGTHS" :key="v" type="button" class="sc tap" :class="{ on: len === v }" @click="len = v">{{ v }}</button>
      </div>
      <div class="opt"><span class="ol">{{ t('fil.speedUnit') }}</span>
        <button v-for="v in FIL_SPEEDS" :key="v" type="button" class="sc tap" :class="{ on: speed === v }" @click="speed = v">{{ v }}</button>
      </div>
      <div class="pm">
        <button type="button" class="pb tap" :disabled="!!block || !!p.filBusy" @click="go('retract')">
          <i v-if="p.filBusy === 'retract'" class="spin"></i>{{ t('fil.retract', { n: len }) }}
        </button>
        <button type="button" class="pb tap" :disabled="!!block || !!p.filBusy" @click="go('extrude')">
          <i v-if="p.filBusy === 'extrude'" class="spin"></i>{{ t('fil.extrude', { n: len }) }}
        </button>
      </div>
    </div>

    <p class="grp-f" :class="{ warn: block }">{{ block || done || t('scr.filHint') }}<template v-if="macroList && !block"> {{ t('scr.filMacros', { m: macroList }) }}</template></p>
  </div>
</template>

<style scoped>
.noz{display:flex;align-items:center;gap:1rem;min-height:6rem;padding:.6rem .8rem .6rem 1.2rem}
.ti{flex:none;width:3.2rem;height:3.2rem;border-radius:.9rem;display:grid;place-items:center;background:var(--tile);color:var(--tile-ink)}
.ti.hot{color:var(--coral)}
.nm{flex:1;min-width:0;display:grid}
.lbl{font-size:1.15rem;color:var(--dim)}
.now{font-size:2.2rem;font-weight:600;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
.now i{font-style:normal;font-weight:400;color:var(--dim)}
.now small{font-size:1.3rem;font-weight:500;color:var(--dim)}
.pre{flex:none;display:flex;gap:.4rem}
.chip{min-width:4.4rem;height:4.4rem;padding:0 .6rem;border-radius:var(--r);background:var(--btn);border:1px solid var(--btn-edge);font-size:1.3rem;font-weight:600;font-variant-numeric:tabular-nums;display:grid;place-items:center}
.chip.on{background:var(--primary);border-color:transparent;color:var(--on-primary)}
.big{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin:1.2rem 0}
.bb{height:6.4rem;border-radius:var(--r);background:var(--btn);border:1px solid var(--btn-edge);display:flex;align-items:center;justify-content:center;gap:1rem}
.bb span{display:grid;text-align:left}
.bb b{font-size:1.6rem;font-weight:700}
.bb small{font-size:1.1rem;color:var(--dim)}
.man{display:grid;gap:.6rem;padding:1rem 1.2rem}
.opt{display:flex;align-items:center;gap:.4rem}
.ol{flex:none;width:4.6rem;font-size:1.2rem;color:var(--dim)}
.sc{flex:1;min-width:0;height:4rem;border-radius:var(--r);background:var(--btn);border:1px solid var(--btn-edge);font-size:1.35rem;font-weight:600;font-variant-numeric:tabular-nums}
.sc.on{background:var(--primary);border-color:transparent;color:var(--on-primary)}
.pm{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:.2rem}
.pb{height:4.6rem;border-radius:var(--r);background:var(--btn);border:1px solid var(--btn-edge);font-size:1.4rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:.6rem}
button:disabled{opacity:.4}
.warn{color:var(--amber)}
.spin{width:1.8rem;height:1.8rem;border-radius:50%;border:.25rem solid rgba(255,255,255,.2);border-top-color:var(--coral);animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
</style>
