<script setup>
// Config backups on the printer screen: how many and how much space, one action — "Delete all but the last 3".
// Viewing, diff and restore live in Vyron Web (a config can't be read on 480×320).
import { computed, ref } from 'vue'
import { whenOnline } from '../online'
import { usePrinter } from '../store'
import { t, lang } from '../i18n'
import { BACKUP_KEEP, BACKUP_NAG_AT, fetchBackups } from '@vyron/shared/moonraker/backups'
import Row from '../components/Row.vue'
import ConfirmSheet from '../components/ConfirmSheet.vue'

const p = usePrinter()
const list = ref(null)
const ask = ref(false)
const busy = ref(false)
const note = ref('')

const load = async () => { try { list.value = await fetchBackups(p.call) } catch { list.value = [] } }
whenOnline(load)

const size = computed(() => {
  const n = (list.value || []).reduce((s, b) => s + (b.size || 0), 0)
  return n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'
})
const newest = computed(() => {
  const b = list.value && list.value[0]
  return b && b.at ? new Date(b.at).toLocaleString(lang.value === 'uk' ? 'uk-UA' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
})
const extra = computed(() => Math.max(0, (list.value || []).length - BACKUP_KEEP))

async function clean() {
  ask.value = false
  busy.value = true
  const old = (list.value || []).slice(BACKUP_KEEP)
  let done = 0
  for (const b of old) {
    try { await p.call('server.files.delete_file', { path: 'config/' + b.path }); done++ } catch { /* try the rest anyway */ }
  }
  busy.value = false
  note.value = t('bak.deleted', { n: done })
  await load()
}
</script>

<template>
  <div class="page set">
    <h1>{{ t('bak.title') }}</h1>
    <div class="grp">
      <Row :label="t('scr.bakCount')" :value="list ? String(list.length) : '…'" />
      <Row :label="t('scr.bakSize')" :value="list ? size : '…'" />
      <Row :label="t('scr.bakNewest')" :value="list ? newest : '…'" />
    </div>
    <div class="grp">
      <Row icon="trash" danger :label="t('scr.bakClean', { k: BACKUP_KEEP })" :value="extra ? String(extra) : ''"
           :disabled="!extra || busy" @tap="ask = true" />
    </div>
    <p class="grp-f">{{ note || (list && list.length >= BACKUP_NAG_AT ? t('bak.nagHint') + ' ' : '') + t('scr.bakHint') }}</p>
    <ConfirmSheet v-if="ask" :text="t('scr.bakSure', { n: extra, k: BACKUP_KEEP })" :ok="t('bak.yes')" :cancel="t('common.cancel')"
                  @ok="clean" @cancel="ask = false" />
  </div>
</template>
