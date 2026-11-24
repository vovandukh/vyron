import { useSettingsStore } from '../stores/settingsStore'
import { translate } from '@vyron/shared/i18n'

export { translate }

/**
 * t(key, params) — translation by key; tm(msg) — translation of a store message object
 * ({ key, params } or { raw }). Reactive on settings.lang.
 */
export function useI18n() {
  const settings = useSettingsStore()
  const t = (key, params) => translate(settings.lang, key, params)
  const tm = m => (!m ? '' : typeof m === 'string' ? t(m) : m.raw != null ? m.raw : t(m.key, m.params))
  return { t, tm }
}
