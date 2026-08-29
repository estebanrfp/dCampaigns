/**
 * The three sides, as three views over the same graph.
 *
 * Each view owns one subscription and tears it down when you leave it. Session
 * changes never re-subscribe — that is what freezes the other window.
 *
 * What the UI does here is *reflect* permissions; the engine enforces them. A
 * hidden button is a courtesy, and the signature on the operation is the
 * security.
 */
import {
  assignTask,
  awaitNode,
  createCampaign,
  createClientSpace,
  createTask,
  creators,
  decideSubmission,
  recordPayout,
  resubmitWork,
  submitWork,
  tasksOfCampaign,
} from "../db/model.js"
import { computeStats, humanDuration } from "../db/stats.js"
import { state } from "../state/app.js"
import { addr, clear, elt, liveList, when } from "./dom.js"
import { show, toast } from "./feedback.js"

const $ = (id) => document.getElementById(id)
const dom = {
  list: $("item-list"),
  listEmpty: $("list-empty"),
  content: $("content"),
  newBtn: $("new-btn"),
  search: $("search-input"),
  statusMeta: $("status-meta"),
}

/** @type {Function|null} Teardown for the view currently on screen. */
let unmount = null

/**
 * The verbs the live role may sign, mirrored from the constitution.
 *
 * One graph, one role: what governance signed on `user:<address>` is the same
 * authority everywhere. This only decides what to draw; `executeWithPermission`
 * decides what may be signed, and the peers decide what is accepted.
 */
const can = (verb) =>
  ({
    createCampaign: ["client", "superadmin"],
    assign: ["client", "superadmin"],
    approve: ["client", "superadmin"],
    submit: ["creator", "superadmin"],
  })[verb]?.includes(state.role) ?? false

const section = (title, ...children) =>
  elt("section", {}, elt("h2", { className: "section-title", textContent: title }), ...children)

/** A labelled field, because forms here are read once and filled deliberately. */
const field = (id, label, placeholder, type = "text") =>
  elt(
    "div",
    { className: "field" },
    elt("label", { textContent: label, attrs: { for: id } }),
    elt("input", { id, type, placeholder })
  )

// ── Spaces ───────────────────────────────────────────────────────────

/**
 * Enter a space. No password and no reload: a space is a view over the shared
 * graph, so entering one is a filter, not a connection.
 *
 * @param {string} slug
 */
const openSpace = (slug) => {
  if (slug === state.space) return
  state.space = slug
  state.selected = null
  render()
}

/** One catalogue entry in the sidebar. */
const spaceItem = (value, excerpt) =>
  elt(
    "li",
    {
      className: "item",
      attrs: { "aria-current": String(value.slug === state.space) },
      onclick: () => openSpace(value.slug),
    },
    elt("div", { className: "item-title", textContent: value.name || value.slug }),
    elt("div", { className: "item-excerpt", textContent: excerpt })
  )

/** Subscribe the sidebar to a catalogue query, keeping the empty state honest. */
const spacesInSidebar = async (query, excerpt, emptyText) => {
  clear(dom.list)
  const draw = liveList(dom.list, ({ value }) => spaceItem(value, excerpt))
  const subscription = await state.db.map(
    { query, field: "createdAt", order: "desc" },
    (event) => {
      draw(event)
      show(dom.listEmpty, !dom.list.children.length)
    }
  )
  dom.listEmpty.textContent = emptyText
  show(dom.listEmpty, !dom.list.children.length)
  return subscription
}

// ── Creator ──────────────────────────────────────────────────────────

/** The creator's side: the catalogue of spaces, and the tasks inside one. */
const mountCreator = async () => {
  dom.newBtn.title = "Spaces are created by clients"
  dom.newBtn.disabled = true
  dom.newBtn.onclick = null

  const catalogue = await spacesInSidebar(
    { type: "client" },
    "Client space",
    "No spaces yet. A client creates the first one."
  )

  const content = state.space ? await renderTasks() : renderLobby()
  return () => {
    catalogue.unsubscribe?.()
    if (typeof content === "function") content()
  }
}

/** Nothing selected yet: say what the catalogue is instead of showing a void. */
const renderLobby = () => {
  clear(dom.content)
  dom.content.append(
    section(
      "Pick a space",
      elt("p", {
        className: "hint",
        textContent:
          "Every client space lives in the shared catalogue. Open one to see its tasks — what keeps each client's work theirs is the signature on every node, verified by every peer.",
      })
    )
  )
}

