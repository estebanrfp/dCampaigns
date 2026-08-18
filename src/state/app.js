/**
 * Session and view state.
 *
 * Deliberately small: the DOM is the state for anything a subscription paints.
 * What lives here is only what more than one view needs to agree on.
 */

export const state = {
  /** @type {object|null} The public directory instance. */
  directory: null,
  /** @type {string|null} The active Ethereum address. */
  address: null,
  /** @type {string} The live role, watched on `user:<address>`. */
  role: "guest",
  /** @type {'creator'|'client'|'admin'} The view on screen. */
  side: "creator",
  /** @type {object|null} The open tenant instance, if any. */
  tenant: null,
  /** @type {string|null} The open tenant's slug. */
  tenantSlug: null,
  /** @type {string|null} The selected item in the current view. */
  selected: null,
  /** @type {Array<{slug: string, password: string, owner: string}>} Rooms this identity can open. */
  keyring: [],
}

/**
 * Reset everything a logout invalidates.
 *
 * The open room is deliberately left alone: it is a transport connection, not a
 * session, and this runs on the very first callback — before anyone has logged
 * in — where clearing it would throw away the room the boot just opened.
 * Leaving a room is an explicit act (`forgetPendingRoom` + restart).
 */
export const clearSession = () => {
  state.address = null
  state.role = "guest"
  state.selected = null
  state.keyring = []
}
