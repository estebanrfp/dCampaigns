/**
 * The constitution: who may sign what, how a newcomer earns a side, and how the
 * graph is split between tenants.
 *
 * Everything here is declared once and shipped to every peer. Roles are not a
 * server-side check — they are signed grants the engine verifies locally, so
 * this file is the whole of the authorization model.
 */

/**
 * Canonical demo identities shared by the GenosDB ecosystem. Public and
 * throwaway: they protect nothing, and exist so any two windows can log in with
 * one click and already know each other.
 *
 * TESTING ONLY — a production deployment ships no mnemonic in its source and
 * points `superAdmins` at an address whose key lives on a GenosSRV instance.
 */
export const SUPERADMIN = {
  name: "Superadmin",
  emoji: "🛡️",
  mnemonic: "panic now afford carbon donate lecture drift excite collect essay stuff prosper",
  address: "0xbfDe0eCEC5332Fd86D2570085571D6051Df098dA",
}

// Alice and Bob — the ecosystem's other canonical identities — are deliberately
// absent: this app ships a one-click login only for the operator, and an unused
// mnemonic sitting in the source is dead code. The tests carry their own copies.

/**
 * The three sides of the product, as roles rather than as levels.
 *
 * `client` and `creator` are *lateral*: both inherit `user`, and neither is
 * above the other. What separates them is the verbs they may sign, which is why
 * the ladder is not enough on its own — a creator is not a lesser client.
 *
 * The verbs `createCampaign`, `assign`, `submit` and `approve` are
 * application-level: the engine only evaluates write/delete/link/sync and
 * assignRole, and honours inheritance for everything else through
 * `db.sm.executeWithPermission(verb)`. They gate the UI; the signature on the
 * operation is what carries authority.
 */
export const ROLES = {
  // The root of trust inherits both sides as well as the ladder. Without the
  // lateral roles in that list a superadmin holds `delete` and `assignRole` but
  // not `createCampaign`, because inheritance walks a chain and the sides are
  // not on it — which leaves a client locked out of their own room, where they
  // are the authority.
  superadmin: { can: ["assignRole"], inherits: ["admin", "client", "creator"] },
  admin: { can: ["delete"], inherits: ["manager"] },
  manager: { can: ["publish"], inherits: ["user"] },
  client: { can: ["createCampaign", "assign", "approve"], inherits: ["user"] },
  creator: { can: ["submit"], inherits: ["user"] },
  user: { can: ["write", "link", "sync"], inherits: ["guest"] },
  guest: { can: ["read", "sync"] },
}

/** Every onboarded member, whatever their side — the subject of the merit ladder. */
const MEMBER = { $in: ["user", "client", "creator"] }

/**
 * How a guest earns a side.
 *
 * A brand-new identity gets exactly one write: its own `user:<address>` node.
 * It spends it declaring which side it came for (`requestedSide`), and these
 * rules do the rest — evaluated every few seconds on a superadmin's device and
 * signed with their key, so every peer accepts the promotion.
 *
 * Order is easy → hard, because the LAST matching rule wins. The floor rule
 * catches every member regardless of side, so a cleared `requestedSide` demotes
 * cleanly back to `user` instead of sticking at a stale tier.
 */
export const GOVERNANCE_RULES = [
  // Onboarding: every guest crosses, side or no side.
  //
  // This rule used to require a declared side, and that was a bug with a very
  // quiet failure: anyone who signed in without answering the onboarding
  // dialog matched no rule at all and stayed `guest` forever, with nothing on
  // screen to explain why. A trust system may take its time promoting someone;
  // it must never strand them in silence.
  { if: { role: "guest" }, offsetTimestamp: 3000, then: { assignRole: "user" } },
  // Floor: onboarded, no side declared yet.
  { if: { role: MEMBER }, then: { assignRole: "user" } },
  // The two sides. Lateral, so neither overrides the other — only the floor.
  { if: { role: MEMBER, requestedSide: "creator" }, then: { assignRole: "creator" } },
  { if: { role: MEMBER, requestedSide: "client" }, then: { assignRole: "client" } },
]

/**
 * Deployment namespace.
 *
 * Peers only ever meet inside the same room name, so this is the one knob that
 * keeps one deployment's network from mixing with another's — a staging build,
 * or a test run that must not inherit yesterday's graph.
 *
 * Development only: the published app always uses the bare names.
 */
const NAMESPACE = import.meta.env?.DEV
  ? (new URLSearchParams(location.search).get("room") ?? "")
  : ""

const scope = NAMESPACE ? `-${NAMESPACE}` : ""

/** The public graph: identities, roles and the catalogue of client spaces. */
export const DIRECTORY_ROOM = `dcampaigns${scope}`

/**
 * A client's private graph.
 *
 * Tenant isolation is by transport, not by permission: each client gets its own
 * room, and a room is only joinable by a peer holding its password — signaling
 * is encrypted with it, so without the password the handshake never completes
 * and no replica is ever exchanged. An ACL denying `read` would not do this:
 * in a shared room the data still reaches every peer's disk.
 *
 * @param {string} slug - The client's stable identifier.
 * @returns {string} The room (and database) name for that client.
 */
export const tenantRoom = (slug) => `dcampaigns${scope}-c-${slug}`

/** Shared SM configuration — the same constitution in every room. */
export const smOptions = {
  superAdmins: [SUPERADMIN.address],
  customRoles: ROLES,
  acls: true,
}