/** Tasks in the open space, live. */
const renderTasks = async () => {
  clear(dom.content)
  const list = elt("div", { className: "card-grid" })
  dom.content.append(
    section(
      `Tasks · ${state.space}`,
      elt(
        "div",
        { className: "row" },
        elt("button", { textContent: "My submissions", onclick: () => renderSubmissions() }),
        elt("button", { textContent: "My stats", onclick: () => renderStats() })
      ),
      list
    )
  )

  const { unsubscribe } = await state.db.map(
    { query: { type: "task", space: state.space }, field: "createdAt", order: "desc" },
    liveList(list, ({ id, value }) =>
      elt(
        "article",
        { className: "card" },
        elt("div", { className: "item-title", textContent: value.title }),
        elt("p", { className: "item-excerpt", textContent: value.requirements }),
        elt(
          "div",
          { className: "row spread" },
          // A task asked of someone else is still visible — the graph is shared
          // and pretending otherwise would be theatre — but it is not yours.
          elt("span", {
            className: "stat-label",
            textContent: !value.assignee
              ? "open to anyone"
              : value.assignee === state.address
                ? "asked of you"
                : `asked of ${state.db.sm.abbrAddr(value.assignee)}`,
          }),
          elt("span", { className: "verdict", dataset: { verdict: "pending" }, textContent: value.status })
        ),
        // Disabled, not hidden: a locked control teaches the trust model,
        // a missing one just looks broken.
        elt("button", {
          textContent: "Submit work",
          disabled: !can("submit") || (value.assignee && value.assignee !== state.address),
          title: !can("submit")
            ? "Earn the creator role to deliver"
            : value.assignee && value.assignee !== state.address
              ? "This task was asked of someone else"
              : "Submit work for this task",
          onclick: () => renderSubmitForm(id, value),
        })
      )
    )
  )
  return unsubscribe
}

/** Deliver against a task. The node is owned by its creator and never rewritten. */
const renderSubmitForm = (taskId, task) => {
  clear(dom.content)
  dom.content.append(
    section(
      `Submit · ${task.title}`,
      field("post-url", "Link to the work", "https://…"),
      field("proof", "Proof", "screenshot link, metrics, anything verifiable"),
      elt("button", {
        className: "primary",
        textContent: "Submit",
        onclick: async () => {
          try {
            const postUrl = $("post-url").value.trim()
            const proof = $("proof").value.trim()
            // The reviewer is the space's owner — read from the catalogue
            // entry, whose `owner` the engine stamped and every peer defends.
            const entry = await awaitNode(state.db, `client:${state.space}`)
            if (!entry) return toast("This space is missing from the catalogue", "error")
            await submitWork(state.db, {
              space: state.space,
              taskId,
              postUrl,
              proof,
              creator: state.address,
              reviewer: entry.value.owner,
            })
            toast("Submitted — the delivery is yours and stays yours", "success")
            await render()
          } catch (error) {
            toast(error.message ?? "Could not submit", "error")
          }
        },
      })
    )
  )
}

// ── Stats ────────────────────────────────────────────────────────────

/** A single figure: the number first, what it counts underneath. */
const stat = (value, label) =>
  elt(
    "div",
    { className: "card" },
    elt("div", { className: "stat-value", textContent: value }),
    elt("div", { className: "stat-label", textContent: label })
  )

/** One bar carrying the three outcomes, sized by share. */
const outcomeBar = ({ approved, rejected, pending }) => {
  const total = approved + rejected + pending
  if (!total) return null

  const fill = (count, verdict) =>
    count
      ? elt("span", {
          className: "bar-fill",
          dataset: { verdict },
          attrs: { style: `width:${(count / total) * 100}%` },
        })
      : null

  const key = (verdict, count, label) =>
    elt(
      "span",
      {},
      elt("span", { className: "legend-key bar-fill", dataset: { verdict } }),
      document.createTextNode(`${label} ${count}`)
    )

  return elt(
    "div",
    {},
    elt("div", { className: "bar" }, fill(approved, "approved"), fill(rejected, "rejected"), fill(pending, "pending")),
    elt(
      "div",
      { className: "legend" },
      key("approved", approved, "approved"),
      key("rejected", rejected, "rejected"),
      key("pending", pending, "pending")
    )
  )
}

