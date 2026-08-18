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
import { enterRoomAndReload } from "../db/rooms.js"
import {
  createCampaign,
  createClientSpace,
  createTask,
  decideSubmission,
  rememberRoom,
  submitWork,
  tasksOfCampaign,
} from "../db/model.js"
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
 * This reads the role held in the *directory*, which is the identity's side.
 * The room enforces its own copy — roles are stored per graph — so this only
 * decides what to draw; `executeWithPermission` on the tenant decides what may
 * be signed, and the peers decide what is accepted.
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

// ── Creator ──────────────────────────────────────────────────────────

/**
 * The creator's side: the rooms they hold a key to, and the tasks inside them.
 */
const mountCreator = async () => {
  dom.newBtn.title = "Join a client space"
  dom.newBtn.disabled = !state.address
  dom.newBtn.onclick = () => renderJoinForm()

  clear(dom.list)
  state.keyring.forEach((entry) =>
    dom.list.append(
      elt(
        "li",
        {
          className: "item",
          dataset: { id: entry.slug },
          attrs: { "aria-current": String(entry.slug === state.tenantSlug) },
          onclick: () => enterRoom(entry),
        },
        elt("div", { className: "item-title", textContent: entry.slug }),
        elt("div", { className: "item-excerpt", textContent: "Client space" })
      )
    )
  )
  show(dom.listEmpty, !state.keyring.length)
  dom.listEmpty.textContent = "No spaces yet. Join one with its code."

  if (!state.tenant) return renderJoinForm()
  return renderTasks()
}

/** Ask for the room code. It travels out of band — never through the graph. */
const renderJoinForm = () => {
  clear(dom.content)
  dom.content.append(
    section(
      "Join a client space",
      elt("p", {
        className: "hint",
        textContent:
          "The code is the room password: without it the handshake never completes, so the space's data never reaches this device.",
      }),
      field("join-slug", "Space", "acme"),
      field("join-password", "Access code", "shared with you by the client", "password"),
      elt(
        "button",
        {
          className: "primary",
          textContent: "Join",
          onclick: async () => {
            const slug = $("join-slug").value.trim()
            const password = $("join-password").value
            if (!slug || !password) return toast("Both fields are required", "error")

            const { result } = await state.directory.get(`client:${slug}`)
            if (!result) return toast("No such space in the directory", "error")

            // The keyring is written first: entering restarts the app, and a
            // room whose code was never saved would be lost on the way in.
            const entry = { slug, password, owner: result.value.owner }
            await rememberRoom(state.directory, state.address, entry)
            enterRoom(entry)
          },
        }
      )
    )
  )
}

/**
 * Enter a tenant room.
 *
 * This restarts the app rather than opening the database in place: every room
 * has to exist before the identity door, or the new Security Manager clears the
 * signer this session is already using. See the note in `db/rooms.js`.
 *
 * @param {{slug: string, password: string, owner: string}} entry
 */
const enterRoom = (entry) => {
  if (entry.slug === state.tenantSlug) return
  enterRoomAndReload(entry)
}

