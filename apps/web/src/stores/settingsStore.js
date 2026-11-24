import { defineStore } from 'pinia'
import { systemLang } from '@vyron/shared/i18n'

// Vyron key; before the rebrand settings lived under 'voronui' — they are picked up until new ones are saved.
const KEY = 'vyron'
const OLD_KEY = 'voronui'
export const DEFAULT_SETTINGS = { lang: systemLang(), cEstop: true, cSys: true, invX: false, invY: false, invZ: false, fxy: 3000, fz: 300, toasts: true, sound: false }

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY) || '{}')
    return s && typeof s === 'object' ? s : {}
  } catch { return {} }
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({ ...DEFAULT_SETTINGS, ...load() }),
  actions: {
    /** Numeric values are accepted only > 0; returns false if the value was rejected. */
    set(key, value) {
      if (!(key in DEFAULT_SETTINGS)) return false
      if (typeof DEFAULT_SETTINGS[key] === 'number') {
        const n = Number(value)
        if (!(n > 0) || !Number.isFinite(n)) return false
        value = n
      } else if (typeof DEFAULT_SETTINGS[key] === 'boolean') value = !!value
      this[key] = value
      return true
    },
    persist() {
      try { localStorage.setItem(KEY, JSON.stringify(this.$state)) } catch { /* private mode */ }
    }
  }
})