/**
 * The state of the space, as numbers.
 *
 * A reviewer sees the whole space; a creator sees their own work. Both are
 * derived from the same signed operations, which is what lets a creator check
 * the figures against their own replica instead of taking them on trust.
 *
 * Recomputed from one subscription: any change in the space re-runs the
 * queries. There is no analytics service to be out of date.
 */
const renderStats = async () => {
  unmount?.()
  unmount = null

  const reviewing = can("approve")
  const scope = reviewing ? { space: state.space } : { space: state.space, creator: state.address }

  const draw = async () => {
    const s = await computeStats(state.db, scope)
    clear(dom.content)

    const figures = elt(
      "div",
      { className: "stat-grid" },
      reviewing ? stat(s.campaigns, "campaigns") : null,
      reviewing ? stat(`${s.tasksDelivered}/${s.tasks}`, "tasks delivered") : null,
      stat(s.submissions, "submissions"),
      stat(s.pending, reviewing ? "awaiting your review" : "awaiting review"),
      stat(s.approvalRate == null ? "—" : `${Math.round(s.approvalRate * 100)}%`, "approval rate"),
      stat(humanDuration(s.medianWait), "median time to decide"),
      reviewing ? stat(s.creators, "creators delivering") : null
    )

    dom.content.append(
      section(
        reviewing ? `Stats · ${state.space}` : "My stats",
        elt("div", { className: "row" }, elt("button", { textContent: "← Back", onclick: () => render() })),
        figures,
        outcomeBar(s),
        // Say what is not here, so nobody reads a number that does not exist.
        elt("p", {
          className: "note",
          textContent:
            "Computed on this device from signed operations — every figure can be checked against your own replica. Audience figures are not here: they live wherever the work was published, and no peer can verify them.",
        })
      )
    )
  }

  await draw()

  // One subscription over the space: anything that lands re-runs the figures.
  const { unsubscribe } = await state.db.map({ query: { space: state.space } }, () => draw())
  unmount = unsubscribe
}

// ── Submissions & verdicts ───────────────────────────────────────────

/**
 * One delivery, and room for the verdict on it.
 *
 * The card is keyed by the submission id so the verdict — which arrives as a
 * separate node, signed by whoever decided — can be painted onto it when it
 * lands, without the submission itself ever being rewritten.
 */
const submissionCard = (id, value, reviewing) => {
  const slot = elt("span", { className: "verdict", dataset: { verdict: "pending" }, textContent: "pending" })

  // Deciding and what-comes-next share one slot: a delivery is either awaiting
  // a verdict or acting on the one it got, never both. The verdict arrives on
  // its own subscription, so this is filled in by `paintVerdict`.
  const actions = elt("div", { className: "row", dataset: { actions: id } })
  if (reviewing) {
    actions.append(
      elt("input", { type: "text", placeholder: "note (optional)", dataset: { note: id } }),
      elt("button", { textContent: "Approve", onclick: () => decide(id, value, "approved") }),
      elt("button", { className: "danger", textContent: "Reject", onclick: () => decide(id, value, "rejected") })
    )
  }

  // An attempt beyond the first is worth saying out loud: it is the history the
  // model refuses to overwrite, and the reviewer is reading a second answer to
  // a brief they already sent back once.
  const heading = value.attempt > 1
    ? elt("div", { className: "row spread" },
        elt("div", { className: "item-title", textContent: value.postUrl || "(no link)" }),
        elt("span", { className: "attempt-tag", textContent: `attempt ${value.attempt}` }))
    : elt("div", { className: "item-title", textContent: value.postUrl || "(no link)" })

  return elt(
    "article",
    // The creator rides on the card so a verdict can be judged against it the
    // moment it is painted: a self-signed approval is refused without a lookup.
    { className: "card", dataset: { submission: id, creator: value.creator } },
    heading,
    elt("p", { className: "item-excerpt", textContent: value.proof }),
    elt("div", { className: "row spread" }, addr(state.db, value.creator), slot),
    actions
  )
}

