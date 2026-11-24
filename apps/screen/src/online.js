// A page loads its data as soon as Moonraker is reachable: right away if the link is up, and again
// when it appears (after a quiet update the page opens before the connection).
import { onMounted, watch } from 'vue'
import { usePrinter } from './store'

export function whenOnline(fn) {
  const p = usePrinter()
  onMounted(() => { if (p.link === 'open') fn() })
  watch(() => p.link, l => { if (l === 'open') fn() })
}
