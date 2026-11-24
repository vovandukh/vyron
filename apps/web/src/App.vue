<script setup>
import { computed, onMounted, watch } from 'vue'
import { usePrinterStore } from './stores/printerStore'
import { useUiStore } from './stores/uiStore'
import { useSettingsStore } from './stores/settingsStore'
import { chime } from './services/sound'

import PrintPreview3D from './components/viz/PrintPreview3D.vue'
import BackdropFx from './components/viz/BackdropFx.vue'
import AppHeader from './components/layout/AppHeader.vue'
import ProgressBar from './components/layout/ProgressBar.vue'
import KlippyCard from './components/layout/KlippyCard.vue'
import KlipperToasts from './components/layout/KlipperToasts.vue'

import ControlTab from './components/tabs/ControlTab.vue'
import ConsoleTab from './components/tabs/ConsoleTab.vue'
import BedMeshTab from './components/tabs/BedMeshTab.vue'
import HistoryTab from './components/tabs/HistoryTab.vue'
import CameraTab from './components/tabs/CameraTab.vue'
import EngineeringMenu from './components/tabs/EngineeringMenu.vue'

import SettingsModal from './components/modals/SettingsModal.vue'
import UpdatesModal from './components/modals/UpdatesModal.vue'
import WifiModal from './components/modals/WifiModal.vue'
import TemperatureModal from './components/modals/TemperatureModal.vue'
import ConfirmModal from './components/modals/ConfirmModal.vue'

const printer = usePrinterStore()
const ui = useUiStore()

// Panels over the 3D scene. "Control" (main) is the scene itself with its controls.
const panels = {
  cam: CameraTab, console: ConsoleTab, mesh: BedMeshTab, hist: HistoryTab, eng: EngineeringMenu,
  set: SettingsModal, upd: UpdatesModal, net: WifiModal
}
const panel = computed(() => panels[ui.view] || null)

onMounted(() => printer.autoStart())

// Event sounds (Settings → Notifications): print finished / print failed / Klipper stopped
const settings = useSettingsStore()
watch(() => printer.printState, (s, o) => {
  if (!settings.sound || !o || s === o) return
  if (s === 'complete' && o === 'printing') chime('done')
  else if (s === 'error') chime('error')
})
watch(() => printer.klippy.state, (s, o) => { if (settings.sound && o && s !== o && (s === 'shutdown' || s === 'error')) chime('error') })
</script>

<template>
  <BackdropFx />
  <PrintPreview3D />
  <AppHeader />
  <!-- "Control" uses opacity only: a transform on the wrapper would break position:fixed of its children -->
  <Transition name="ctl">
    <ControlTab v-show="ui.view === 'main'" />
  </Transition>
  <!-- KeepAlive keeps tab state (including unsaved config edits) across switches.
       The explicit :key is required: otherwise v-if gives every panel key=0 and the KeepAlive cache mixes them up.
       Transition outside KeepAlive (as Vue requires): panels cross-fade with a slight spring slide. -->
  <Transition name="pane">
    <KeepAlive>
      <component :is="panel" v-if="panel" :key="ui.view" />
    </KeepAlive>
  </Transition>
  <ProgressBar />
  <!-- Klipper errors: the state card (shutdown / config / startup) and G-code error toasts -->
  <KlippyCard />
  <KlipperToasts />
  <!-- Demo (GitHub Pages): welcome card on first visit -->
  <TemperatureModal />
  <ConfirmModal />
</template>
