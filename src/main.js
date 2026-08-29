/**
 * dCampaigns — commissioning creative work, as a distributed application.
 *
 * What to read here, and where:
 *   · openDb()                             — the one graph: identities, catalogue, every space's work
 *   · db.sm.setSecurityStateChangeCallback — the single source of truth for the session
 *   · db.get(`user:<address>`, cb)         — the live role, watched not polled
 *   · db.map(options, cb)                  — one subscription per view, four actions
 *   · db.sm.acls.set / grant               — a submission belongs to whoever made it
 *
 * The boot order below is not arbitrary: everything hangs off `db`, and the
 * session callback fires the moment it is set, so everything it touches must
 * already exist.
 */
import { openDb } from "./db/rooms.js"
import { SUPERADMIN } from "./db/config.js"
import { ensureRole, keepSide } from "./db/model.js"
import { serveProofs } from "./db/proofs.js"
import { initIdentity } from "./auth/identity.js"
import { initTheme } from "./ui/theme.js"
import { initViewMode } from "./ui/view-mode.js"
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
  help: $("help-btn"),
  helpLink: $("help-link"),
  helpModal: $("help-modal"),
}

// 1. The database, with its constitution. One instance per project — the
//    engine's own recommendation — and everything below hangs off it.
const db = await openDb()
state.db = db

// 1b. Answer requests for evidence this device holds. Wired once and left
//     running: a peer serving its own files is not a background job, it is what
//     being a peer means.
serveProofs(db)

// 2. Theme and view mode, before anything paints. Both are attributes on the
//    root, so a view rendered later is already correct instead of being told.
initTheme()
initViewMode()

// 3. Every listener. Pure DOM wiring — no data, no session.
el.logout.onclick = () => db.sm.clearSecurity()

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

// Help, from the two places somebody looks for it: the "?" in the top bar, and
// the identity door itself — which is where a first-time visitor actually is,
// and the moment a distributed app most reads as broken.
//
// Deliberately not auto-opened. Stacking it on the door buries the door, and a
// sheet that appears unasked gets dismissed unread.
el.helpModal.onclick = (event) => {
  if (event.target === el.helpModal) el.helpModal.close()
}
;[el.help, el.helpLink].forEach((button) => {
  if (button) button.onclick = () => el.helpModal.showModal()
})

// 4. Presence, from the room.
const updatePresence = () => {
  const count = Object.keys(db.room?.getPeers() ?? {}).length
  el.presence.textContent = `${count} ${count === 1 ? "peer" : "peers"}`
}
db.room?.on("peer:join", updatePresence)
db.room?.on("peer:leave", updatePresence)
updatePresence()

/** @type {Function|null} Teardown for the live role subscription. */
let unwatchRole = null

/**
 * Watch the caller's own user node.
 *
 * The role is not read once at login: governance can promote or demote at any
 * moment, signed by a superadmin, and the interface has to follow.
 *
 * @param {string} address
 */
const watchSelf = async (address) => {
  let drawn = null // what the view was last built from

  const { unsubscribe } = await db.get(`user:${address}`, async (node) => {
    state.role = node?.value?.role ?? "guest"
    el.sessionRole.textContent = state.role
    el.sessionRole.dataset.role = state.role

    // A promotion written from an incomplete replica can drop the declared
    // side, which leaves this identity a tier below what it asked for. Put it
    // back from the copy governance never touches.
    keepSide(db, address).catch((error) =>
      console.error("[dCampaigns] could not restore the declared side:", error)
    )

    // Only rebuild when something the view is built from actually changed:
    // redrawing on every touch of this node tears down whatever the user was
    // in the middle of — a form half filled in vanishes because a role was
    // re-signed elsewhere.
    if (state.role === drawn) return
    drawn = state.role

    render()
  })

  unwatchRole = unsubscribe
}

// 5. The session callback, wired last: it fires immediately with the current state.
await initIdentity(db, (securityState) => {
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
    ensureRole(db, activeAddress)
      .then((repaired) => repaired && toast("Your identity was missing a role — fixed", "info"))
      .catch((error) => console.error("[dCampaigns] could not ensure a role:", error))

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
