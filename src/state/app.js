/**
 * Session and view state.
 *
 * Deliberately small: the DOM is the state for anything a subscription paints.
 * What lives here is only what more than one view needs to agree on.
 */

export const state = {
  /** @type {object|null} The database instance. */
  db: null,
  /** @type {string|null} The active Ethereum address. */
  address: null,
  /** @type {string} The live role, watched on `user:<address>`. */
  role: "guest",
  /** @type {'creator'|'client'|'admin'} The view on screen. */
  side: "creator",
  /** @type {string|null} The open space's slug, or null in the catalogue. */
  space: null,
  /** @type {string|null} The selected item in the current view. */
  selected: null,
}

/** Reset everything a logout invalidates. */
export const clearSession = () => {
  state.address = null
  state.role = "guest"
  state.space = null
  state.selected = null
}
