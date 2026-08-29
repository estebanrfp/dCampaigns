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
export const submitWork = async (db, { space, taskId, postUrl, proof, creator, reviewer, supersedes = null, attachment = null }) => {
  // A resubmission is a new attempt, never an edit of the rejected one. The
  // number is read from the delivery being replaced, so the chain counts itself.
  const previous = supersedes ? (await db.get(supersedes)).result?.value : null
  const attempt = (previous?.attempt ?? 0) + 1

  const id = await db.sm.acls.set({
    type: "submission",
    space,
    taskId,
    postUrl,
    proof,
    creator,
    attempt,
    supersedes,
    // The digest travels inside the delivery, which is signed now and judged
    // later: it is what lets the record name the file that was accepted.
    ...(attachment ?? {}),
    submittedAt: now(),
  })
  await db.sm.acls.grant(id, reviewer, "read")
  if (creator !== SUPERADMIN.address) await db.sm.acls.grant(id, SUPERADMIN.address, "delete")

  // The edge makes the history walkable in one traversal rather than a loop of
  // reads: `$edge` from any attempt reaches the one that answered it.
  if (supersedes) await db.link(supersedes, id)
  return id
}

/** The largest attachment worth putting in a replicated graph. */
export const MAX_PROOF_BYTES = 400 * 1024

/**
 * Hex SHA-256 of a buffer — the name the evidence answers to.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>}
 */
const sha256 = async (buffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")

/**
 * Store the evidence itself, not a link to it.
 *
 * A URL to somebody's file host is the one part of a delivery that still asks
 * you to trust a server: it can 404, change hands, or serve different bytes
 * tomorrow than it served when the work was accepted. The bytes go in the graph
 * instead — a node with an owner, replicated and signed like every other claim,
 * readable from your own replica with nobody online.
 *
 * The digest is what makes it evidence rather than an attachment. It is written
 * into the *delivery*, which is signed before any verdict exists, so the record
 * says which file was accepted. A backend cannot make that claim: whoever can
 * write the row can swap the attachment afterwards and nothing disagrees.
 *
 * @param {object} db - The database.
 * @param {File} file
 * @param {string} space
 * @returns {Promise<{proofId: string, proofHash: string, proofName: string, proofType: string, proofSize: number}>}
 */
export const attachProof = async (db, file, space) => {
  if (file.size > MAX_PROOF_BYTES) {
    throw new Error(`That file is ${Math.round(file.size / 1024)} KB; the limit is ${MAX_PROOF_BYTES / 1024} KB`)
  }
  const buffer = await file.arrayBuffer()
  const proofHash = await sha256(buffer)

  // Base64 because a node is JSON on the wire, and a typed array would not
  // survive the trip intact.
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }

  const proofId = await db.sm.acls.set({
    type: "proof",
    space,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    hash: proofHash,
    data: btoa(binary),
    storedAt: now(),
  })

  return { proofId, proofHash, proofName: file.name, proofType: file.type, proofSize: file.size }
}

/**
 * Read an attachment back, and check it is the one that was signed for.
 *
 * The digest is recomputed from the bytes actually held rather than trusted
 * from the node that carries them, so a file swapped after the fact is caught
 * on the way to the screen instead of being displayed as though nothing
 * happened.
 *
 * @param {object} db - The database.
 * @param {string} proofId
 * @param {string} expectedHash - As written into the signed delivery.
 * @returns {Promise<{blob: Blob, name: string, intact: boolean}|null>}
 */
export const readProof = async (db, proofId, expectedHash) => {
  const { result } = await db.get(proofId)
  if (!result?.value?.data) return null

  const binary = atob(result.value.data)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const intact = (await sha256(bytes.buffer)) === expectedHash

  return { blob: new Blob([bytes], { type: result.value.mime }), name: result.value.name, intact }
}

/**
 * Deliver again after a rejection.
 *
 * The rejected attempt stays exactly as it was, with the verdict that rejected
 * it still attached and still signed by the reviewer. Nothing is overwritten,
 * so the record shows what was asked, what was delivered, why it came back, and
 * what changed — which is the difference between a signed history and a status
 * column that only remembers its last value.
 *
 * @param {object} db - The database.
 * @param {object} previous - The rejected submission `{ id, value }`.
 * @param {{postUrl: string, proof: string, reviewer: string}} attempt
 * @returns {Promise<string>} The new submission's node id.
 */