/**
 * Decide on a delivery.
 *
 * The verdict is written as its own node owned by the reviewer — never as a
 * field on the submission. That is the whole point: the record of what was
 * delivered and the record of what was decided are separate claims by separate
 * people, and each is verifiable on its own.
 */
const decide = async (submissionId, submission, verdict) => {
  try {
    await state.db.sm.executeWithPermission("approve")
  } catch {
    return toast("Your role does not hold `approve`", "warning")
  }
  try {
    await decideSubmission(state.db, {
      space: state.space,
      submissionId,
      verdict,
      note: document.querySelector(`[data-note="${CSS.escape(submissionId)}"]`)?.value.trim() ?? "",
      reviewer: state.address,
      creator: submission.creator,
    })
    toast(`Submission ${verdict}`, verdict === "approved" ? "success" : "info")
  } catch (error) {
    toast(error.message ?? "Could not record the decision", "error")
  }
}

/**
 * Paint a verdict onto the card it belongs to, if that card is on screen.
 *
 * The engine guarantees nobody rewrites a foreign node — on every sync path,
 * since genosdb 0.27.x. What it cannot know is this app's convention that
 * `approval:<submissionId>` is a deterministic id: a creator could CREATE that
 * node first, own it, and thereby block — or fake — the verdict on their own
 * work. So one check stands between the graph and the pixel: a verdict whose
 * reviewer is the delivery's own creator is void, on every peer.
 */
const paintVerdict = (root, value) => {
  const card = root.querySelector(`[data-submission="${CSS.escape(value.submissionId)}"]`)
  const slot = card?.querySelector(".verdict")
  if (!slot) return

  // A self-signed verdict is not a verdict.
  if (card.dataset.creator && value.reviewer === card.dataset.creator) return

  slot.dataset.verdict = value.verdict
  slot.textContent = value.note ? `${value.verdict} · ${value.note}` : value.verdict

  // The decision has been made, so the controls that make it are done — and
  // what replaces them is whatever this identity can legitimately do next.
  const actions = card.querySelector(`[data-actions]`)
  if (!actions) return
  clear(actions)

  const mine = card.dataset.creator === state.address
  if (value.verdict === "rejected" && mine) {
    actions.append(
      elt("button", {
        className: "primary",
        textContent: "Deliver again",
        onclick: () => renderResubmitForm(value.submissionId),
      })
    )
    return
  }

  if (value.verdict === "approved" && can("approve") && !mine) {
    actions.append(
      elt("input", { type: "text", placeholder: "amount", dataset: { amount: value.submissionId } }),
      elt("button", {
        textContent: "Record payment",
        onclick: () => payFor(value.submissionId, card.dataset.creator),
      })
    )
  }
}

/**
 * Settle an approved delivery.
 *
 * A signed statement by the payer, owned by them, sitting beside the approval
 * rather than inside it. No money moves here — the decision is what has to be
 * attributable, and a rail can be hung off a signed instruction later.
 */
const payFor = async (submissionId, creator) => {
  const raw = document.querySelector(`[data-amount="${CSS.escape(submissionId)}"]`)?.value.trim()
  const amount = Number(raw)
  if (!raw || !Number.isFinite(amount) || amount <= 0) return toast("Enter an amount first", "error")
  try {
    await recordPayout(state.db, {
      space: state.space,
      submissionId,
      amount,
      currency: "USD",
      payer: state.address,
      creator,
    })
    toast("Payment recorded — signed by you", "success")
  } catch (error) {
    toast(error.message ?? "Could not record the payment", "error")
  }
}

/** Paint a settled payment onto the delivery it belongs to. */
const paintPayout = (root, value) => {
  const card = root.querySelector(`[data-submission="${CSS.escape(value.submissionId)}"]`)
  const actions = card?.querySelector(`[data-actions]`)
  if (!actions) return
  clear(actions)
  actions.append(
    elt("span", {
      className: "verdict",
      dataset: { verdict: "paid" },
      textContent: `paid ${value.amount} ${value.currency}`,
    })
  )
}

/**
 * Deliver again, after a rejection.
 *
 * A new attempt, not an edit: the rejected one keeps the verdict that rejected
 * it, and both stay on the record.
 */
