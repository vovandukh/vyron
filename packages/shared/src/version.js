// The single Vyron version — from the root package.json. Web, Screen and Core (core/vyron_core/__init__.py)
// share it and are bumped together.
// vyronVersion is what the user sees and may have 4 numbers for micro-fixes (0.3.4.1). npm doesn't accept that,
// so the packages' version field keeps three numbers.
import pkg from '../../../package.json'
import { dbGet } from './moonraker/db.js'

export const VYRON_VERSION = pkg.vyronVersion || pkg.version

/**
 * Vyron Core info: the core writes it to its own Moonraker namespace on start (vyron_core/info).
 * @returns {Promise<{version: string, started: number} | null>} null — core not installed or never started
 */
export async function coreInfo(call) {
  const v = await dbGet(call, 'vyron_core', 'info')
  return v && v.version ? v : null
}
