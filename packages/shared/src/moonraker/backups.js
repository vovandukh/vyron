// Config backups: what counts as a backup, where it came from (Klipper / Vyron editor) and when.
//
// After SAVE_CONFIG Klipper drops printer-YYYYMMDD_HHMMSS.cfg into the config root; Vyron Core moves them
// to backups/klipper/. Before saving, the Vyron editor puts a copy in backups/<file>_YYYYMMDD-HHMMSS.cfg
// (the file path with "_" instead of "/").

const KLIPPER = /^(?:backups\/klipper\/)?printer-(\d{8})_(\d{6})\.cfg$/
const EDITOR = /^backups\/(?!klipper\/)(.+)_(\d{8})-(\d{6})\.cfg$/

/** Number of backups from which the "time to clean up" banner appears. */
export const BACKUP_NAG_AT = 10
/** How many newest backups the cleanup dialog leaves unchecked by default. */
export const BACKUP_KEEP = 3

const stamp = (d, t) => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)).getTime()

/** Is this a backup (such files are hidden from the regular config list). */
export const isBackup = path => String(path).startsWith('backups/') || KLIPPER.test(String(path))

/**
 * Backup entry for the list: { path, src: 'klipper'|'editor'|'other', of: source file, at: ms, size }.
 * f — a server.files.list entry ({ path, modified (s), size }).
 */
export function backupInfo(f) {
  const p = String(f.path)
  let m = KLIPPER.exec(p)
  if (m) return { path: p, src: 'klipper', of: 'printer.cfg', at: stamp(m[1], m[2]), size: f.size || 0 }
  m = EDITOR.exec(p)
  if (m) return { path: p, src: 'editor', of: m[1], at: stamp(m[2], m[3]), size: f.size || 0 }
  return { path: p, src: 'other', of: p.replace(/^backups\//, ''), at: (f.modified || 0) * 1000, size: f.size || 0 }
}

/**
 * The file a backup restores into (from the regular config files), or null if not found.
 * The editor writes the path with "_" and no extension, so we look for the file producing the same name.
 */
export function backupTarget(b, files) {
  const paths = files.map(f => f.path)
  if (b.src === 'klipper') return paths.includes('printer.cfg') ? 'printer.cfg' : null
  if (b.src !== 'editor') return null
  return paths.find(p => p.replace(/\//g, '_').replace(/\.(cfg|conf)$/i, '') === b.of) || null
}

/** Backups from the config file list, newest first. */
export const listBackups = files => files.filter(f => isBackup(f.path)).map(backupInfo).sort((a, b) => b.at - a.at)

/** Backups via JSON-RPC (Vyron Screen): call — printer.call / client.call. */
export async function fetchBackups(call) {
  const r = await call('server.files.list', { root: 'config' })
  return listBackups(Array.isArray(r) ? r : [])
}

/**
 * Whether to show the banner. snoozedAt — backup count at "Remind me later" (or 0):
 * after that the banner stays quiet until BACKUP_NAG_AT more backups appear.
 */
export const backupNag = (count, snoozedAt = 0) => count >= BACKUP_NAG_AT && count >= (snoozedAt || 0) + BACKUP_NAG_AT
