import { useUiStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'

/** Confirmations via ConfirmModal instead of the native confirm()/prompt(). */
export function useConfirm() {
  const ui = useUiStore()
  const settings = useSettingsStore()

  const toMsg = m => (typeof m === 'string' ? { key: m } : m)

  /** System action: asks only if "confirm system actions" is on, or with force. */
  const ask = (message, force = false) =>
    force || settings.cSys ? ui.openDialog({ message: toMsg(message) }) : Promise.resolve(true)

  /** Always asks. */
  const confirm = (message, labels = {}) => ui.openDialog({ message: toMsg(message), ...labels })

  /** Input field: a string, or null when cancelled. */
  const prompt = message => ui.openDialog({ message: toMsg(message), input: true })

  return { ask, confirm, prompt }
}
