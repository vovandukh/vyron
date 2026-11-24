import { ref, onMounted, onBeforeUnmount } from 'vue'

/**
 * Mobile layout: a phone (≤600 px, e.g. the Galaxy Fold cover screen) or any portrait screen up to 900 px
 * (Fold inner screen, tablet in portrait), and near-square screens up to 1000 px (unfolded Fold in landscape).
 * Printer screens 1024×600 / 800×480 (16:9…5:3) don't match. The same query is used in PrintPreview3D (model shifted up).
 */
export const MOBILE_QUERY = '(max-width: 600px), (max-width: 900px) and (orientation: portrait), (max-width: 1000px) and (max-aspect-ratio: 5/4)'

export function useMobile() {
  const mq = typeof matchMedia === 'function' ? matchMedia(MOBILE_QUERY) : null
  const mobile = ref(!!(mq && mq.matches))
  const on = e => { mobile.value = e.matches }
  onMounted(() => mq?.addEventListener?.('change', on))
  onBeforeUnmount(() => mq?.removeEventListener?.('change', on))
  return mobile
}
