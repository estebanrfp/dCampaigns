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
 * author — on the live path and on state reconciliation alike since genosdb
 * 0.27.x — so a creator cannot approve their own work and a client cannot
 * silently alter what was delivered.
 *
 * One database carries the whole marketplace. A space is a catalogue node
 * owned by its client; everything inside it says `space: slug` and has an
 * owner of its own. Isolation is authorship — who signed what — with
 * `encryptDataForCurrentUser` for anything one identity keeps to itself.
 */
import { SUPERADMIN } from "./config.js"

const now = () => Date.now()
const newId = () => crypto.randomUUID()

// ── Identity ─────────────────────────────────────────────────────────

/**
 * Create or update the caller's own profile.
 *
 * This is the one write a brand-new identity is allowed: the node must be
 * `user:<address>` and the engine forcibly stamps `role: "guest"` on it,
 * whatever the value claims. The side declared here is what the governance
 * rules read to promote the newcomer.
 *
 * `db.put` replaces the whole value, so the existing node is spread first —
 * writing a bare object would wipe the role the Security Manager stores there.
 *
 * @param {object} db - The database.
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
 * Make sure this identity carries a role at all.
 *
 * Governance matches on the field: a rule reading `{ role: "guest" }` cannot
 * reach a node that has no `role`, and such a node is not slow to be promoted —
 * it is invisible. Worse, the interface prints "guest" for it anyway, because
 * that is the sensible fallback, so the account looks like every other newcomer
 * while being unreachable.
 *
 * Observed in real use: a node holding only `displayName` and `requestedSide`,
 * written before the Security Manager had stamped a role, stranded for good
 * while fresh accounts sailed through.
 *
 * `role` goes first in the spread so an existing one always wins.
 *
 * @param {object} db - The database.
 * @param {string} address
 * @returns {Promise<boolean>} whether a role had to be written.
 */
export const ensureRole = async (db, address) => {
  const id = `user:${address}`
  const existing = await awaitNode(db, id)
  if (existing?.value?.role) return false

  // Spread what is there — and only after *waiting* for it to be there. An
  // earlier version read the node the instant the session opened, got `null`
  // because it had not loaded yet, and wrote a bare `{ role: "guest" }` over a
  // perfectly good profile: the same mistake this repair exists to undo, made
  // one layer up. In a replicated graph, reading before the data arrives is
  // indistinguishable from reading an empty graph, and writing on that reading
  // destroys.
  await db.put({ role: "guest", ...existing?.value }, id)
  return true
}

/**
 * Wait for a node to exist, rather than concluding it does not.
 *
 * "Not found" and "has not arrived yet" are the same answer the moment you ask
 * a replicated graph. The reactive read fires as soon as the node lands; the
 * timeout is what turns a genuine absence into an answer.
 *
 * @param {object} db
 * @param {string} id
 * @param {number} [timeout=5000]
 * @returns {Promise<object|null>}
 */
export const awaitNode = async (db, id, timeout = 5000) => {
  const { result, unsubscribe } = await db.get(id, () => {})
  if (result) return unsubscribe?.(), result

  return new Promise((resolve) => {
    const done = (value) => {
      clearTimeout(timer)
      unsubscribe?.()
      resolve(value)
    }
    const timer = setTimeout(() => done(null), timeout)
    db.get(id, (node) => node && done(node))
  })
}

/**
 * Keep our own copy of the declared side, and put it back when it goes missing.
 *
 * The governance engine runs on the superadmin's device and writes from *their*
 * replica: `assignRole` spreads `existingUserData`, so if the node has not fully
 * synced there yet, the promotion is written from an incomplete copy and — being
 * newer — overwrites the good one. `requestedSide` disappears, the rule for the
 * side stops matching, and the identity is stuck one tier below where it asked
 * to be. Nothing is corrupt; a race was simply lost.
 *
 * So the declaration is kept in the node that is ours (governance only rewrites
 * `user:<address>`) and re-seeded whenever the public one has lost it.
 *
 * @param {object} db - The database.
 * @param {string} address
 * @returns {Promise<boolean>} whether the side had to be restored.
 */
export const keepSide = async (db, address) => {
  const key = `dcampaigns.side.${address}`
  const { result: user } = await db.get(`user:${address}`)
  const declared = user?.value?.requestedSide

  // The public node still has it: keep the local copy in step and stop.
  //
  // This copy is deliberately not a graph node. A newcomer is a `guest` with no
  // write permission, so the very moment the declaration most needs backing up
  // is the moment it cannot be written anywhere in the graph — and by the time
  // the role arrives, the value has already been lost. Local storage has no
  // such gate.
  if (declared) {
    localStorage.setItem(key, declared)
    return false
  }

  const remembered = localStorage.getItem(key)
  if (!remembered || !user?.value) return false

  await db.put({ ...user.value, requestedSide: remembered }, `user:${address}`)
  return true
}

