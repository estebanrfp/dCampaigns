/**
 * dCampaigns — commissioning creative work, as a distributed application.
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
import { ensureRole, introduceInRoom, keepSide, migrateKeyring, readKeyring } from "./db/model.js"
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
  let drawn = null // what the view was last built from

  // The keyring is its own node now, so it gets its own subscription: it
  // changes when a room is joined, which has nothing to do with the role.
  const keyring = await directory.get(`keyring:${address}`, async () => {
    state.keyring = await readKeyring(directory, address)
    render()
  })
  state.keyring = await readKeyring(directory, address)

  const { unsubscribe } = await directory.get(`user:${address}`, async (node) => {
    state.role = node?.value?.role ?? "guest"
    el.sessionRole.textContent = state.role
    el.sessionRole.dataset.role = state.role

    // A promotion written from an incomplete replica can drop the declared
    // side, which leaves this identity a tier below what it asked for. Put it
    // back from the copy governance never touches.
    keepSide(directory, address).catch((error) =>
      console.error("[dCampaigns] could not restore the declared side:", error)
    )

    // An identity is a stranger in every graph it has not written to. Present
    // it in the open room once, carrying the same declaration the directory
    // holds, so that room's governance can grant the matching role.
    if (state.tenant && node?.value && !introduced) {
      introduced = true
      try {
        await introduceInRoom(state.tenant, address, node.value)
      } catch (error) {
        // Silence here is the worst outcome: an identity nobody in the room can
        // name, and a client who cannot assign work to them.
        console.error("[dCampaigns] could not introduce this identity in the room:", error)
        toast("Could not announce you in this space", "error")
      }
    }

    // Only rebuild when something the view is built from actually changed.
    // This node is written by governance and by the keyring, and redrawing on
    // every touch tears down whatever the user was in the middle of — a form
    // half filled in vanishes because a role was re-signed elsewhere.
    const signature = `${state.role}|${state.keyring.map((entry) => entry.slug).join(",")}`
    if (signature === drawn) return
    drawn = signature

    render()
  })

  unwatchRole = () => {
    unsubscribe?.()
    keyring.unsubscribe?.()
  }
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

    // Before watching the role, make sure there is one to watch. An identity
    // whose node predates the Security Manager stamping a role is invisible to
    // governance, and no amount of waiting fixes it.
    ensureRole(directory, activeAddress)
      .then((repaired) => repaired && toast("Your identity was missing a role — fixed", "info"))
      .catch((error) => console.error("[dCampaigns] could not ensure a role:", error))

    // Lift an old keyring out of the user node, where a role assignment could
    // erase the passwords to every space this identity was admitted to.
    migrateKeyring(directory, activeAddress)
      .then((moved) => moved && toast("Your room keys were moved somewhere safer", "info"))
      .catch((error) => console.error("[dCampaigns] could not migrate the keyring:", error))

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