const renderResubmitForm = async (submissionId) => {
  const { result } = await state.db.get(submissionId)
  if (!result) return toast("That delivery is no longer here", "error")

  clear(dom.content)
  dom.content.append(
    section(
      `Deliver again · attempt ${(result.value.attempt ?? 1) + 1}`,
      elt("p", {
        className: "note",
        textContent:
          "The rejected delivery stays exactly as it is, with the reviewer's signed verdict attached. This is a new attempt beside it, not a correction of it.",
      }),
      field("post-url", "Link to the work", "https://…"),
      field("proof", "Proof", "screenshot link, metrics, anything verifiable"),
      elt(
        "div",
        { className: "row" },
        elt("button", { textContent: "← Back", onclick: () => renderSubmissions() }),
        elt("button", {
          className: "primary",
          textContent: "Submit attempt",
          onclick: async () => {
            try {
              // The reviewer is the space's owner, read from the catalogue entry
              // whose `owner` the engine stamped — the same source the first
              // attempt used.
              const entry = await awaitNode(state.db, `client:${state.space}`)
              if (!entry) return toast("This space is missing from the catalogue", "error")
              await resubmitWork(state.db, { id: submissionId, value: result.value }, {
                postUrl: $("post-url").value.trim(),
                proof: $("proof").value.trim(),
                reviewer: entry.value.owner,
              })
              toast("Delivered again — the earlier attempt stays on the record", "success")
              await renderSubmissions()
            } catch (error) {
              toast(error.message ?? "Could not deliver again", "error")
            }
          },
        })
      )
    )
  )
}

/**
 * The deliveries in the open space.
 *
 * A reviewer sees every submission; a creator sees only their own — not as a
 * privacy boundary (the graph replicates to both) but because a creator's own
 * deliveries are the only ones they can act on.
 */
const renderSubmissions = async () => {
  unmount?.()
  unmount = null

  const reviewing = can("approve")
  clear(dom.content)
  const list = elt("div", { className: "card-grid" })
  dom.content.append(
    section(
      reviewing ? "Submissions" : "My submissions",
      elt("div", { className: "row" }, elt("button", { textContent: "← Back", onclick: () => render() })),
      list
    )
  )

  // What is known about each delivery, kept beside the list.
  //
  // Three subscriptions feed one card, and a card can be rebuilt at any moment:
  // linking a resubmission to the attempt it answers touches that attempt, so
  // its row is re-rendered and arrives blank. Without somewhere to read the
  // verdict back from, a delivery that was rejected minutes ago silently
  // returns to "pending" — the interface forgetting something the graph still
  // knows. So each claim is remembered here and re-applied after any render.
  const known = { verdicts: new Map(), payouts: new Map() }
  const repaint = (id) => {
    const verdict = known.verdicts.get(id)
    if (verdict) paintVerdict(list, verdict)
    const payout = known.payouts.get(id)
    if (payout) paintPayout(list, payout)
  }

  const rows = liveList(list, ({ id, value }) => submissionCard(id, value, reviewing))
  const submissions = await state.db.map(
    {
      query: reviewing
        ? { type: "submission", space: state.space }
        : { type: "submission", space: state.space, creator: state.address },
      field: "submittedAt",
      order: "desc",
    },
    (event) => {
      rows(event)
      repaint(event.id)
    }
  )

  // Verdicts are their own nodes, so they get their own subscription.
  const verdicts = await state.db.map({ query: { type: "approval", space: state.space } }, ({ value, action }) => {
    if (action === "removed" || !value) return
    known.verdicts.set(value.submissionId, value)
    paintVerdict(list, value)
  })

  // And so is the payment: three claims by three moments, which is the shape of
  // the data rather than an accident of it.
  const payouts = await state.db.map({ query: { type: "payout", space: state.space } }, ({ value, action }) => {
    if (action === "removed" || !value) return
    known.payouts.set(value.submissionId, value)
    paintPayout(list, value)
  })

  unmount = () => {
    submissions.unsubscribe?.()
    verdicts.unsubscribe?.()
    payouts.unsubscribe?.()
  }
}

// ── Client ───────────────────────────────────────────────────────────

