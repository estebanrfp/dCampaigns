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
 * Make sure this identity carries a role at all.
 *
 * Governance matches on the field: a rule reading `{ role: "guest" }` cannot
 * reach a node that has no `role`, and such a node is not slow to be promoted —
 * it is invisible. Worse, the interface prints "guest" for it anyway, because
 * that is the sensible fallback, so the account looks like every other newcomer
 * while being unreachable.
 *
 * Observed in real use: a node holding only `displayName`, `requestedSide` and
 * `keyring`, written before the Security Manager had stamped a role, stranded
 * for good while fresh accounts sailed through.
 *
 * `role` goes first in the spread so an existing one always wins.
 *
 * @param {object} db - The directory instance.
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

  // The node may already exist without ever having been introduced: the
  // Security Manager creates `user:<address>` when the session opens, carrying
  // a role and nothing else. Skipping on "it exists" therefore skipped every
  // time, and left an identity the room could not name. Only a declaration
  // already in place means there is nothing to do.
  if (result?.value?.requestedSide) return

  // Spread first: `db.put` replaces the whole value, and the role stored here
  // is the room's, not ours to drop.
  await db.put(
    {
      ...result?.value,
      displayName: profile.displayName,
      requestedSide: profile.requestedSide,
    },
    id
  )
}

/**
 * The keyring lives in its own node, not on the user node.
 *
 * It used to be a field on `user:<address>`, and that was a latent way to lose
 * your own spaces: assigning a role rewrites that node and drops every
 * application field with it. Observed directly — after a promotion the node was
 * left as `{ role, ethAddress, assignedByEthAddress, expiresAt }` and nothing
 * else. Real accounts survived only because the app happened to rewrite them
 * afterwards, which is a race, and losing it means losing the passwords to
 * every client space you had been admitted to.
 *
 * A node of its own is untouched by governance, still replicates (so the
 * keyring follows the identity to another device), and is owned through ACLs so
 * no other peer can overwrite it.
 */
const keyringId = (address) => `keyring:${address}`

/**
 * Remember a room the caller has been admitted to.
 *
 * The passwords are encrypted with a key derived from the caller's own identity
 * before they touch the graph. This encrypts *for yourself* — there is no
 * recipient — which is exactly the shape needed: a private keyring, not a way
 * to hand a key to somebody else.
 *
 * @param {object} db - The directory instance.
 * @param {string} address - The caller's Ethereum address.
 * @param {{slug: string, password: string, owner: string}} room
 * @returns {Promise<string>} The node id.
 */
