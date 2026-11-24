// Screen uses the same dictionaries as Vyron Web (@vyron/shared/locales).
// The language is picked on the screen (Settings → Language) and remembered on this device.
import { ref, watch } from 'vue'
import { translate, systemLang } from '@vyron/shared/i18n'

const KEY = 'vyron.screen.lang'
let saved = systemLang()
try { saved = localStorage.getItem(KEY) || saved } catch { /* no storage */ }

export const LANGS = [{ id: 'uk', name: 'Українська' }, { id: 'en', name: 'English' }]
export const lang = ref(saved)
watch(lang, l => {
  document.documentElement.lang = l
  try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
}, { immediate: true })

export const t = (key, params) => translate(lang.value, key, params)