/** Tasks in the open room, live. */
const renderTasks = async () => {
  clear(dom.content)
  const list = elt("div", { className: "card-grid" })
  dom.content.append(
    section(
      `Tasks · ${state.tenantSlug}`,
      elt(
        "div",
        { className: "row" },
        elt("button", { textContent: "My submissions", onclick: () => renderSubmissions() })
      ),
      list
    )
  )

  const { unsubscribe } = await state.tenant.map(
    { query: { type: "task" }, field: "createdAt", order: "desc" },
    liveList(list, ({ id, value }) =>
      elt(
        "article",
        { className: "card" },
        elt("div", { className: "item-title", textContent: value.title }),
        elt("p", { className: "item-excerpt", textContent: value.requirements }),
        elt(
          "div",
          { className: "row spread" },
          elt("span", { className: "verdict", dataset: { verdict: "pending" }, textContent: value.status }),
          // Disabled, not hidden: a locked control teaches the trust model,
          // a missing one just looks broken.
          elt("button", {
            textContent: "Submit work",
            disabled: !can("submit"),
            title: can("submit") ? "Submit work for this task" : "Earn the creator role to deliver",
            onclick: () => renderSubmitForm(id, value),
          })
        )
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
      field("post-url", "Post URL", "https://x.com/…"),
      field("proof", "Proof", "screenshot link, metrics, anything verifiable"),
      elt("button", {
        className: "primary",
        textContent: "Submit",
        onclick: async () => {
          try {
            await submitWork(state.tenant, {
              taskId,
              postUrl: $("post-url").value.trim(),
              proof: $("proof").value.trim(),
              creator: state.address,
              reviewer: state.keyring.find((k) => k.slug === state.tenantSlug)?.owner,
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

  const actions = reviewing
    ? elt(
        "div",
        { className: "row" },
        elt("input", { type: "text", placeholder: "note (optional)", dataset: { note: id } }),
        elt("button", {
          textContent: "Approve",
          onclick: () => decide(id, value, "approved"),
        }),
        elt("button", {
          className: "danger",
          textContent: "Reject",
          onclick: () => decide(id, value, "rejected"),
        })
      )
    : null

  return elt(
    "article",
    { className: "card", dataset: { submission: id } },
    elt("div", { className: "item-title", textContent: value.postUrl || "(no link)" }),
    elt("p", { className: "item-excerpt", textContent: value.proof }),
    elt("div", { className: "row spread" }, addr(state.tenant, value.creator), slot),
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
    await state.tenant.sm.executeWithPermission("approve")
  } catch {
    return toast("Your role does not hold `approve`", "warning")
  }
  try {
    await decideSubmission(state.tenant, {
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

/** Paint a verdict onto the card it belongs to, if that card is on screen. */
const paintVerdict = (root, value) => {
  const card = root.querySelector(`[data-submission="${CSS.escape(value.submissionId)}"]`)
  const slot = card?.querySelector(".verdict")
  if (!slot) return
  slot.dataset.verdict = value.verdict
  slot.textContent = value.note ? `${value.verdict} · ${value.note}` : value.verdict
}

/**
 * The deliveries in the open room.
 *
 * A reviewer sees every submission; a creator sees only their own — not as a
 * privacy boundary (the room replicates to both) but because a creator's own
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

  const submissions = await state.tenant.map(
    {
      query: reviewing ? { type: "submission" } : { type: "submission", creator: state.address },
      field: "submittedAt",
      order: "desc",
    },
    liveList(list, ({ id, value }) => submissionCard(id, value, reviewing))
  )

  // Verdicts are their own nodes, so they get their own subscription and are
  // painted onto whichever cards are already on screen.
  const verdicts = await state.tenant.map({ query: { type: "approval" } }, ({ value, action }) => {
    if (action !== "removed" && value) paintVerdict(list, value)
  })

  unmount = () => {
    submissions.unsubscribe?.()
    verdicts.unsubscribe?.()
  }
}

// ── Client ───────────────────────────────────────────────────────────

/** The client's side: their spaces, and the campaigns inside the open one. */
const mountClient = async () => {
  dom.newBtn.title = can("createCampaign") ? "New campaign" : "Your role does not hold `createCampaign`"
  dom.newBtn.disabled = !can("createCampaign")
  dom.newBtn.onclick = () => renderCampaignForm()

  clear(dom.list)
  const mine = state.keyring.filter((entry) => entry.owner === state.address)
  mine.forEach((entry) =>
    dom.list.append(
      elt(
        "li",
        {
          className: "item",
          dataset: { id: entry.slug },
          attrs: { "aria-current": String(entry.slug === state.tenantSlug) },
          onclick: () => enterRoom(entry),
        },
        elt("div", { className: "item-title", textContent: entry.slug }),
        elt("div", { className: "item-excerpt", textContent: "Your space" })
      )
    )
  )
  show(dom.listEmpty, !mine.length)
  dom.listEmpty.textContent = "No spaces yet. Create one."

  if (!state.tenant) return renderSpaceForm()
  return renderCampaigns()
}

/** Create a client space: a catalogue entry, plus the room behind it. */
const renderSpaceForm = () => {
  clear(dom.content)
  dom.content.append(
    section(
      "Create a client space",
      elt("p", {
        className: "hint",
        textContent:
          "The access code never reaches the directory — it is the room password, and a secret in a public graph is no secret. Share it with your creators yourself.",
      }),
      field("space-slug", "Slug", "acme"),
      field("space-name", "Name", "Acme Inc."),
      field("space-password", "Access code", "choose one", "password"),
      elt("button", {
        className: "primary",
        textContent: "Create",
        onclick: async () => {
          const slug = $("space-slug").value.trim()
          const password = $("space-password").value
          if (!slug || !password) return toast("Slug and access code are required", "error")
          try {
            await createClientSpace(state.directory, {
              slug,
              name: $("space-name").value.trim() || slug,
              owner: state.address,
            })
            await rememberRoom(state.directory, state.address, { slug, password, owner: state.address })
            enterRoom({ slug, password, owner: state.address })
          } catch (error) {
            toast(error.message ?? "Could not create the space", "error")
          }
        },
      })
    )
  )
}

/** Campaigns in the open room, live, each with its tasks one traversal away. */
const renderCampaigns = async () => {
  clear(dom.content)
  const list = elt("div", { className: "card-grid" })
  dom.content.append(
    section(
      `Campaigns · ${state.tenantSlug}`,
      elt(
        "div",
        { className: "row" },
        elt("button", { textContent: "Submissions", onclick: () => renderSubmissions() })
      ),
      list
    )
  )

  const { unsubscribe } = await state.tenant.map(
    { query: { type: "campaign" }, field: "createdAt", order: "desc" },
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

  const { unsubscribe } = await tasksOfCampaign(state.tenant, campaignId, (event) =>
    liveList(list, ({ value }) =>
      elt(
        "article",
        { className: "card" },
        elt("div", { className: "item-title", textContent: value.title }),
        elt("p", { className: "item-excerpt", textContent: value.requirements }),
        elt("span", { className: "verdict", dataset: { verdict: "pending" }, textContent: value.status })
      )
    )(event)
  )
  unmount = unsubscribe
}

const renderCampaignForm = () => {
  if (!state.tenant) return toast("Open a space first", "warning")
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
            await state.tenant.sm.executeWithPermission("createCampaign")
          } catch {
            return toast("Your role does not hold `createCampaign`", "warning")
          }
          await createCampaign(state.tenant, {
            title: $("campaign-title").value.trim(),
            brief: $("campaign-brief").value.trim(),
            owner: state.address,
          })
          toast("Campaign created", "success")
          await render()
        },
      })
    )
  )
}

const renderTaskForm = (campaignId, campaign) => {
  clear(dom.content)
  dom.content.append(
    section(
      `New task · ${campaign.title}`,
      field("task-title", "Title", "Post a thread about the launch"),
      field("task-req", "Requirements", "what counts as done"),
      elt("button", {
        className: "primary",
        textContent: "Create",
        onclick: async () => {
          await createTask(state.tenant, {
            campaignId,
            title: $("task-title").value.trim(),
            requirements: $("task-req").value.trim(),
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
 * The operator's side: the public directory, which is all an operator can see
 * without holding a room's key. That limit is the design, not a gap — a room
 * whose code nobody handed over stays closed to the platform too.
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
          textContent: value.displayName?.trim() || state.directory.sm.abbrAddr(address),
        }),
        elt("span", { className: "role-tag", dataset: { role }, textContent: role })
      ),
      elt(
        "div",
        { className: "row spread" },
        addr(state.directory, address),
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

  const users = await state.directory.map({ query: { role: { $exists: true } } }, people)
  const catalogue = await state.directory.map(
    { query: { type: "client" }, field: "createdAt", order: "desc" },
    liveList(spaces, ({ value }) =>
      elt(
        "article",
        { className: "card" },
        elt("div", { className: "item-title", textContent: value.name }),
        elt("div", { className: "item-excerpt", textContent: value.slug }),
        addr(state.directory, value.owner)
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

  dom.statusMeta.textContent = state.tenantSlug
    ? `${state.tenantSlug} · isolated room`
    : "directory · public graph"

  if (!state.address) {
    clear(dom.list)
    clear(dom.content)
    dom.content.append(elt("div", { className: "empty", textContent: "Sign in to see your side." }))
    return
  }

  const teardown = await VIEWS[state.side]()
  if (typeof teardown === "function") unmount = teardown
}
