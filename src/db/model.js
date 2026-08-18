/**
 * The data model, and the one idea it exists to carry.
 *
 * A submission belongs to the creator who made it and is never rewritten by the
 * reviewer: the verdict is a *separate node*, owned and signed by whoever
 * decided it. That is the difference between this and a backend with a status
 * column — an approval here has attributable authorship, cannot be edited into
 * existence afterwards, and the creator keeps their own signed replica of what
 * they delivered and when.
 *
 * Node-level ACLs are what make that hold against a tampered client: every peer
 * re-checks each incoming operation against the cryptographically verified
 * author, so a creator cannot approve their own work and a client cannot
 * silently alter what was delivered.
 */
import { SUPERADMIN } from "./config.js"

const now = () => Date.now()
const newId = () => crypto.randomUUID()

// ── Directory ────────────────────────────────────────────────────────

/**
 * Create or update the caller's own profile in the public directory.
 *
 * This is the one write a brand-new identity is allowed: the node must be
 * `user:<address>` and the engine forcibly stamps `role: "guest"` on it,
 * whatever the value claims. The side declared here is what the governance
 * rules read to promote the newcomer.
 *
 * `db.put` replaces the whole value, so the existing node is spread first —
 * writing a bare object would wipe the role the Security Manager stores there.
 *
 * @param {object} db - The directory instance.
 * @param {string} address - The caller's Ethereum address.
 * @param {{displayName?: string, requestedSide?: 'client'|'creator'}} profile
 * @returns {Promise<string>} The node id.
 */
export const saveProfile = async (db, address, profile) => {
  const id = `user:${address}`
  const { result } = await db.get(id)
  return db.put({ ...result?.value, ...profile }, id)
}

/**
 * Register a client space in the public catalogue.
 *
 * The room password is deliberately NOT stored here: the directory is readable
 * by anyone, and a secret in it would be no secret. It travels out of band and
 * is entered by whoever is admitted.
 *
 * @param {object} db - The directory instance.
 * @param {{slug: string, name: string, owner: string}} client
 * @returns {Promise<string>} The node id.
 */
export const createClientSpace = (db, { slug, name, owner }) =>
  db.put({ type: "client", slug, name, owner, createdAt: now() }, `client:${slug}`)

/**
 * Introduce the caller into a room they have just entered.
 *
 * Roles are stored per graph, so an identity that is a `client` in the
 * directory arrives at a tenant room as an unknown guest. The welcome write is
 * spent here on the same declaration the directory holds, and that room's
 * governance — run by its owner, who is a superadmin of their own space —
 * grants the matching role.
 *
 * A guest gets exactly one write, so this is skipped once the node exists.
 *
 * @param {object} db - The tenant instance.
 * @param {string} address - The caller's Ethereum address.
 * @param {{displayName?: string, requestedSide?: string}} profile - As held in the directory.
 * @returns {Promise<void>}
 */
export const introduceInRoom = async (db, address, profile) => {
  const id = `user:${address}`
  const { result } = await db.get(id)
  if (result) return // already known here; a guest has no second write
  await db.put(
    { displayName: profile.displayName, requestedSide: profile.requestedSide },
    id
  )
}

/**
 * Remember a room the caller has been admitted to.
 *
 * The password is encrypted with a key derived from the caller's own identity
 * before it touches the graph, so the public directory carries a secret only
 * its owner can open. This encrypts *for yourself* — there is no recipient —
 * which is exactly the shape needed here: the field is a private keyring, not a
 * way to hand the key to somebody else.
 *
 * The rest of the profile stays plaintext, so a reactive `db.map()` keeps
 * carrying it. That is why this uses `encryptDataForCurrentUser` on one field
 * rather than `db.sm.put`, which would hide the whole record.
 *
 * @param {object} db - The directory instance.
 * @param {string} address - The caller's Ethereum address.
 * @param {{slug: string, password: string, owner: string}} room
 * @returns {Promise<string>} The node id.
 */
export const rememberRoom = async (db, address, room) => {
  const id = `user:${address}`
  const { result } = await db.get(id)
  const keyring = await readKeyring(db, result?.value)
  const next = [...keyring.filter((entry) => entry.slug !== room.slug), room]
  return db.put({ ...result?.value, keyring: await db.sm.encryptDataForCurrentUser(next) }, id)
}

