<script setup>
import { computed, nextTick, ref, shallowRef, onActivated, onDeactivated, onMounted, onBeforeUnmount, watch } from 'vue'
import { holdReveal } from '@vyron/shared/live'
import { usePrinterStore } from '../../stores/printerStore'
import { useConfirm } from '../../composables/useConfirm'
import { useI18n } from '../../composables/useI18n'
import { listConfigFiles, readConfigFile, saveConfigWithBackup } from '@vyron/shared/moonraker/api'
import { isBackup, listBackups, backupNag } from '@vyron/shared/moonraker/backups'
import ConfigEditor from './config/ConfigEditor.vue'
import BackupsDialog from './config/BackupsDialog.vue'

const printer = usePrinterStore()
const { ask, confirm, prompt } = useConfirm()
const { t, tm } = useI18n()

const editor = ref(null)
const files = shallowRef([])
// Backups (backups/ and printer-YYYYMMDD_HHMMSS.cfg not yet moved by Core) — separate from regular files
const backups = shallowRef([])
const bakOpen = ref(false)
// "Remind me later": the backup count at that moment; the banner stays quiet until 10 more are added
const SNOOZE_KEY = 'vyron.bakSnooze'
const snooze = ref((() => { try { return +localStorage.getItem(SNOOZE_KEY) || 0 } catch { return 0 } })())
function setSnooze(n) { snooze.value = n; try { localStorage.setItem(SNOOZE_KEY, String(n)) } catch { /* private mode */ } }
const nag = computed(() => backupNag(backups.value.length, snooze.value))
const later = () => setSnooze(backups.value.length)
function applyList(all) {
  files.value = all.filter(f => !isBackup(f.path))
  backups.value = listBackups(all)
  // Backups were deleted (here or elsewhere) — the "remind me later" count restarts from the new number
  if (backups.value.length < snooze.value) setSnooze(backups.value.length)
}
const filter = ref('')
const path = ref(null)
const orig = ref('')
const text = ref('')
const isNew = ref(false)
const cursor = ref({ line: 1, col: 1 })
// File sections (from the editor) — a dropdown to jump to
const sections = ref([])
const secOpen = ref(false), secQ = ref(''), secIn = ref(null)
const shownSections = computed(() => {
  const q = secQ.value.trim().toLowerCase()
  return q ? sections.value.filter(s => s.name.toLowerCase().includes(q)) : sections.value
})
function toggleSections() {
  secOpen.value = !secOpen.value
  if (secOpen.value) { secQ.value = ''; nextTick(() => secIn.value?.focus()) }
}
function jump(s) { secOpen.value = false; editor.value?.goto(s.from) }
const jumpFirst = () => { if (shownSections.value[0]) jump(shownSections.value[0]) }
const msg = ref(null) // { m: {key,params}, bad }

const dirty = computed(() => text.value !== orig.value)
const shown = computed(() => {
  const q = filter.value.toLowerCase()
  return files.value.filter(f => f.path.toLowerCase().includes(q))
})
const stat = computed(() => t('cfg.stat', { l: cursor.value.line, c: cursor.value.col, n: text.value.split('\n').length }))

const say = (key, params, bad = false) => { msg.value = { m: { key, params }, bad } }

async function loadList() {
  if (!printer.host) { say('cfg.connectToEdit', null, true); return }
  try {
    applyList(await listConfigFiles(printer.host))
    if (!path.value && files.value.some(f => f.path === 'printer.cfg')) open('printer.cfg', true)
  } catch (e) { say('cfg.listError', { msg: e.message }, true) }
}

async function open(p, force) {
  if (!force && dirty.value && !(await confirm('cfg.discard'))) return
  try {
    const txt = await readConfigFile(printer.host, p)
    path.value = p; orig.value = txt; text.value = txt; isNew.value = false
    msg.value = null
    editor.value?.reset()
  } catch (e) { say('cfg.openError', { msg: e.message }, true) }
}

async function save(restart) {
  if (!path.value || !printer.host) { say('cfg.connect', null, true); return }
  if (!dirty.value && !restart) { say('cfg.noChanges'); return }
  if (restart && !(await ask('cfg.confirmSaveRestart'))) return
  try {
    if (dirty.value) {
      const content = text.value
      await saveConfigWithBackup(printer.host, path.value, content, orig.value, isNew.value)
      orig.value = content; isNew.value = false
      loadList()
      say('cfg.saved')
    }
    if (restart) printer.call('printer.restart', {}).catch(() => {})
  } catch (e) { say('cfg.saveError', { msg: e.message }, true) }
}

async function newFile() {
  const n = ((await prompt('cfg.newName')) || '').trim()
  if (!n) return
  if (!/^[\w./-]+\.(cfg|conf)$/i.test(n)) { say('cfg.badName', null, true); return }
  if (dirty.value && !(await confirm('cfg.discard'))) return
  path.value = n; orig.value = ''; text.value = ''; isNew.value = true
  if (!files.value.some(f => f.path === n)) files.value = [...files.value, { path: n }]
  editor.value?.reset()
  editor.value?.focus()
}

