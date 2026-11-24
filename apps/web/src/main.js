import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useSettingsStore } from './stores/settingsStore'
import { useDesignStore } from './stores/designStore'
import '@vyron/shared/fonts.css'
import './assets/main.css'
import { logoDataUri } from '@vyron/shared/logo'
import { watchBuild, saveResume, takeResume, revealReady } from '@vyron/shared/live'
import { usePrinterStore } from './stores/printerStore'
import { useUiStore } from './stores/uiStore'
import { DEMO_BUILD } from './config'
import { allowLocalInsecure } from '@vyron/shared/moonraker/client'
import { dicts } from '@vyron/shared/i18n'
import { demoLocales } from '@vyron/shared/locales/demo'

// GitHub Pages demo (https): allow connecting to a printer on the local network without TLS (ws/http)
// and merge the demo texts (control centre, error simulation, screens) — they never reach the printer build
if (DEMO_BUILD) {
  allowLocalInsecure()
  Object.assign(dicts.uk, demoLocales.uk)
  Object.assign(dicts.en, demoLocales.en)
}

// Favicon — the Vyron mark as an SVG data URI: the single-file build (vite-plugin-singlefile) needs no file next to the HTML.
// Its colour is the theme's brand colour and follows design changes.
const icon = document.createElement('link')
icon.rel = 'icon'
icon.type = 'image/svg+xml'
document.head.appendChild(icon)

const app = createApp(App)
app.use(createPinia())

// Settings: persisted to localStorage, plus the document's lang attribute.
const settings = useSettingsStore()
settings.$subscribe(() => settings.persist())
watch(() => settings.lang, l => { document.documentElement.lang = l }, { immediate: true })

// UI theme (Design page): applied before mounting so the very first frame has the right colours
const design = useDesignStore()
watch(() => design.d.brand, b => { icon.href = logoDataUri(b) }, { immediate: true })

// New UI version on the printer (Update Manager): quiet reload while the page is idle —
// no open dialogs or input fields; the open tab is restored.
const ui = useUiStore()
const resume = takeResume()
if (resume && resume.view) { ui.go(resume.view); if (resume.engSection) ui.engSection = resume.engSection }
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')
watchBuild({
  canReload: () => !ui.dialog && !ui.tempModal && !ui.cc && !typing(),
  beforeReload: () => saveResume({ view: ui.view, engSection: ui.engSection })
})

// Seamless update: the old version's snapshot stays until this one connects to the printer and gets its state
const printer = usePrinterStore()
let revealed = false
watch(() => printer.link, l => {
  if (!revealed && (l === 'ready' || l === 'shutdown' || l === 'demo')) { revealed = true; setTimeout(revealReady, 300) }
}, { immediate: true })

app.mount('#app')
