<script setup>
// System: restart Klipper / Moonraker and the host. Every action asks for confirmation; anything that would
// interrupt a print is disabled while printing.
import { onMounted, ref } from 'vue'
import { usePrinter } from '../store'
import { t } from '../i18n'
import Row from '../components/Row.vue'
import ConfirmSheet from '../components/ConfirmSheet.vue'

const p = usePrinter()
const ACTIONS = {
  restart: { label: 'klippy.restart', ask: 'eng.confirmRestart', run: () => p.restart(), icon: 'restart' },
  fw: { label: 'klippy.fw', ask: 'eng.confirmFw', run: () => p.firmwareRestart(), icon: 'chip' },
  moonraker: { label: 'menu.restartMoonraker', ask: 'confirm.restartMoonraker', run: () => p.restartMoonraker(), icon: 'refresh' },
  reboot: { label: 'menu.reboot', ask: 'confirm.reboot', run: () => p.reboot(), icon: 'host' },
  shutdown: { label: 'menu.shutdown', ask: 'confirm.shutdown', run: () => p.shutdown(), icon: 'power' },
  factory: { label: 'scr.factory', ask: 'scr.factoryAsk', run: () => factoryReset(), icon: 'restart' }
}
const ask = ref('')
function ok() { ACTIONS[ask.value].run(); ask.value = '' }

// Factory reset — a hidden button: only on printers prepared by the factory part (vyron_factory entry in
// the Moonraker database). The UI resets nothing itself: it creates the request folder config/vyron-factory-reset,
// which the vyron-factory-reset.path system unit picks up and runs the reset with a reboot.
const factory = ref(false)
const factoryNote = ref('')
onMounted(async () => {
  try { factory.value = !!(await p.call('server.database.get_item', { namespace: 'vyron_factory', key: 'oobe' })).value } catch { factory.value = false }
})
async function factoryReset() {
  try {
    await p.call('server.files.post_directory', { path: 'config/vyron-factory-reset' })
    factoryNote.value = 'scr.factoryRun'
  } catch { factoryNote.value = 'scr.factoryFail' }
}
</script>

<template>
  <div class="page set">
    <h1>{{ t('scr.page.system') }}</h1>
    <div class="grp">
      <Row v-for="id in ['restart', 'fw', 'moonraker']" :key="id" :icon="ACTIONS[id].icon"
           :label="t(ACTIONS[id].label)" :disabled="p.active" @tap="ask = id" />
    </div>
    <div class="grp">
      <Row v-for="id in ['reboot', 'shutdown']" :key="id" :icon="ACTIONS[id].icon"
           :label="t(ACTIONS[id].label)" :danger="id === 'shutdown'" :disabled="p.active" @tap="ask = id" />
    </div>
    <p class="grp-f">{{ t(p.active ? 'scr.sysBusy' : 'scr.sysHint') }}</p>
    <template v-if="factory">
      <div class="grp">
        <Row icon="restart" :label="t('scr.factory')" danger :disabled="p.active || factoryNote === 'scr.factoryRun'" @tap="ask = 'factory'" />
      </div>
      <p v-if="factoryNote" class="grp-f">{{ t(factoryNote) }}</p>
    </template>
    <ConfirmSheet v-if="ask" :text="t(ACTIONS[ask].ask)" :ok="t(ACTIONS[ask].label)" :cancel="t('common.cancel')" @ok="ok" @cancel="ask = ''" />
  </div>
</template>
