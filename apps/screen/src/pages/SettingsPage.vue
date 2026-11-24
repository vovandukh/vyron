<script setup>
// Settings root (like iOS Settings): groups of rows with coloured icons and current values.
import { computed, onMounted, ref } from 'vue'
import { usePrinter } from '../store'
import { t, lang, LANGS } from '../i18n'
import { wlanSummary } from '../net'
import { fetchBackups, BACKUP_NAG_AT } from '@vyron/shared/moonraker/backups'
import Row from '../components/Row.vue'

const p = usePrinter()
const net = ref('')
// Config backups: the row appears when there are any; from BACKUP_NAG_AT — an orange counter (time to clean up)
const baks = ref(0)
onMounted(async () => {
  p.refreshUpdates(false)
  fetchBackups(p.call).then(l => { baks.value = l.length }).catch(() => {})
  try { net.value = wlanSummary((await p.call('machine.system_info')).system_info) } catch { net.value = '' }
})
const langName = computed(() => (LANGS.find(l => l.id === lang.value) || {}).name)
const theme = computed(() => t('design.p.' + p.design.preset))
/** Number of available updates (from Moonraker's local status, no git calls) */
const updValue = computed(() => {
  const n = Object.entries(p.updates.info || {}).filter(([k, v]) => (k === 'system' ? v.package_count > 0 : (v.commits_behind || []).length > 0 || (v.remote_version && v.version && v.remote_version !== v.version))).length
  return n ? String(n) : ''
})
</script>

<template>
  <div class="page set">
    <h1>{{ t('scr.page.settings') }}</h1>
    <div class="grp">
      <Row icon="wifi" :label="t('scr.page.wifi')" :value="net" chevron @tap="p.go('wifi')" />
    </div>
    <div class="grp">
      <Row icon="palette" :label="t('scr.page.theme')" :value="theme" chevron @tap="p.go('theme')" />
      <Row icon="globe" :label="t('scr.page.language')" :value="langName" chevron @tap="p.go('language')" />
    </div>
    <div class="grp">
      <Row icon="refresh" :label="t('scr.page.updates')" :value="updValue" chevron @tap="p.go('updates')" />
      <Row icon="info" :label="t('scr.page.about')" chevron @tap="p.go('about')" />
      <Row icon="power" :label="t('scr.page.system')" chevron @tap="p.go('system')" />
      <Row v-if="baks" icon="files" :label="t('bak.title')" :value="baks >= BACKUP_NAG_AT ? '' : String(baks)" chevron @tap="p.go('backups')">
        <span v-if="baks >= BACKUP_NAG_AT" class="nag">{{ baks }}</span>
      </Row>
    </div>
  </div>
</template>

<style scoped>
.nag{flex:none;min-width:2.4rem;padding:.2rem .8rem;border-radius:999px;background:var(--amber);color:#000;font-size:1.25rem;font-weight:700;text-align:center}
</style>
