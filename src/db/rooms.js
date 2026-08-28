/**
 * The database — one per project, opened once.
 *
 * There used to be a directory plus one private room per client here, with a
 * reload between them so every database existed before the identity door.
 * Both reasons died: genosdb 0.27.1 gives each instance its own Security
 * Manager, and the single-graph model needs no second instance at all. What
 * remains is the engine's recommended shape — one `gdb` per application —
 * with isolation carried by node ownership and field encryption, both
 * enforced by every peer on every sync path.
 */
import { loadGdb } from "./engine.js"
import { GOVERNANCE_RULES, ROOM, smOptions } from "./config.js"

/** @type {Promise<object>|null} The instance, cached as a promise so two concurrent callers await one boot. */
let instance = null

/**
 * Open (or reuse) the application database.
 *
 * @returns {Promise<object>} The GenosDB instance.
 */
export const openDb = () =>
  (instance ??= loadGdb().then((gdb) =>
    gdb(ROOM, { rtc: true, sm: { ...smOptions, governanceRules: GOVERNANCE_RULES } })
  ))
