/**
 * Room lifecycle: the public directory, and one private graph per client.
 *
 * The split is the whole data model. Anything a stranger may see lives in the
 * directory; anything belonging to one client lives in that client's room,
 * behind a password no other tenant holds.
 *
 * Roles are per-graph — the Security Manager stores them as `user:<address>`
 * nodes inside the database they were granted in — so a room is not just a
 * transport boundary, it is its own authorization domain. Each one therefore
 * ships the same constitution, and each runs its own governance cycle.
 */
import { gdb } from "genosdb"
import { DIRECTORY_ROOM, GOVERNANCE_RULES, smOptions, tenantRoom } from "./config.js"

/** @type {Map<string, Promise<object>>} Room name → the instance opening it. */
const open = new Map()

/**
 * Open (or reuse) a database, keyed by room name.
 *
 * Instances are cached as promises so two concurrent callers await the same
 * boot instead of racing two connections into the same room.
 *
 * @param {string} name - Room and database name.
 * @param {object} [options] - Extra `gdb` options merged over the defaults.
 * @returns {Promise<object>} The GenosDB instance.
 */
const openRoom = (name, options = {}) => {
  if (!open.has(name)) open.set(name, gdb(name, { rtc: true, ...options }))
  return open.get(name)
}

/**
 * The public graph: identities, roles and the catalogue of client spaces.
 *
 * No password — a newcomer has to be able to reach it before anyone has admitted
 * them anywhere. Nothing confidential is ever written here.
 *
 * @returns {Promise<object>} The directory instance.
 */
export const openDirectory = () =>
  openRoom(DIRECTORY_ROOM, {
    sm: { ...smOptions, governanceRules: GOVERNANCE_RULES },
  })

/**
 * A client's private graph.
 *
 * The owner is a superadmin *of their own room* alongside the platform
 * operator: two roots of trust, so promotions inside the space keep working
 * while the operator is away, and the operator can still arbitrate. Both are
 * local configuration on every peer, never data — an incoming graph cannot
 * change who a peer recognises as an authority.
 *
 * @param {string} slug - The client's stable identifier.
 * @param {string} ownerAddress - The client's Ethereum address.
 * @param {string} password - The room secret; without it the handshake never completes.
 * @returns {Promise<object>} The tenant instance.
 */
export const openTenant = (slug, ownerAddress, password) =>
  openRoom(tenantRoom(slug), {
    password,
    sm: {
      ...smOptions,
      superAdmins: [...smOptions.superAdmins, ownerAddress],
      governanceRules: GOVERNANCE_RULES,
    },
  })

/**
 * Whether a tenant room is already open in this session.
 *
 * @param {string} slug - The client's stable identifier.
 * @returns {boolean}
 */
export const isTenantOpen = (slug) => open.has(tenantRoom(slug))

/*
 * ── Why entering a room reloads the page ──────────────────────────────
 *
 * The Security Manager is a singleton shared by every `gdb` instance on the
 * page, not per-instance state. Verified on this build: log in, then open a
 * second database with `sm` configured, and BOTH instances drop to
 * `getActiveEthAddress() === null` — the new SM initializes and clears the
 * active signer, so even the original instance can no longer sign or encrypt.
 * Open both first and log in afterwards and the single session serves them
 * both, each signing its own writes.
 *
 * So the order is the whole trick: every room must exist before the identity
 * door opens. Which room to open is only known after a session (the keyring is
 * encrypted), so the choice is carried across one reload instead.
 *
 * `sessionStorage` holds the room secret for that hop only: it is scoped to the
 * tab and cleared when it closes. It is not persistence — the durable copy
 * lives encrypted in the graph, readable only by its owner.
 *
 * A passkey-protected identity would not need the hop: the SM silently resumes
 * a WebAuthn session when it initializes. A mnemonic session cannot be resumed
 * without the phrase, so the reload is the honest path for both.
 */

const PENDING_KEY = "dcampaigns.room"

/**
 * The room this tab is entering, if any.
 *
 * @returns {{slug: string, owner: string, password: string}|null}
 */
export const pendingRoom = () => {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null")
  } catch {
    return null
  }
}

/**
 * Enter a room: remember the choice and restart so it is opened before login.
 *
 * @param {{slug: string, owner: string, password: string}} entry
 */
export const enterRoomAndReload = (entry) => {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(entry))
  location.reload()
}

/** Leave the current room — used on logout, and when going back to the directory. */
export const forgetPendingRoom = () => sessionStorage.removeItem(PENDING_KEY)
