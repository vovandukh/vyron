<script setup>
import { computed } from 'vue'
import { usePrinterStore } from '../../stores/printerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useConfirm } from '../../composables/useConfirm'
import { useI18n } from '../../composables/useI18n'

const printer = usePrinterStore()
const settings = useSettingsStore()
const { confirm } = useConfirm()
const { t } = useI18n()

// While printing the button slowly "breathes" a red glow — emergency stop is always in sight.
const live = computed(() => printer.printState === 'printing')

async function stop() {
  if (settings.cEstop && !(await confirm('estop.confirm'))) return
  printer.emergencyStop()
}
</script>

<template>
  <button class="estop" :class="{ live }" :aria-label="t('estop.label')" :title="t('estop.title')" @click="stop">STOP</button>
</template>

<style scoped>
.estop{position:relative;color:#fff;border:0;height:34px;padding:0 14px;border-radius:17px;font:inherit;font-size:11px;font-weight:700;letter-spacing:.1em;cursor:pointer;
  background:linear-gradient(180deg,#ef3b2f,#c4231a);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.28),inset 0 -1px 0 rgba(0,0,0,.25),0 4px 14px -6px rgba(var(--red-rgb),.9);
  transition:transform var(--t-spring) var(--spring),filter var(--t-fast) var(--ease-out)}
.estop:hover{filter:brightness(1.12)}
.estop:active{transform:scale(.92);filter:brightness(.95)}
.estop:focus-visible{outline:2px solid #fff;outline-offset:2px}
/* Breathing: a slow sine of the outer glow (the button is small — repainting the shadow is cheap) */
.estop.live{animation:breathe 3.6s cubic-bezier(.45,0,.55,1) infinite}
@keyframes breathe{
  0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.28),inset 0 -1px 0 rgba(0,0,0,.25),0 0 0 0 rgba(var(--red-rgb),0),0 4px 14px -6px rgba(var(--red-rgb),.9)}
  50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.28),inset 0 -1px 0 rgba(0,0,0,.25),0 0 0 4px rgba(var(--red-rgb),.16),0 0 22px 2px rgba(var(--red-rgb),.55)}
}
/* Touch screens: the hit area is 5 px wider on each side (44 px tall) without changing the look */
@media(pointer:coarse){.estop::before{content:'';position:absolute;inset:-5px;border-radius:22px}}
</style>
