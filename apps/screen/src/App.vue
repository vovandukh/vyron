<script setup>
// Vyron Screen: the top bar is always there; below it — connecting, a Klipper error or the current page (navigation stack).
import { computed, onMounted, ref, watch } from 'vue'
import { usePrinter } from './store'
import { watchBuild, saveResume, takeResume, revealReady } from '@vyron/shared/live'
import { t } from './i18n'
import TopBar from './components/TopBar.vue'
import HomeView from './components/HomeView.vue'
import ErrorView from './components/ErrorView.vue'
import ConfirmSheet from './components/ConfirmSheet.vue'
import Splash from './components/Splash.vue'
import SettingsPage from './pages/SettingsPage.vue'
import WifiPage from './pages/WifiPage.vue'
import ThemePage from './pages/ThemePage.vue'
import LanguagePage from './pages/LanguagePage.vue'
import AboutPage from './pages/AboutPage.vue'
import SystemPage from './pages/SystemPage.vue'
import UpdatesPage from './pages/UpdatesPage.vue'
import MovePage from './pages/MovePage.vue'
import HeatPage from './pages/HeatPage.vue'
import FilesPage from './pages/FilesPage.vue'
import FilePage from './pages/FilePage.vue'
import TunePage from './pages/TunePage.vue'
import BackupsPage from './pages/BackupsPage.vue'
import FilamentPage from './pages/FilamentPage.vue'

const PAGES = { settings: SettingsPage, wifi: WifiPage, theme: ThemePage, language: LanguagePage, about: AboutPage, system: SystemPage, updates: UpdatesPage, move: MovePage, temp: HeatPage, files: FilesPage, file: FilePage, tune: TunePage, backups: BackupsPage, filament: FilamentPage }

const p = usePrinter()
onMounted(() => p.start())
// New version on the printer (Update Manager): reload quietly when nobody touches the screen —
// after 4 s on the home page, 30 s elsewhere (so e.g. typing a Wi‑Fi password isn't interrupted).
// visibleOnly: false — Chromium without a window manager may consider the page hidden.
watchBuild({
  canReload: () => !ask.value && !p.busy && !p.moving,
  idle: () => (p.page === 'home' ? 4000 : 30000),
  visibleOnly: false,
  beforeReload: () => saveResume({ stack: p.stack })
})
// After a quiet update — back to the page that was open
const resume = takeResume()
if (resume && Array.isArray(resume.stack) && resume.stack[0] === 'home') p.stack = resume.stack
// Seamless: the old version's snapshot stays until this one connects and shows the printer state
let revealed = false
const shown = computed(() => p.link === 'open' && (p.klippy.state !== 'ready' || !!p.st.print_stats))
watch(shown, ok => {
  if (ok && !revealed) { revealed = true; setTimeout(revealReady, 250) }
}, { immediate: true })
// Launch animation only on a real start (printer power-on, screen restart), not after a quiet update
const splash = ref(!resume)

const view = computed(() => {
  if (p.page !== 'home') return 'page'
  if (p.link !== 'open') return 'wait'
  return p.klippy.state === 'ready' ? 'home' : 'error'
})

/** Confirmation: 'cancel' (cancel the print) | 'stop' (emergency stop) */
const ask = ref('')
function confirmed() {
  if (ask.value === 'cancel') p.cancel()
  else if (ask.value === 'stop') p.estop()
  ask.value = ''
}
</script>

<template>
  <TopBar @stop="ask = 'stop'" />
  <Transition :name="p.dir">
    <component :is="PAGES[p.page]" v-if="view === 'page'" :key="p.page" />
    <div v-else-if="view === 'wait'" key="wait" class="page wait">
      <b>{{ t(p.link === 'idle' ? 'scr.noHost' : p.link === 'lost' ? 'conn.lost' : 'scr.connecting') }}</b>
      <span v-if="p.host">{{ p.host }}</span>
    </div>
    <ErrorView v-else-if="view === 'error'" key="error" />
    <HomeView v-else key="home" @cancel="ask = 'cancel'" />
  </Transition>

  <ConfirmSheet v-if="ask === 'cancel'" :text="t('print.cancelConfirm')" :ok="t('print.cancelOk')" @ok="confirmed" @cancel="ask = ''" />
  <ConfirmSheet v-if="ask === 'stop'" :text="t('estop.confirm')" ok="STOP" :cancel="t('common.cancel')" @ok="confirmed" @cancel="ask = ''" />
  <Splash v-if="splash" :ready="shown" @done="splash = false" />
</template>

<style scoped>
.wait{display:grid;place-content:center;justify-items:center;gap:.8rem;text-align:center;padding:2rem}
.wait b{font-size:1.8rem;font-weight:600}
.wait span{font-size:1.3rem;color:var(--dim)}
</style>
