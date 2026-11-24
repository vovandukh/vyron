import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

export const useUiStore = defineStore('ui', () => {
  /** main | tools | console | mesh | hist | eng | cfg | set | upd | net */
  const view = ref('main')
  /** 'nozzle' | 'bed' | null — the temperature dialog */
  const tempModal = ref(null)
  /** Active confirmation dialog: { message, input, resolve } */
  const dialog = shallowRef(null)

  /** Control centre (connection, demo, menu): null or { x } — centre of the button it was opened from (for transform-origin). */
  const cc = ref(null)
  function toggleCc(el) {
    if (cc.value) { cc.value = null; return }
    const r = el?.getBoundingClientRect?.()
    cc.value = { x: r ? r.left + r.width / 2 : innerWidth - 50, y: r ? r.bottom : 60 }
  }
  const closeCc = () => { cc.value = null }

  /** Engineering menu section: 'sys' (diagnostics and system) | 'cfg' (configuration). Lives for the session. */
  const engSection = ref('sys')
  /** Expanded MCU card in Hardware (main board by default); null — all collapsed */
  const hwOpen = ref('mcu')

  /**
   * "Home" (click on the logo): the Control tab + close everything open — control centre, temperature dialog,
   * while Control's own popovers (telemetry slider, toolhead menu) listen to homeTick.
   */
  const homeTick = ref(0)
  /** The Klipper state card (shutdown / config error) hidden with "Hide"; comes back on a click on the status pill or a new error. */
  const klippyHidden = ref(false)
  function goHome() {
    go('main')
    tempModal.value = null
    homeTick.value++
  }

  function go(v) {
    // The old Config tab address is now a section of the Engineering menu
    if (v === 'cfg') { engSection.value = 'cfg'; v = 'eng' }
    view.value = v
    cc.value = null
  }

  /**
   * Opens ConfirmModal. Promise → true/false, or a string/null in input mode.
   * okKey / cancelKey — custom button labels (e.g. "Cancel print" / "Keep printing" instead of "Yes" / "Cancel").
   */
  function openDialog({ message, input = false, okKey = null, cancelKey = null }) {
    if (dialog.value) dialog.value.resolve(dialog.value.input ? null : false)
    return new Promise(resolve => { dialog.value = { message, input, okKey, cancelKey, resolve } })
  }

  function closeDialog(result) {
    const d = dialog.value
    dialog.value = null
    d?.resolve(result)
  }

  return { klippyHidden, view, tempModal, dialog, cc, toggleCc, closeCc, engSection, hwOpen, homeTick, goHome, go, openDialog, closeDialog }
})