// ── Catalogue ────────────────────────────────────────────────────────

/**
 * Register a client space in the catalogue.
 *
 * An ACL node: the engine stamps the caller as `owner`, and that authorship is
 * enforced by every peer on every sync path — the entry cannot be reassigned
 * or rewritten by anyone else. There is no password and nothing to hand out:
 * entering a space is choosing it from the catalogue, and what keeps the work
 * inside a space its client's is ownership, not distance.
 *
 * @param {object} db - The database.
 * @param {{slug: string, name: string}} client
 * @returns {Promise<string>} The node id.
 */
export const createClientSpace = (db, { slug, name }) =>
  db.sm.acls.set({ type: "client", slug, name, createdAt: now() }, `client:${slug}`)

// ── Space graph ──────────────────────────────────────────────────────

/**
 * Create a campaign inside a space.
 *
 * @param {object} db - The database.
 * @param {{space: string, title: string, brief: string}} campaign
 * @returns {Promise<string>} The node id.
 */
export const createCampaign = (db, { space, title, brief }) => {
  const id = `campaign:${newId()}`
  // `ref` repeats the node id inside the value on purpose: the query language
  // filters on fields of the value, so without it there is no way to name one
  // campaign as the starting point of an `$edge` traversal.
  return db.sm.acls.set({ type: "campaign", ref: id, space, title, brief, status: "open", createdAt: now() }, id)
}

/**
 * Create a task and hang it off its campaign.
 *
 * The edge is what makes `$edge` able to return a campaign's whole tree in one
 * query, so it is created here rather than left to the reader to infer from a
 * foreign key.
 *
 * @param {object} db - The database.
 * @param {{space: string, campaignId: string, title: string, requirements: string, assignee?: string}} task
 * @returns {Promise<string>} The node id.
 */
export const createTask = async (db, { space, campaignId, title, requirements, assignee = null }) => {
  const id = await db.sm.acls.set(
    { type: "task", space, campaignId, title, requirements, assignee, status: "open", createdAt: now() },
    `task:${newId()}`
  )
  await db.link(campaignId, id)
  return id
}

/**
 * Assign a task to a specific creator, or reopen it to anyone.
 *
 * The assignment is a signed statement by the client: *this person is the one I
 * asked*. It is not a lock — any member can still sign a delivery, and if they
 * do, the graph records exactly who did it and the client rejects it. What the
 * assignment buys is attribution, not prevention.
 *
 * `acls.set` merges over the stored node and re-checks ownership on every
 * peer, so only the task's owner (or a `write` collaborator) can change this.
 *
 * @param {object} db - The database.
 * @param {string} taskId
 * @param {string|null} assignee - A creator's address, or null to reopen it.
 * @returns {Promise<string>} The node id.
 */
export const assignTask = async (db, taskId, assignee) => {
  const { result } = await db.get(taskId)
  if (!result) throw new Error("That task no longer exists")
  return db.sm.acls.set({ assignee, assignedAt: assignee ? now() : null }, taskId)
}

/**
 * The creators on the platform.
 *
 * Every identity declares its side on its own `user:` node, so the graph
 * itself knows who is available to be assigned — no roster to maintain.
 *
 * @param {object} db - The database.
 * @returns {Promise<object>} `{ results }` of `user:<address>` nodes.
 */
export const creators = (db) => db.map({ query: { requestedSide: "creator" } })

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
 * @param {object} db - The database.
 * @param {{space: string, taskId: string, postUrl: string, proof: string, creator: string, reviewer: string}} submission
 * @returns {Promise<string>} The node id.
 */
export const submitWork = async (db, { space, taskId, postUrl, proof, creator, reviewer }) => {
  const id = await db.sm.acls.set({
    type: "submission",
    space,
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
 * @param {object} db - The database.
 * @param {{space: string, submissionId: string, verdict: 'approved'|'rejected', note: string, reviewer: string, creator: string}} decision
 * @returns {Promise<string>} The node id.
 */
export const decideSubmission = async (db, { space, submissionId, verdict, note, reviewer, creator }) => {
  const id = await db.sm.acls.set(
    { type: "approval", space, submissionId, verdict, note, reviewer, decidedAt: now() },
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
 * @param {object} db - The database.
 * @param {string} campaignId
 * @param {Function} [callback] - Pass one to subscribe in real time.
 * @returns {Promise<object>} `{ results, unsubscribe? }`
 */
export const tasksOfCampaign = (db, campaignId, callback) =>
  db.map(
    {
      query: { type: "campaign", ref: campaignId, $edge: { type: "task" } },
      // Ordering belongs to the engine, not to the view: `initial` then arrives
      // already sorted and the app never re-sorts what it was handed.
      field: "createdAt",
      order: "desc",
    },
    callback
  )