export const rememberRoom = async (db, address, room) => {
  const keyring = await readKeyring(db, address)
  const next = [...keyring.filter((entry) => entry.slug !== room.slug), room]
  const { result } = await db.get(keyringId(address))
  return db.sm.acls.set(
    {
      ...result?.value,
      type: "keyring",
      owner: address,
      rooms: await db.sm.encryptDataForCurrentUser(next),
    },
    keyringId(address)
  )
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
 * @param {object} db - The directory instance.
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

/**
 * The reviewer keeps their own copy of every verdict, off the graph.
 *
 * A verdict is a claim by the person who signed it — but the graph node that
 * carries it is not, on its own, tamper-proof. Node-level ACLs are enforced on
 * the live op-by-op path only; state reconciliation (`deltaSync` /
 * `fullStateSync`) merges by clock alone, with no ownership check. So a peer
 * running modified code can broadcast a newer timestamp for an approval id and
 * overwrite its value on every peer it syncs with — the owner's included.
 *
 * The defence is not to trust the shared node for your own decisions. The
 * reviewer mirrors each verdict to local storage, which lives outside the
 * replicated graph where no peer can reach it, and the client's own view is
 * drawn from that copy. The network can flip the mirror; it cannot flip what
 * you decided on your own device.
 *
 * @param {string} slug - The room the decision was made in.
 * @param {string} submissionId
 * @param {'approved'|'rejected'} verdict
 */
export const rememberVerdict = (slug, submissionId, verdict) => {
  if (slug && submissionId) localStorage.setItem(`dcampaigns.verdict.${slug}.${submissionId}`, verdict)
}

/**
 * This device's own recorded verdict for a submission, or null if it made none.
 *
 * @param {string} slug
 * @param {string} submissionId
 * @returns {string|null}
 */
export const ownVerdict = (slug, submissionId) =>
  slug && submissionId ? localStorage.getItem(`dcampaigns.verdict.${slug}.${submissionId}`) : null

/**
 * The creator keeps their own copy of what they delivered, off the graph.
 *
 * A submission is the creator's node, but "owned" is not "immutable": the same
 * reconciliation path that can flip a verdict can rewrite a delivery, and an
 * operator granted `delete` to moderate also holds `write` — the ACL model
 * folds the two together. So the creator mirrors the delivery to local storage
 * and renders their own copy on their own submissions. What you delivered is
 * yours to display, whatever a peer merged into the shared node.
 *
 * @param {string} slug
 * @param {string} submissionId
 * @param {{postUrl: string, proof: string}} content
 */
export const rememberSubmission = (slug, submissionId, content) => {
  if (slug && submissionId) localStorage.setItem(`dcampaigns.submission.${slug}.${submissionId}`, JSON.stringify(content))
}

/**
 * This device's own copy of a submission it delivered, or null.
 *
 * @param {string} slug
 * @param {string} submissionId
 * @returns {{postUrl: string, proof: string}|null}
 */
export const ownSubmission = (slug, submissionId) => {
  if (!slug || !submissionId) return null
  try {
    return JSON.parse(localStorage.getItem(`dcampaigns.submission.${slug}.${submissionId}`)) || null
  } catch {
    return null
  }
}

/**
 * Open the caller's keyring, if it is theirs to open.
 *
 * The throw *is* the ownership test: an `owner` field is plain data any peer
 * with a write role can set, while the key cannot be faked.
 *
 * @param {object} db - The directory instance.
 * @param {string} address - The caller's Ethereum address.
 * @returns {Promise<Array<{slug: string, password: string, owner: string}>>}
 */
export const readKeyring = async (db, address) => {
  if (!address) return []
  const { result } = await db.get(keyringId(address))
  if (!result?.value?.rooms) return []
  try {
    return await db.sm.decryptDataForCurrentUser(result.value.rooms)
  } catch {
    return [] // not ours
  }
}

/**
 * Move a keyring that still lives on the user node.
 *
 * Anyone who used an earlier build has their room passwords in the place a role
 * assignment can erase. This lifts them out on the next sign-in and clears the
 * old field, so the window closes for good rather than staying open for
 * whoever happens to be promoted next.
 *
 * @param {object} db - The directory instance.
 * @param {string} address
 * @returns {Promise<boolean>} whether anything was moved.
 */
export const migrateKeyring = async (db, address) => {
  const userId = `user:${address}`
  const { result } = await db.get(userId)
  if (!result?.value?.keyring) return false

  let rooms
  try {
    rooms = await db.sm.decryptDataForCurrentUser(result.value.keyring)
  } catch {
    return false // not ours to move
  }

  await db.sm.acls.set(
    { type: "keyring", owner: address, rooms: await db.sm.encryptDataForCurrentUser(rooms) },
    keyringId(address)
  )

  const { keyring, ...withoutKeyring } = result.value
  await db.put(withoutKeyring, userId)
  return true
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
 * Assign a task to a specific creator, or reopen it to anyone.
 *
 * The assignment is a signed statement by the client: *this person is the one I
 * asked*. It is not a lock — any member of the room can still sign a delivery,
 * and if they do, the graph records exactly who did it and the client rejects
 * it. What the assignment buys is attribution, not prevention.
 *
 * `db.put` replaces the whole value, so the task is spread first.
 *
 * @param {object} db - The tenant instance.
 * @param {string} taskId
 * @param {string|null} assignee - A creator's address, or null to reopen it.
 * @returns {Promise<string>} The node id.
 */
export const assignTask = async (db, taskId, assignee) => {
  const { result } = await db.get(taskId)
  if (!result) throw new Error("That task no longer exists")
  return db.put({ ...result.value, assignee, assignedAt: assignee ? now() : null }, taskId)
}

/**
 * The creators who have joined this room.
 *
 * Every identity introduces itself in each graph it enters, carrying the side
 * it declared, so the room itself knows who is available to be assigned — no
 * roster to maintain, and no lookup back into the directory.
 *
 * @param {object} db - The tenant instance.
 * @returns {Promise<object>} `{ results }` of `user:<address>` nodes.
 */
export const creatorsInRoom = (db) => db.map({ query: { requestedSide: "creator" } })

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