/** The client's side: their spaces, and the campaigns inside the open one. */
const mountClient = async () => {
  dom.newBtn.title = can("createCampaign") ? "New campaign" : "Your role does not hold `createCampaign`"
  dom.newBtn.disabled = !can("createCampaign")
  dom.newBtn.onclick = () => renderCampaignForm()

  const mine = await spacesInSidebar(
    { type: "client", owner: state.address },
    "Your space",
    "No spaces yet. Create one."
  )

  const content = state.space ? await renderCampaigns() : renderSpaceForm()
  return () => {
    mine.unsubscribe?.()
    if (typeof content === "function") content()
  }
}

/** Create a client space: a catalogue entry the engine stamps as yours. */
const renderSpaceForm = () => {
  clear(dom.content)
  dom.content.append(
    section(
      "Create a client space",
      elt("p", {
        className: "hint",
        textContent:
          "The entry is signed as yours the moment it is created — no other identity can rewrite it, on any peer. There is no access code: creators find the space in the catalogue, and every node inside it carries its author's signature.",
      }),
      field("space-slug", "Slug", "acme"),
      field("space-name", "Name", "Acme Inc."),
      elt("button", {
        className: "primary",
        textContent: "Create",
        onclick: async () => {
          const slug = $("space-slug").value.trim()
          if (!slug) return toast("A slug is required", "error")
          try {
            await createClientSpace(state.db, {
              slug,
              name: $("space-name").value.trim() || slug,
            })
            openSpace(slug)
          } catch (error) {
            toast(error.message ?? "Could not create the space", "error")
          }
        },
      })
    )
  )
}

/** Campaigns in the open space, live, each with its tasks one traversal away. */
const renderCampaigns = async () => {
  clear(dom.content)
  const list = elt("div", { className: "card-grid" })
  dom.content.append(
    section(
      `Campaigns · ${state.space}`,
      elt(
        "div",
        { className: "row" },
        elt("button", { textContent: "Submissions", onclick: () => renderSubmissions() }),
        elt("button", { textContent: "Stats", onclick: () => renderStats() })
      ),
      list
    )
  )

  const { unsubscribe } = await state.db.map(
    { query: { type: "campaign", space: state.space }, field: "createdAt", order: "desc" },
    liveList(list, ({ id, value }) =>
      elt(
        "article",
        { className: "card" },
        elt("div", { className: "item-title", textContent: value.title }),
        elt("p", { className: "item-excerpt", textContent: value.brief }),
        elt(
          "div",
          { className: "row spread" },
          elt("span", { className: "addr", textContent: when(value.createdAt) }),
          elt("button", { textContent: "Open", onclick: () => renderCampaign(id, value) })
        )
      )
    )
  )
  return unsubscribe
}

/**
 * One campaign and everything hanging off it.
 *
 * The tasks come from a single traversal: the campaign is the starting point
 * and the sub-query filters its descendants, so the graph answers "what belongs
 * to this campaign" without the app joining anything by hand.
 */
const renderCampaign = async (campaignId, campaign) => {
  unmount?.()
  unmount = null

  clear(dom.content)
  const list = elt("div", { className: "card-grid" })
  dom.content.append(
    section(
      campaign.title,
      elt("p", { className: "item-excerpt", textContent: campaign.brief }),
      elt(
        "div",
        { className: "row" },
        elt("button", { textContent: "← Campaigns", onclick: () => render() }),
        elt("button", {
          className: "primary",
          textContent: "Add task",
          disabled: !can("assign"),
          title: can("assign") ? "Add a task to this campaign" : "Only the client can assign work",
          onclick: () => renderTaskForm(campaignId, campaign),
        })
      ),
      list
    )
  )

  const { results } = await creators(state.db)
  const nameOf = new Map(
    results.map(({ id, value }) => [
      id.replace(/^user:/, ""),
      value.displayName?.trim() || state.db.sm.abbrAddr(id.replace(/^user:/, "")),
    ])
  )

  const { unsubscribe } = await tasksOfCampaign(state.db, campaignId, (event) =>
    liveList(list, ({ id, value }) =>
      elt(
        "article",
        { className: "card" },
        elt("div", { className: "item-title", textContent: value.title }),
        elt("p", { className: "item-excerpt", textContent: value.requirements }),
        elt(
          "div",
          { className: "row spread" },
          // Who was asked. An unassigned task says so rather than saying nothing.
          elt("span", {
            className: "stat-label",
            textContent: value.assignee
              ? `→ ${nameOf.get(value.assignee) ?? state.db.sm.abbrAddr(value.assignee)}`
              : "open to anyone",
          }),
          elt("span", { className: "verdict", dataset: { verdict: "pending" }, textContent: value.status })
        ),
        can("assign")
          ? elt("button", {
              textContent: value.assignee ? "Reassign" : "Assign",
              onclick: () => renderAssignForm(id, value, campaignId, campaign),
            })
          : null
      )
    )(event)
  )
  unmount = unsubscribe
}

