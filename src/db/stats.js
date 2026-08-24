/**
 * Statistics, as live queries over the graph.
 *
 * There is no analytics service and no nightly job: every number here is
 * computed on the device, from the same signed operations that produced the
 * work. That has a consequence worth stating plainly — a creator can verify
 * these figures against their own replica. An approval rate is not what the
 * platform says it is; it is what the signatures add up to.
 *
 * What is deliberately absent: reach, impressions, engagement. Those live on
 * whatever platform the work was published to, not in this graph, and no
 * peer-to-peer mesh can verify a number it cannot see. They arrive with an
 * integration or not at all — inventing them here would be a figure nobody
 * could stand behind.
 */

/**
 * Aggregate the state of a client's room.
 *
 * @param {object} db - The tenant instance.
 * @param {{creator?: string}} [scope] - Restrict to one creator's own work.
 * @returns {Promise<object>} Counters, rates and turnaround.
 */
export const computeStats = async (db, { creator } = {}) => {
  const [campaigns, tasks, submissions, approvals] = await Promise.all([
    db.map({ query: { type: "campaign" } }),
    db.map({ query: { type: "task" } }),
    db.map({ query: creator ? { type: "submission", creator } : { type: "submission" } }),
    db.map({ query: { type: "approval" } }),
  ])

  // Verdicts are separate nodes, so a submission's outcome is a lookup, not a
  // field — which is exactly why nobody can flip it without signing for it.
  const verdictOf = new Map(
    approvals.results.map(({ value }) => [value.submissionId, value])
  )

  const delivered = new Set(submissions.results.map(({ value }) => value.taskId))
  const decided = submissions.results.filter(({ id }) => verdictOf.has(id))
  const approved = decided.filter(({ id }) => verdictOf.get(id).verdict === "approved")

  // How long a creator waits for an answer. In a marketplace of three parties
  // this is the client's side of the bargain, and here it is auditable.
  const waits = decided.map(({ id, value }) => verdictOf.get(id).decidedAt - value.submittedAt)
  const medianWait = waits.length
    ? waits.sort((a, b) => a - b)[Math.floor(waits.length / 2)]
    : null

  return {
    campaigns: campaigns.results.length,
    tasks: tasks.results.length,
    tasksDelivered: delivered.size,
    submissions: submissions.results.length,
    pending: submissions.results.length - decided.length,
    approved: approved.length,
    rejected: decided.length - approved.length,
    approvalRate: decided.length ? approved.length / decided.length : null,
    medianWait,
    creators: new Set(submissions.results.map(({ value }) => value.creator)).size,
  }
}

/**
 * A duration a person can read at a glance.
 *
 * @param {number|null} ms
 * @returns {string}
 */
export const humanDuration = (ms) => {
  if (ms == null) return "—"
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}