// File list — as soon as there's a connection (after a reload the page may open before connecting)
let active = false, offFiles = null, refreshT = 0
// Klipper made a backup (SAVE_CONFIG), Core moved it, someone deleted one — reload the list (debounced: events come in bursts)
const onFiles = e => {
  if (!active || (e.item && e.item.root !== 'config')) return
  clearTimeout(refreshT); refreshT = setTimeout(refreshList, 800)
}
// A backup was restored into a file: if it's open without changes — reload so the editor shows the new version
function onRestored(p) {
  refreshList()
  if (p === path.value && !dirty.value) open(p, true)
}
async function refreshList() {
  if (!printer.host) return
  try { applyList(await listConfigFiles(printer.host)) } catch { /* the next event will retry */ }
}
onActivated(() => {
  active = true
  offFiles = offFiles || printer.on('filelist_changed', onFiles)
  if (!files.value.length) holdReveal(loadList()); else refreshList()
})
onDeactivated(() => { active = false })
onBeforeUnmount(() => { offFiles?.(); clearTimeout(refreshT) })
watch(() => printer.connected, c => { if (c && active && !files.value.length) { msg.value = null; holdReveal(loadList()) } })

const beforeUnload = e => { if (path.value && dirty.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(() => addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <div class="cfgPane">
    <div class="ce">
      <aside class="ceSide">
        <input v-model="filter" type="search" :placeholder="t('cfg.search')" :aria-label="t('cfg.search')">
        <div class="ceList">
          <button v-for="f in shown" :key="f.path" class="cef" :class="{ on: f.path === path }" :title="f.path" @click="open(f.path)">{{ f.path }}</button>
        </div>
        <div class="ceFoot">
          <button @click="newFile">{{ t('cfg.new') }}</button>
          <button v-if="backups.length" class="bakBtn" :title="t('bak.title')" @click="bakOpen = true">
            {{ t('bak.open') }} <span class="cnt">{{ backups.length }}</span>
          </button>
        </div>
      </aside>
      <div class="ceMain">
        <div v-if="nag" class="bakNag" role="status">
          <div class="bnTxt"><b>{{ t('bak.nag', { n: backups.length }) }}</b><span>{{ t('bak.nagHint') }}</span></div>
          <button class="bnLater" @click="later">{{ t('bak.later') }}</button>
          <button class="primary" @click="bakOpen = true">{{ t('bak.clean') }}</button>
        </div>
        <div class="ceBar">
          <b>{{ path || '–' }}</b>
          <span v-if="dirty" class="ceDirty">{{ t('cfg.unsaved') }}</span>
          <span class="sp"></span>
          <!-- Editor tools (CodeMirror): comment, sections, folding, line, search, shortcuts -->
          <div class="tools">
            <button :title="'Ctrl+/'" @click="editor.comment()"><code>#</code> {{ t('ide.comment') }}</button>
            <div class="secW">
              <button :aria-expanded="String(secOpen)" @click="toggleSections">{{ t('ide.sections') }} <span class="cnt">{{ sections.length }}</span> ▾</button>
              <div v-if="secOpen" class="secPop" @keydown.esc="secOpen = false">
                <input ref="secIn" v-model="secQ" :placeholder="t('ide.filter')" :aria-label="t('ide.filter')" @keydown.enter="jumpFirst">
                <div class="secList">
                  <button v-for="s in shownSections" :key="s.from" @click="jump(s)"><span>{{ s.name }}</span><small>{{ s.line }}</small></button>
                  <p v-if="!shownSections.length">{{ t('ide.noSections') }}</p>
                </div>
              </div>
            </div>
            <!-- Secondary tools — compact icons with tooltips, so the bar fits on one row -->
            <button class="ib" :title="t('ide.foldAll')" :aria-label="t('ide.foldAll')" @click="editor.foldAll()">
              <svg viewBox="0 0 16 16"><path d="M4 6l4-3 4 3M4 10l4 3 4-3" transform="rotate(180 8 8)" /></svg>
            </button>
            <button class="ib" :title="t('ide.unfoldAll')" :aria-label="t('ide.unfoldAll')" @click="editor.unfoldAll()">
              <svg viewBox="0 0 16 16"><path d="M4 6l4-3 4 3M4 10l4 3 4-3" /></svg>
            </button>
            <button class="ib" :title="t('ide.goto') + ' (Ctrl+G)'" :aria-label="t('ide.goto')" @click="editor.gotoLine()"><b class="ln">Ln</b></button>
            <button class="ib" :title="t('cfg.find') + ' (Ctrl+F)'" :aria-label="t('cfg.find')" @click="editor.toggleFind()">
              <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 13.5 13.5" /></svg>
            </button>
            <button class="ib keys" :title="t('ide.keysList')" :aria-label="t('ide.keys')">
              <svg viewBox="0 0 16 16"><rect x="1.5" y="4" width="13" height="8.5" rx="1.5" /><path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 10h6" /></svg>
            </button>
          </div>
          <button @click="save(false)">{{ t('common.save') }}</button>
          <button :disabled="printer.isPrinting" @click="save(true)">{{ t('cfg.saveRestart') }}</button>
        </div>
        <ConfigEditor ref="editor" v-model="text" @save="save(false)" @cursor="cursor = $event" @sections="sections = $event" />
        <div class="ceStat">
          <span>{{ stat }}</span>
          <span :class="{ bad: msg && msg.bad }">{{ msg ? tm(msg.m) : '' }}</span>
        </div>
      </div>
    </div>
    <BackupsDialog :open="bakOpen" :backups="backups" :files="files" :host="printer.host || ''" @close="bakOpen = false" @changed="refreshList" @restored="onRestored" />
  </div>
</template>

<style scoped>
/* The Configuration section inside the Engineering menu panel — takes all remaining height */
.cfgPane{display:flex;flex-direction:column;flex:1;min-height:0}
.ce{display:grid;grid-template-columns:220px minmax(0,1fr);gap:14px;flex:1;min-height:0}
.ceSide,.ceMain{display:flex;flex-direction:column;gap:8px;min-height:0}
.ceSide{background:var(--surface);border:1px solid var(--hair);border-radius:var(--r-lg);padding:8px}
/* A flex column with flex:none on buttons: in a height-limited grid/flex, buttons with overflow:hidden
   shrank to ~20px with many files (a real printer) and the text was cut */
.ceList{overflow:auto;display:flex;flex-direction:column;gap:4px;flex:1;min-height:0}
.view .cef{flex:none;text-align:left;padding:8px 12px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent;border-color:transparent}
.view .cef.on{background:rgba(var(--accent-rgb),.12);border-color:rgba(var(--accent-rgb),.4)}
/* Active file: a coral marker on the left springs in; the highlight changes smoothly */
.view .cef{position:relative;transition:background-color var(--t-mid) var(--ease-out),border-color var(--t-mid) var(--ease-out),transform var(--t-spring) var(--spring)}
.view .cef::before{content:'';position:absolute;left:4px;top:50%;width:3px;height:14px;margin-top:-7px;border-radius:2px;background:var(--coral);transform:scaleY(0);transition:transform var(--t-spring) var(--spring)}
.view .cef.on::before{transform:scaleY(1)}
.ceBar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ceBar b{font-weight:500;font-size:13px}
.ceDirty{color:var(--coral);font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(var(--accent-rgb),.12)}
.sp{flex:1}
/* Editor tools: a compact group between the file name and Save */
.tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.tools code{font-family:var(--mono);color:var(--coral);font-weight:700}
.cnt{display:inline-block;min-width:16px;padding:0 5px;border-radius:999px;background:rgba(255,255,255,.08);font-size:10.5px;color:var(--dim)}
.secW{position:relative}
.secPop{position:absolute;top:calc(100% + 6px);left:0;z-index:20;width:280px;display:grid;gap:6px;padding:8px;border-radius:var(--r-lg);
  background:rgba(18,18,20,.97);border:1px solid rgba(255,255,255,.1);box-shadow:0 18px 40px -12px rgba(0,0,0,.8)}
.secPop input{width:100%;box-sizing:border-box;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:var(--r);color:var(--ink);font:inherit;font-size:12.5px;padding:7px 9px}
.secPop input:focus{outline:none;border-color:rgba(var(--accent-rgb),.6)}
.secList{max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:2px}
.view .secList button{flex:none;display:flex;justify-content:space-between;gap:10px;text-align:left;padding:6px 9px;font-size:12px;background:transparent;border-color:transparent;font-family:var(--mono)}
.view .secList button:hover{background:rgba(var(--accent-rgb),.12)}
.secList small{color:var(--dim)}
.secList p{margin:6px 9px;color:var(--dim);font-size:12px}
.keys{cursor:help}
.view .ib{width:34px;padding-left:0;padding-right:0;display:inline-grid;place-items:center}
.ib svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.ln{font-family:var(--mono);font-size:11px;font-weight:700}
.ceFoot{display:flex;gap:6px}
.ceFoot button{flex:1 1 0;min-width:0}
.view .bakBtn{display:flex;align-items:center;justify-content:center;gap:6px;background:transparent;border-color:var(--hair);color:var(--dim);white-space:nowrap}

.bakNag{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:var(--r-lg);
  background:rgba(var(--amber-rgb),.08);border:1px solid rgba(var(--amber-rgb),.3)}
.bnTxt{flex:1 1 260px;display:grid;gap:2px;min-width:0}
.bnTxt b{font-weight:600;font-size:13px;color:var(--warn-ink)}
.bnTxt span{font-size:12px;color:var(--dim);line-height:1.4}
.view .bnLater{background:transparent;border-color:transparent;color:var(--dim)}
.ceStat{display:flex;justify-content:space-between;gap:12px;color:var(--dim);font-size:12px}
.bad{color:var(--red)}
@media(max-width:700px){.ce{grid-template-columns:minmax(0,1fr)}.ceSide{max-height:180px}}
</style>