/** Change who a task is asked of — or reopen it to the space. */
const renderAssignForm = async (taskId, task, campaignId, campaign) => {
  unmount?.()
  const picker = await creatorPicker("assign-to", task.assignee)
  unmount = picker.unsubscribe

  clear(dom.content)
  dom.content.append(
    section(
      `Assign · ${task.title}`,
      picker.node,
      elt(
        "div",
        { className: "row" },
        elt("button", { textContent: "← Back", onclick: () => renderCampaign(campaignId, campaign) }),
        elt("button", {
          className: "primary",
          textContent: "Save",
          onclick: async () => {
            try {
              await state.db.sm.executeWithPermission("assign")
            } catch {
              return toast("Your role does not hold `assign`", "warning")
            }
            await assignTask(state.db, taskId, $("assign-to").value || null)
            toast("Task assigned", "success")
            await renderCampaign(campaignId, campaign)
          },
        })
      )
    )
  )
}

const renderCampaignForm = () => {
  if (!state.space) return toast("Open a space first", "warning")
  clear(dom.content)
  dom.content.append(
    section(
      "New campaign",
      field("campaign-title", "Title", "Launch week"),
      field("campaign-brief", "Brief", "what the campaign is for"),
      elt("button", {
        className: "primary",
        textContent: "Create",
        onclick: async () => {
          try {
            await state.db.sm.executeWithPermission("createCampaign")
          } catch {
            return toast("Your role does not hold `createCampaign`", "warning")
          }
          await createCampaign(state.db, {
            space: state.space,
            title: $("campaign-title").value.trim(),
            brief: $("campaign-brief").value.trim(),
          })
          toast("Campaign created", "success")
          await render()
        },
      })
    )
  )
}

/**
 * A picker of the creators on the platform.
 *
 * "Anyone" is a real choice, not a placeholder: an open task is how a client
 * puts work up for whoever gets to it first, and it is the default because a
 * client often does not know yet who should take it.
 *
 * @param {string} id - Element id.
 * @param {string|null} [selected]
 */
const creatorPicker = async (id, selected = null) => {
  const select = elt("select", { id })
  select.append(elt("option", { value: "", textContent: "Anyone in this space" }))

  // Live, not a snapshot: a creator who declares their side while this form is
  // open has to appear in it. Reading the roster once means the one person the
  // client was waiting for is the one who never shows up.
  const { unsubscribe } = await state.db.map(
    { query: { requestedSide: "creator" } },
    ({ id: nodeId, value, action }) => {
      const address = nodeId.replace(/^user:/, "")
      const existing = select.querySelector(`option[value="${CSS.escape(address)}"]`)

      if (action === "removed") return existing?.remove()

      const label = value.displayName?.trim() || state.db.sm.abbrAddr(address)
      if (existing) return (existing.textContent = label)

      const option = elt("option", { value: address, textContent: label })
      if (address === selected) option.selected = true
      select.append(option)
    }
  )

  const node = elt(
    "div",
    { className: "field" },
    elt("label", { textContent: "Assign to", attrs: { for: id } }),
    select
  )
  return { node, unsubscribe }
}

const renderTaskForm = async (campaignId, campaign) => {
  unmount?.()
  const picker = await creatorPicker("task-assignee")
  unmount = picker.unsubscribe

  clear(dom.content)
  dom.content.append(
    section(
      `New task · ${campaign.title}`,
      field("task-title", "Title", "Post a thread about the launch"),
      field("task-req", "Requirements", "what counts as done"),
      picker.node,
      elt("p", {
        className: "note",
        textContent: "Creators appear here as they declare their side on the platform.",
      }),
      elt("button", {
        className: "primary",
        textContent: "Create",
        onclick: async () => {
          await createTask(state.db, {
            space: state.space,
            campaignId,
            title: $("task-title").value.trim(),
            requirements: $("task-req").value.trim(),
            assignee: $("task-assignee").value || null,
          })
          toast("Task created", "success")
          await renderCampaign(campaignId, campaign) // back to where it now lives
        },
      })
    )
  )
}

