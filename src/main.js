/**
 * dCampaigns — paid creator campaigns on X, as a distributed application.
 *
 * What to read here, and where:
 *   · openDirectory()                      — the public graph: identities, roles, catalogue
 *   · openTenant(slug, owner, password)    — one isolated room per client
 *   · db.sm.setSecurityStateChangeCallback — the single source of truth for the session
 *   · db.get(`user:<address>`, cb)         — the live role, watched not polled
 *   · db.map(options, cb)                  — one subscription per view, four actions
 *   · db.sm.acls.set / grant               — a submission belongs to whoever made it
 *
 * The boot order below is not arbitrary: everything hangs off `db`, and the
 * session callback fires the moment it is set, so everything it touches must
 * already exist.
 */
import { forgetPendingRoom, openDirectory, openTenant, pendingRoom } from "./db/rooms.js"
import { SUPERADMIN } from "./db/config.js"
import { introduceInRoom, readKeyring } from "./db/model.js"
import { initIdentity } from "./auth/identity.js"
import { initTheme } from "./ui/theme.js"
import { render } from "./ui/views.js"
import { show, toast } from "./ui/feedback.js"
import { clearSession, state } from "./state/app.js"

const $ = (id) => document.getElementById(id)
const el = {
  sessionAddr: $("session-addr"),
  sessionRole: $("session-role"),
  logout: $("logout-btn"),
  presence: $("presence"),
  sides: $("sides"),
}

// 1. The databases, with their constitution — ALL of them, before the door.
//
//    The Security Manager is shared by every instance on the page: opening one
//    after a session has started clears the active signer for all of them. So
//    the tenant room this tab is entering is opened here, ahead of any login.
const directory = await openDirectory()
state.directory = directory

const pending = pendingRoom()
if (pending) {
  try {
    state.tenant = await openTenant(pending.slug, pending.owner, pending.password)
    state.tenantSlug = pending.slug
  } catch {
    forgetPendingRoom()
  }
}

// 2. Theme, before anything paints.
initTheme()

// 3. Every listener. Pure DOM wiring — no data, no session.
el.logout.onclick = async () => {
  await directory.sm.clearSecurity()
  // A logout leaves the room as well. Restarting is what actually closes it,
  // and it puts the next session back at the directory.
  if (pendingRoom()) {
    forgetPendingRoom()
    location.reload()
  }
}

el.sessionAddr.onclick = async () => {
  if (!state.address) return
  await navigator.clipboard.writeText(state.address)
  toast("Address copied", "success")
}

el.sides.onclick = (event) => {
  const side = event.target.closest(".side-btn")?.dataset.side
  if (!side || side === state.side) return
  state.side = side
  render()
}

// 4. Presence, from the room.
const updatePresence = () => {
  const count = Object.keys(directory.room?.getPeers() ?? {}).length
  el.presence.textContent = `${count} ${count === 1 ? "peer" : "peers"}`
}
directory.room?.on("peer:join", updatePresence)
directory.room?.on("peer:leave", updatePresence)
updatePresence()

/** @type {Function|null} Teardown for the live role subscription. */
let unwatchRole = null

/**
 * Watch the caller's own user node.
 *
 * The role is not read once at login: governance can promote or demote at any
 * moment, signed by a superadmin, and the interface has to follow. The keyring
 * rides on the same node, so one reactive read covers both.
 *
 * @param {string} address
 */
const watchSelf = async (address) => {
  let introduced = false

  const { unsubscribe } = await directory.get(`user:${address}`, async (node) => {
    state.role = node?.value?.role ?? "guest"
    state.keyring = await readKeyring(directory, node?.value)
    el.sessionRole.textContent = state.role
    el.sessionRole.dataset.role = state.role

    // An identity is a stranger in every graph it has not written to. Present
    // it in the open room once, carrying the same declaration the directory
    // holds, so that room's governance can grant the matching role.
    if (state.tenant && node?.value && !introduced) {
      introduced = true
      await introduceInRoom(state.tenant, address, node.value)
    }

    render()
  })
  unwatchRole = unsubscribe
}

// 5. The session callback, wired last: it fires immediately with the current state.
await initIdentity(directory, (securityState) => {
  const { isActive, activeAddress, abbrAddr } = securityState

  el.sessionAddr.textContent = isActive ? abbrAddr : ""
  show(el.logout, isActive)

  if (isActive && activeAddress !== state.address) {
    state.address = activeAddress
    // The operator lands on the side they actually work from.
    if (activeAddress === SUPERADMIN.address) state.side = "admin"
    unwatchRole?.()
    watchSelf(activeAddress)
    return
  }

  if (!isActive) {
    unwatchRole?.()
    unwatchRole = null
    clearSession()
    el.sessionRole.textContent = ""
    render()
  }
})

// 6. The first paint. Views subscribe from here on, never from the session callback.
await render()