/**
 * Open the caller's keyring, if it is theirs to open.
 *
 * The throw *is* the ownership test: an address field is plain data any peer
 * with a write role can set, while the key cannot be faked.
 *
 * @param {object} db - The directory instance.
 * @param {object} [profile] - The `user:<address>` node value.
 * @returns {Promise<Array<{slug: string, password: string, owner: string}>>}
 */
export const readKeyring = async (db, profile) => {
  if (!profile?.keyring) return []
  try {
    return await db.sm.decryptDataForCurrentUser(profile.keyring)
  } catch {
    return [] // not ours
  }
}

// ── Tenant graph ─────────────────────────────────────────────────────

/**
 * Create a campaign inside a client's room.
 *
 * @param {object} db - The tenant instance.
 * @param {{title: string, brief: string, owner: string}} campaign
 * @returns {Promise<string>} The node id.
 */
export const createCampaign = (db, { title, brief, owner }) => {
  const id = `campaign:${newId()}`
  // `ref` repeats the node id inside the value on purpose: the query language
  // filters on fields of the value, so without it there is no way to name one
  // campaign as the starting point of an `$edge` traversal.
  return db.put({ type: "campaign", ref: id, title, brief, owner, status: "open", createdAt: now() }, id)
}

/**
 * Create a task and hang it off its campaign.
 *
 * The edge is what makes `$edge` able to return a campaign's whole tree in one
 * query, so it is created here rather than left to the reader to infer from a
 * foreign key.
 *
 * @param {object} db - The tenant instance.
 * @param {{campaignId: string, title: string, requirements: string, assignee?: string}} task
 * @returns {Promise<string>} The node id.
 */
export const createTask = async (db, { campaignId, title, requirements, assignee = null }) => {
  const id = await db.put(
    { type: "task", campaignId, title, requirements, assignee, status: "open", createdAt: now() },
    `task:${newId()}`
  )
  await db.link(campaignId, id)
  return id
}

/**
 * Submit work against a task.
 *
 * The node is created through the ACL module, so the creator is its owner and
 * remains the only peer that may rewrite it. The reviewer is granted `read`
 * only — deliberately: a reviewer who could write could edit the delivery they
 * are judging.
 *
 * The operator is granted `delete` at creation because ACL authority is granted,
 * never inherited: a superadmin is the root of trust for *roles*, and holds no
 * power over a node it does not own. Moderation that was not written into the
 * node when it was born does not exist.
 *
 * @param {object} db - The tenant instance.
 * @param {{taskId: string, postUrl: string, proof: string, creator: string, reviewer: string}} submission
 * @returns {Promise<string>} The node id.
 */
export const submitWork = async (db, { taskId, postUrl, proof, creator, reviewer }) => {
  const id = await db.sm.acls.set({
    type: "submission",
    taskId,
    postUrl,
    proof,
    creator,
    submittedAt: now(),
  })
  await db.sm.acls.grant(id, reviewer, "read")
  if (creator !== SUPERADMIN.address) await db.sm.acls.grant(id, SUPERADMIN.address, "delete")
  return id
}

/**
 * Decide on a submission.
 *
 * A separate node, owned by the reviewer, carrying who decided and when. The
 * submission itself is untouched — which is the point: the record of what was
 * delivered and the record of what was decided are different claims by
 * different people, and each is verifiable on its own.
 *
 * @param {object} db - The tenant instance.
 * @param {{submissionId: string, verdict: 'approved'|'rejected', note: string, reviewer: string, creator: string}} decision
 * @returns {Promise<string>} The node id.
 */
export const decideSubmission = async (db, { submissionId, verdict, note, reviewer, creator }) => {
  const id = await db.sm.acls.set(
    { type: "approval", submissionId, verdict, note, reviewer, decidedAt: now() },
    `approval:${submissionId}`
  )
  await db.sm.acls.grant(id, creator, "read")
  if (reviewer !== SUPERADMIN.address) await db.sm.acls.grant(id, SUPERADMIN.address, "delete")
  return id
}

// ── Queries ──────────────────────────────────────────────────────────

/**
 * Every task belonging to a campaign, in one traversal.
 *
 * The campaign is the starting point and the sub-query filters its descendants,
 * so the result is the tasks themselves — not the campaign.
 *
 * @param {object} db - The tenant instance.
 * @param {string} campaignId
 * @param {Function} [callback] - Pass one to subscribe in real time.
 * @returns {Promise<object>} `{ results, unsubscribe? }`
 */
export const tasksOfCampaign = (db, campaignId, callback) =>
  db.map({ query: { type: "campaign", ref: campaignId, $edge: { type: "task" } } }, callback)
