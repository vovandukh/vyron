// Reading the Moonraker database without errors in its log.
// On a printer where Vyron hasn't saved anything yet the namespace doesn't exist, and every get_item
// writes "Key … not found" to moonraker.log. Polling every few seconds would flood the log,
// so we first ask for the namespace list (server.database.list — no errors) and read the key only
// once the namespace exists. Confirmed namespaces are remembered so the list isn't fetched every time.

const known = new Set()

/**
 * @param {(method: string, params?: object) => Promise<any>} call
 * @returns {Promise<any>} the key's value or undefined if missing
 */
export async function dbGet(call, namespace, key) {
  if (!known.has(namespace)) {
    const r = await call('server.database.list').catch(() => null)
    const list = (r && r.namespaces) || []
    if (!list.includes(namespace)) return undefined
    known.add(namespace)
  }
  try {
    const r = await call('server.database.get_item', { namespace, key })
    return r ? r.value : undefined
  } catch {
    // Key is gone (or the namespace was deleted) — check the list again next time
    known.delete(namespace)
    return undefined
  }
}

/** After our own write the namespace surely exists */
export function dbKnown(namespace) { known.add(namespace) }
