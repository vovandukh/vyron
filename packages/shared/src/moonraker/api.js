// Moonraker HTTP API: config files, G-code, thumbnails.
import { httpBase } from './client'

export const encPath = p => String(p).split('/').map(encodeURIComponent).join('/')
const url = (host, path) => httpBase(host) + path

async function ok(r) {
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r
}

// Moonraker serves files with Last-Modified only (no Cache-Control), so browsers guess freshness (hours for old files)
// and may return a stale cached copy. Configs change at runtime (save, backup restore, SAVE_CONFIG),
// so they are always read bypassing the cache.
const FRESH = { cache: 'no-store' }

export async function listConfigFiles(host) {
  const r = await (await ok(await fetch(url(host, '/server/files/list?root=config'), FRESH))).json()
  return (r.result || []).filter(f => /\.(cfg|conf)$/i.test(f.path)).sort((a, b) => a.path.localeCompare(b.path))
}

export async function readConfigFile(host, path) {
  return (await ok(await fetch(url(host, '/server/files/config/' + encPath(path)), FRESH))).text()
}

export async function uploadConfigFile(host, path, text) {
  const fd = new FormData(), j = path.lastIndexOf('/')
  fd.append('root', 'config')
  if (j > 0) fd.append('path', path.slice(0, j))
  fd.append('file', new Blob([text], { type: 'text/plain' }), path.slice(j + 1))
  await ok(await fetch(url(host, '/server/files/upload'), { method: 'POST', body: fd }))
}

/** Deletes a file from config (backup cleanup). */
export async function deleteConfigFile(host, path) {
  await ok(await fetch(url(host, '/server/files/config/' + encPath(path)), { method: 'DELETE' }))
}

/** Saves a file after copying the previous version to backups/. */
export async function saveConfigWithBackup(host, path, text, original, isNew) {
  if (!isNew) {
    const d = new Date(), z = n => String(n).padStart(2, '0')
    const ts = '' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds())
    await uploadConfigFile(host, 'backups/' + path.replace(/\//g, '_').replace(/\.(cfg|conf)$/i, '') + '_' + ts + '.cfg', original)
  }
  await uploadConfigFile(host, path, text)
}

export async function fetchGcode(host, filename) {
  return (await ok(await fetch(url(host, '/server/files/gcodes/' + encPath(filename))))).text()
}

/**
 * Thumbnail URL of a G-code file (thumbnail paths in metadata are relative to the file's folder).
 * minWidth: the smallest thumbnail at least minWidth wide (for lists), otherwise the largest one.
 */
export function thumbUrl(host, filename, metadata, minWidth = 0) {
  const th = ((metadata && metadata.thumbnails) || []).filter(t => t && t.relative_path)
  if (!th.length || !host) return null
  const sorted = th.slice().sort((a, b) => a.width - b.width)
  const b = minWidth ? sorted.find(t => t.width >= minWidth) || sorted[sorted.length - 1] : sorted[sorted.length - 1]
  const f = String(filename || ''), dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : ''
  return url(host, '/server/files/gcodes/' + encPath(dir + b.relative_path))
}

/** URL of the largest thumbnail of a history job, or null. */
export const jobThumbUrl = (host, job) => thumbUrl(host, job.filename, job.metadata)

const GCODE_EXT = /\.(gcode|g|gco|gc)$/i

/** G-code files on the printer (newest first). */
export async function listGcodeFiles(host) {
  const r = await (await ok(await fetch(url(host, '/server/files/list?root=gcodes')))).json()
  return (r.result || []).filter(f => GCODE_EXT.test(f.path)).sort((a, b) => (b.modified || 0) - (a.modified || 0))
}

/** File metadata (slicer, time, layer height, thumbnails…). */
export async function fileMetadata(host, filename) {
  const r = await (await ok(await fetch(url(host, '/server/files/metadata?filename=' + encodeURIComponent(filename))))).json()
  return r.result || {}
}

/**
 * Starts printing a file from the printer. The name goes into a query parameter,
 * so it is encoded whole (encodeURIComponent), including "/" for files in subfolders.
 */
export async function startPrintFile(host, filename) {
  await ok(await fetch(url(host, '/printer/print/start?filename=' + encodeURIComponent(filename)), { method: 'POST' }))
}

/**
 * Deletes a G-code file from the printer. Path segments are encoded separately so files
 * in subfolders (calibration/x.gcode) are deleted correctly too.
 */
export async function deleteGcodeFile(host, filename) {
  await ok(await fetch(url(host, '/server/files/gcodes/' + encPath(filename)), { method: 'DELETE' }))
}