export const resubmitWork = (db, previous, { postUrl, proof, reviewer }) =>
  submitWork(db, {
    space: previous.value.space,
    taskId: previous.value.taskId,
    creator: previous.value.creator,
    postUrl,
    proof,
    reviewer,
    supersedes: previous.id,
  })

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
export const decideSubmission = async (db, { space, submissionId, verdict, note, reviewer, creator, batchId = null }) => {
  const id = await db.sm.acls.set(
    // `batchId` is null when this delivery was read on its own, and names the
    // act when it was decided alongside others. The interface says which, so a
    // bulk approval never passes itself off as an individual reading.
    { type: "approval", space, submissionId, verdict, note, reviewer, batchId, decidedAt: now() },
    `approval:${submissionId}`
  )
  await db.sm.acls.grant(id, creator, "read")
  if (reviewer !== SUPERADMIN.address) await db.sm.acls.grant(id, SUPERADMIN.address, "delete")
  return id
}

/**
 * Decide on several deliveries in one act.
 *
 * Every admin tool grows this the moment a queue does, and every backend
 * records it as though it had not happened: fifty rows change `status`, and the
 * result is indistinguishable from fifty separate readings. That difference is
 * exactly what a reviewer's judgement is worth, and it is the first thing lost.
 *
 * So the act itself is a node — signed by the reviewer, naming what it covered
 * and when — and each verdict points back at it. Each delivery still gets its
 * own verdict, because a verdict is about one delivery and has to stand alone.
 * What the batch adds is the honest part: a record that says *these were decided
 * together*, which anyone reading later can weigh for themselves.
 *
 * @param {object} db - The database.
 * @param {{space: string, submissions: Array<{id: string, creator: string}>, verdict: 'approved'|'rejected', note: string, reviewer: string}} decision
 * @returns {Promise<string>} The batch node id.
 */
export const decideBatch = async (db, { space, submissions, verdict, note, reviewer }) => {
  const batchId = `batch:${newId()}`
  await db.sm.acls.set(
    {
      type: "batch",
      space,
      verdict,
      note,
      reviewer,
      covers: submissions.map(({ id }) => id),
      decidedAt: now(),
    },
    batchId
  )

  // Sequentially on purpose: each verdict is its own signed operation, and the
  // engine stamps them in order, so the record reads the way it happened.
  for (const { id, creator } of submissions) {
    await decideSubmission(db, { space, submissionId: id, verdict, note, reviewer, creator, batchId })
  }
  return batchId
}

/**
 * Record that a delivery was paid for.
 *
 * The third link in the chain, and the one a marketplace is finally about. It
 * is a claim by the payer — *I owe this, for this work, on this date* — signed
 * with their key and owned by them, exactly like the verdict before it. The
 * approval is not touched, so the record of what was accepted and the record of
 * what was settled stay two statements by two moments, each verifiable alone.
 *
 * This does not move money. It is the decision, which is the part that has to
 * be attributable: a rail can be attached to a signed instruction later, and
 * whatever settles it can be reconciled against a record nobody could have
 * written on someone else's behalf.
 *
 * @param {object} db - The database.
 * @param {{space: string, submissionId: string, amount: number, currency: string, payer: string, creator: string, note?: string}} payout
 * @returns {Promise<string>} The node id.
 */
export const recordPayout = async (db, { space, submissionId, amount, currency, payer, creator, note = "" }) => {
  const id = await db.sm.acls.set(
    { type: "payout", space, submissionId, amount, currency, note, payer, decidedAt: now() },
    `payout:${submissionId}`
  )
  // The creator can read what was decided about their own work — and, holding
  // the payer's signature on their replica, can show it to anyone.
  await db.sm.acls.grant(id, creator, "read")
  if (payer !== SUPERADMIN.address) await db.sm.acls.grant(id, SUPERADMIN.address, "delete")
  return id
}

// ── Queries ──────────────────────────────────────────────────────────

/**
 * Every delivery made against a task, oldest attempt first.
 *
 * Read as a history rather than a list: attempt 1 and the verdict that sent it
 * back, then attempt 2 and what happened to it. Nothing here was rewritten to
 * produce this — each row is the node its author signed.
 *
 * @param {object} db - The database.
 * @param {string} taskId
 * @param {Function} [callback] - Pass one to subscribe in real time.
 * @returns {Promise<object>} `{ results, unsubscribe? }`
 */
export const attemptsOfTask = (db, taskId, callback) =>
  db.map({ query: { type: "submission", taskId }, field: "attempt", order: "asc" }, callback)

/**
 * The deliveries that had to be made twice.
 *
 * An operator's question, not a demonstration of an operator: work that came
 * back tells you where the brief was unclear or the creator is struggling, and
 * it is the first filter anyone reaches for. The engine answers it with `$gt`
 * over the whole graph rather than the view fetching everything and counting —
 * which is what keeps it honest once the graph outgrows the screen.
 *
 * @param {object} db - The database.
 * @param {string} space
 * @param {Function} [callback] - Pass one to subscribe in real time.
 * @returns {Promise<object>} `{ results, unsubscribe? }`
 */
export const reworkedSubmissions = (db, space, callback) =>
  db.map(
    { query: { type: "submission", space, attempt: { $gt: 1 } }, field: "submittedAt", order: "desc" },
    callback
  )

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