// ── Admin ────────────────────────────────────────────────────────────

/**
 * The operator's side: the people on the platform and the catalogue of spaces.
 * The operator arbitrates roles; the work inside a space is its members' own,
 * each node defended by its author's signature.
 */
const mountAdmin = async () => {
  dom.newBtn.disabled = true
  dom.newBtn.title = "Nothing to create here"

  clear(dom.list)
  clear(dom.content)
  const spaces = elt("div", { className: "card-grid" })
  dom.content.append(section("Client spaces", spaces))

  const drawPerson = liveList(dom.list, ({ id, value }) => {
    // The Security Manager keys these nodes by address; the value carries the
    // role, not the identity, so the address comes from the id.
    const address = id.replace(/^user:/, "")
    const role = value.role ?? "guest"

    // What the operator is here to arbitrate: the side someone asked for
    // against the role they actually hold. A guest that asked months ago and
    // never got promoted is invisible unless both are on screen.
    const waiting = value.requestedSide && value.requestedSide !== role

    return elt(
      "li",
      { className: "item" },
      elt(
        "div",
        { className: "row spread" },
        elt("span", {
          className: "item-title",
          textContent: value.displayName?.trim() || state.db.sm.abbrAddr(address),
        }),
        elt("span", { className: "role-tag", dataset: { role }, textContent: role })
      ),
      elt(
        "div",
        { className: "row spread" },
        addr(state.db, address),
        waiting
          ? elt("span", {
              className: "verdict",
              dataset: { verdict: "pending" },
              textContent: `asked for ${value.requestedSide}`,
            })
          : null
      )
    )
  })

  /**
   * The operator is chrome, not content.
   *
   * Who you are is already in the top bar; repeating it as the only row in a
   * directory of participants says nothing and makes an empty platform look
   * populated. The list is the people this panel exists to oversee.
   */
  const people = (event) => {
    if (event.id === `user:${state.address}`) return
    drawPerson(event)
    show(dom.listEmpty, !dom.list.children.length)
  }

  const users = await state.db.map({ query: { role: { $exists: true } } }, people)
  const catalogue = await state.db.map(
    { query: { type: "client" }, field: "createdAt", order: "desc" },
    liveList(spaces, ({ value }) =>
      elt(
        "article",
        { className: "card" },
        elt("div", { className: "item-title", textContent: value.name }),
        elt("div", { className: "item-excerpt", textContent: value.slug }),
        addr(state.db, value.owner)
      )
    )
  )

  // An honest empty state: nobody has joined the platform yet.
  dom.listEmpty.textContent = "No clients or creators yet."
  show(dom.listEmpty, !dom.list.children.length)

  return () => {
    users.unsubscribe?.()
    catalogue.unsubscribe?.()
  }
}

// ── Router ───────────────────────────────────────────────────────────

const VIEWS = { creator: mountCreator, client: mountClient, admin: mountAdmin }

/** Draw the current side, tearing down whatever was on screen. */
export const render = async () => {
  unmount?.()
  unmount = null

  document.querySelectorAll(".side-btn").forEach((button) =>
    button.setAttribute("aria-current", String(button.dataset.side === state.side))
  )

  dom.statusMeta.textContent = state.space
    ? `${state.space} · client space`
    : "catalogue · one shared graph"

  if (!state.address) {
    clear(dom.list)
    clear(dom.content)
    dom.content.append(elt("div", { className: "empty", textContent: "Sign in to see your side." }))
    return
  }

  const teardown = await VIEWS[state.side]()
  if (typeof teardown === "function") unmount = teardown

  // A guest is waiting on somebody else's signature, and has no way to know it.
  // Saying so is the difference between "this is broken" and "this is how it
  // works" — the engine only runs while a superadmin has a window open.
  if (state.role === "guest") {
    dom.content.prepend(
      elt("p", {
        className: "note",
        textContent:
          "You are a guest: read-only until a superadmin signs your role. The engine that grants it runs in a superadmin's window — if none is open, nothing is signed and this does not change.",
      })
    )
  }
}
