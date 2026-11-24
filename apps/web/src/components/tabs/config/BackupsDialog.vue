<script setup>
// Config backups: a list with checkboxes (newest first, the last BACKUP_KEEP unchecked) and a backup viewer.
// The viewer shows what would change in the file if the backup is restored (current → backup), or the whole backup.
// Deleting and restoring need a second press inside the dialog itself (no nested dialog).
// Restoring doesn't restart Klipper by itself: the current file version goes to backups/ first, restart is a separate button.
import { computed, ref, shallowRef, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { BACKUP_KEEP, backupTarget } from '@vyron/shared/moonraker/backups'
import { deleteConfigFile, readConfigFile, saveConfigWithBackup } from '@vyron/shared/moonraker/api'
import { diffLines, diffHunks, diffStat } from '@vyron/shared/diff'
import { usePrinterStore } from '../../../stores/printerStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useI18n } from '../../../composables/useI18n'

const props = defineProps({
  open: Boolean,
  backups: { type: Array, default: () => [] },
  files: { type: Array, default: () => [] },
  host: { type: String, default: '' }
})
const emit = defineEmits(['close', 'changed', 'restored'])
const { t } = useI18n()
const settings = useSettingsStore()
const printer = usePrinterStore()

const sel = ref(new Set())
const sure = ref(null) // null | 'sel' | 'all' | 'restore'
const busy = ref(null) // { i, n } while deleting
const err = ref('')
const closeBtn = ref(null)

function reset() {
  sel.value = new Set(props.backups.slice(BACKUP_KEEP).map(b => b.path))
  sure.value = null; err.value = ''; view.value = null
}
watch(() => props.open, o => { if (o) { reset(); nextTick(() => closeBtn.value?.focus()) } })
// The list changed (deleted, Klipper added a new one) — drop vanished items from the selection
watch(() => props.backups, list => {
  const have = new Set(list.map(b => b.path))
  sel.value = new Set([...sel.value].filter(p => have.has(p)))
})

const chosen = computed(() => props.backups.filter(b => sel.value.has(b.path)))
const allOn = computed(() => props.backups.length > 0 && chosen.value.length === props.backups.length)
const kb = n => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
const selSize = computed(() => kb(chosen.value.reduce((s, b) => s + (b.size || 0), 0)))
const fmt = computed(() => new Intl.DateTimeFormat(settings.lang === 'uk' ? 'uk-UA' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))

function toggle(p) {
  const s = new Set(sel.value)
  s.has(p) ? s.delete(p) : s.add(p)
  sel.value = s; sure.value = null
}
function toggleAll() {
  sel.value = allOn.value ? new Set() : new Set(props.backups.map(b => b.path))
  sure.value = null
}

async function remove(which) {
  const list = which === 'all' ? props.backups.slice() : chosen.value
  if (!list.length || busy.value) return
  if (sure.value !== which) { sure.value = which; return }
  sure.value = null; err.value = ''
  let done = 0, last = ''
  for (const [i, b] of list.entries()) {
    busy.value = { i: i + 1, n: list.length }
    try { await deleteConfigFile(props.host, b.path); done++ } catch (e) { last = e.message }
  }
  busy.value = null
  if (last) err.value = t('bak.delError', { msg: last })
  emit('changed', done)
}

// ---------- backup viewer ----------
/** { b, target, text, cur, mode: 'diff'|'full', state: 'load'|'ready'|'saving'|'restored'|'error' } */
const view = shallowRef(null)
const patch = v => { view.value = { ...view.value, ...v } }
const ops = computed(() => (view.value && view.value.text != null ? diffLines(view.value.cur ?? '', view.value.text) : []))
const hunks = computed(() => diffHunks(ops.value, 3))
const stat = computed(() => diffStat(ops.value))
const fullLines = computed(() => (view.value?.text ?? '').replace(/\r\n/g, '\n').split('\n'))

async function show(b) {
  if (busy.value) return
  const target = backupTarget(b, props.files)
  sure.value = null; err.value = ''
  view.value = { b, target, text: null, cur: null, mode: target ? 'diff' : 'full', state: 'load' }
  try {
    const [text, cur] = await Promise.all([readConfigFile(props.host, b.path), target ? readConfigFile(props.host, target) : null])
    if (view.value?.b !== b) return
    patch({ text, cur, state: 'ready' })
  } catch (e) {
    if (view.value?.b === b) { patch({ state: 'error' }); err.value = t('bak.openError', { msg: e.message }) }
  }
}
const back = () => { if (view.value?.state !== 'saving') { view.value = null; sure.value = null; err.value = '' } }

async function restore() {
  const v = view.value
  if (!v || !v.target || v.state !== 'ready') return
  if (sure.value !== 'restore') { sure.value = 'restore'; return }
  sure.value = null; err.value = ''
  patch({ state: 'saving' })
  try {
    // Current version → backups/ (as when saving in the editor), then the backup becomes the working file
    await saveConfigWithBackup(props.host, v.target, v.text, v.cur, false)
    patch({ state: 'restored', cur: v.text })
    emit('restored', v.target)
  } catch (e) {
    patch({ state: 'ready' })
    err.value = t('bak.restoreError', { msg: e.message })
  }
}
function restartKlipper() {
  printer.call('printer.restart', {}).catch(() => {})
  emit('close')
}

const close = () => { if (!busy.value && view.value?.state !== 'saving') emit('close') }
const onKey = e => {
  if (e.key !== 'Escape' || !props.open) return
  e.stopPropagation()
  if (sure.value) sure.value = null
  else if (view.value) back()
  else close()
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-back" @click.self="close">
        <div class="modal bak" :class="{ wide: view }" role="dialog" aria-modal="true" aria-labelledby="bak-t">
          <!-- ===== Single backup view ===== -->
          <template v-if="view">
            <header>
              <button class="x" :aria-label="t('bak.back')" :title="t('bak.back')" @click="back">
                <svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
              </button>
              <div>
                <h2 id="bak-t">{{ view.b.at ? fmt.format(view.b.at) : view.b.path }} <span class="src" :class="view.b.src">{{ t('bak.src.' + view.b.src) }}</span></h2>
                <p v-if="view.target">{{ t('bak.into', { f: view.target }) }}</p>
                <p v-else>{{ t('bak.noTarget') }}</p>
              </div>
              <button class="x" :aria-label="t('bak.close')" :disabled="view.state === 'saving'" @click="close">
                <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            </header>

            <div v-if="view.target" class="seg" role="tablist">
              <button role="tab" :aria-selected="String(view.mode === 'diff')" :class="{ on: view.mode === 'diff' }" @click="patch({ mode: 'diff' })">
                {{ t('bak.changes') }}
                <template v-if="view.state !== 'load'"><b class="add">+{{ stat.add }}</b> <b class="del">−{{ stat.del }}</b></template>
              </button>
              <button role="tab" :aria-selected="String(view.mode === 'full')" :class="{ on: view.mode === 'full' }" @click="patch({ mode: 'full' })">{{ t('bak.full') }}</button>
            </div>

            <div class="code" :class="view.mode">
              <p v-if="view.state === 'load'" class="empty">{{ t('bak.loading') }}</p>
              <template v-else-if="view.text != null && view.mode === 'diff'">
                <p v-if="!hunks.length" class="empty">{{ t('bak.same', { f: view.target }) }}</p>
                <template v-else>
                  <p class="legend"><span class="del">− {{ t('bak.legendNow', { f: view.target }) }}</span><span class="add">+ {{ t('bak.legendAfter') }}</span></p>
                  <div v-for="(o, i) in hunks" :key="i" class="ln" :class="o.t === '+' ? 'add' : o.t === '-' ? 'del' : o.t === '…' ? 'gap' : ''">
                    <template v-if="o.t === '…'"><span class="n"></span><span class="s">{{ t('bak.hidden', { n: o.n }) }}</span></template>
                    <template v-else><span class="n">{{ o.t === '-' ? o.a : o.b }}</span><span class="m">{{ o.t === ' ' ? '' : o.t === '-' ? '−' : '+' }}</span><span class="s">{{ o.s }}</span></template>
                  </div>
                </template>
              </template>
              <template v-else-if="view.text != null">
                <div v-for="(s, i) in fullLines" :key="i" class="ln"><span class="n">{{ i + 1 }}</span><span class="s">{{ s }}</span></div>
              </template>
            </div>

            <p v-if="err" class="st bad">{{ err }}</p>
            <p v-else-if="view.state === 'restored'" class="st ok">{{ t('bak.restored', { f: view.target }) }}</p>
            <p v-else-if="sure === 'restore'" class="st warn">{{ t('bak.sureRestore', { f: view.target }) }}</p>
            <p v-else-if="view.state === 'saving'" class="st">{{ t('bak.restoring') }}</p>

            <div class="acts">
              <button @click="back">{{ t('bak.back') }}</button>
              <button v-if="view.state === 'restored'" class="primary" :disabled="printer.isPrinting" :title="printer.isPrinting ? t('bak.noRestartPrinting') : ''" @click="restartKlipper">{{ t('bak.restart') }}</button>
              <button v-else-if="view.target" class="primary" :class="{ danger: sure === 'restore' }"
                :disabled="view.state !== 'ready' || !hunks.length" :title="view.state === 'ready' && !hunks.length ? t('bak.same', { f: view.target }) : ''" @click="restore">
                {{ sure === 'restore' ? t('bak.yesRestore') : t('bak.restore') }}
              </button>
            </div>
          </template>

          <!-- ===== Backup list ===== -->
          <template v-else>
            <header>
              <div>
                <h2 id="bak-t">{{ t('bak.title') }}</h2>
                <p>{{ t('bak.sub', { k: BACKUP_KEEP }) }}</p>
              </div>
              <button ref="closeBtn" class="x" :aria-label="t('bak.close')" :disabled="!!busy" @click="close">
                <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            </header>

            <p v-if="!backups.length" class="empty">{{ t('bak.none') }}</p>
            <template v-else>
              <div class="row head">
                <label class="ck"><input type="checkbox" :checked="allOn" :indeterminate="chosen.length > 0 && !allOn" :disabled="!!busy" @change="toggleAll"></label>
                <span>{{ t('bak.all') }}</span>
                <small>{{ t('bak.selected', { n: chosen.length, total: backups.length, size: selSize }) }}</small>
              </div>
              <div class="list">
                <div v-for="b in backups" :key="b.path" class="row" :class="{ on: sel.has(b.path) }">
                  <label class="ck" :title="b.path"><input type="checkbox" :checked="sel.has(b.path)" :disabled="!!busy" @change="toggle(b.path)"></label>
                  <button class="open" :title="t('bak.view')" :disabled="!!busy" @click="show(b)">
                    <span class="when">{{ b.at ? fmt.format(b.at) : '–' }}</span>
                    <span class="src" :class="b.src">{{ t('bak.src.' + b.src) }}</span>
                    <span class="of">{{ b.of }}</span>
                    <small>{{ kb(b.size) }}</small>
                    <svg class="chev" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
                  </button>
                </div>
              </div>
            </template>

            <p v-if="busy" class="st">{{ t('bak.deleting', busy) }}</p>
            <p v-else-if="err" class="st bad">{{ err }}</p>
            <p v-else-if="sure" class="st warn">{{ t('bak.sure', { n: sure === 'all' ? backups.length : chosen.length }) }}</p>

            <div v-if="backups.length" class="acts">
              <button :class="{ danger: sure === 'all' }" :disabled="!!busy" @click="remove('all')">{{ sure === 'all' ? t('bak.yes') : t('bak.delAll') }}</button>
              <button class="primary" :class="{ danger: sure === 'sel' }" :disabled="!chosen.length || !!busy" @click="remove('sel')">
                {{ sure === 'sel' ? t('bak.yes') : t('bak.delSel') + (chosen.length ? ' (' + chosen.length + ')' : '') }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal.bak{width:min(600px,94vw);max-height:min(720px,90vh);grid-template-rows:auto auto minmax(0,1fr) auto auto;gap:10px}
.modal.bak.wide{width:min(980px,96vw);height:min(820px,92vh);max-height:none}
header{display:flex;gap:8px;align-items:flex-start}
header div{flex:1;min-width:0}
h2{margin:0;font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
header p{margin:4px 0 0;color:var(--dim);font-size:12px;line-height:1.45}
.modal .x{flex:none;width:44px;padding:0;display:grid;place-items:center;background:transparent;border-color:transparent}
.x svg,.chev{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.list{overflow:auto;display:flex;flex-direction:column;gap:2px;min-height:0;margin:0 -6px;padding:0 6px}
.row{display:flex;align-items:center;min-height:44px;border-radius:var(--r);transition:background-color var(--t-fast) var(--ease-out)}
.row:hover{background:rgba(255,255,255,.04)}
.row.on{background:rgba(var(--accent-rgb),.08)}
.row.head{gap:0;border-bottom:1px solid var(--hair);border-radius:0;font-size:13px}
.row.head small{margin-left:auto;padding-right:10px;color:var(--dim);font-size:11.5px}
.ck{flex:none;width:44px;height:44px;display:grid;place-items:center;cursor:pointer}
.ck input{width:18px;height:18px;margin:0;accent-color:var(--coral);cursor:pointer}
.modal .open{flex:1;min-width:0;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto auto;align-items:center;gap:10px;text-align:left;
  background:transparent;border-color:transparent;padding:0 8px 0 0;min-height:44px;font-size:13px}
.modal .open:hover:not(:disabled){background:transparent}
.modal .open:active:not(:disabled){transform:none}
.chev{color:var(--dim);width:14px;height:14px}
.when{font-variant-numeric:tabular-nums;white-space:nowrap}
.src{font-size:11px;font-weight:400;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.07);color:var(--dim);white-space:nowrap}
.src.klipper{background:rgba(var(--accent-rgb),.14);color:var(--coral)}
.of{color:var(--dim);font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.open small{color:var(--dim);font-size:11.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
.empty{margin:18px 0;text-align:center;color:var(--dim);font-size:13px}
.st{margin:0;font-size:12.5px;color:var(--dim)}
.st.warn{color:var(--coral)}
.st.bad{color:var(--danger-ink)}
.st.ok{color:var(--ok-ink)}
.acts{display:grid;grid-template-columns:1fr 1.3fr;gap:8px}
.modal button.danger,.modal button.primary.danger{background:var(--red);border-color:transparent;color:#fff;font-weight:600}

/* Viewer */
.seg{display:inline-flex;gap:4px;padding:3px;border-radius:999px;background:rgba(255,255,255,.05);justify-self:start}
.modal .seg button{min-height:36px;padding:6px 14px;border-radius:999px;background:transparent;border-color:transparent;color:var(--dim);font-size:12.5px}
.modal .seg button.on{background:var(--surface-hi);color:var(--ink)}
.seg b{font-weight:600;font-variant-numeric:tabular-nums;margin-left:4px}
.add{color:var(--ok-ink)}
.del{color:var(--danger-ink)}
.code{overflow:auto;min-height:0;border-radius:var(--r);background:rgba(0,0,0,.35);border:1px solid var(--hair);
  font-family:var(--mono);font-size:12px;line-height:1.55;padding:6px 0}
.legend{display:flex;gap:2px 16px;flex-wrap:wrap;margin:0 0 6px;padding:2px 12px 6px;border-bottom:1px solid var(--hair);font-size:11.5px}
.ln{display:grid;grid-template-columns:44px 16px minmax(0,1fr);padding-right:12px}
.full .ln{grid-template-columns:44px minmax(0,1fr)}
.full .ln .s{padding-left:10px}
.ln .n{color:var(--dim);opacity:.6;text-align:right;padding-right:8px;user-select:none;font-variant-numeric:tabular-nums}
.ln .m{user-select:none;text-align:center}
.ln .s{white-space:pre-wrap;word-break:break-word}
.ln.add{background:rgba(var(--green-rgb),.12)}
.ln.add .m,.ln.add .s{color:var(--ok-ink)}
.ln.del{background:rgba(var(--red-rgb),.12)}
.ln.del .m,.ln.del .s{color:var(--danger-ink)}
.ln.gap{grid-template-columns:44px minmax(0,1fr);margin:4px 0;background:rgba(255,255,255,.03);color:var(--dim);font-family:inherit;font-size:11.5px}
.ln.gap .s{padding:3px 10px;font-style:italic}
@media(max-width:520px){
  .modal .open{grid-template-columns:minmax(0,1fr) auto auto;row-gap:2px;padding:6px 6px 6px 0}
  .open .src{grid-column:1;grid-row:2;justify-self:start}
  .open .of{display:none}
  .open small{grid-row:1;grid-column:2}
  .chev{grid-row:1 / 3;grid-column:3}
  .row.head small{font-size:11px}
  .ln,.ln.gap{grid-template-columns:34px 14px minmax(0,1fr)}
  .ln.gap{grid-template-columns:34px minmax(0,1fr)}
  .full .ln{grid-template-columns:34px minmax(0,1fr)}
  .code{font-size:11.5px}
}
</style>
