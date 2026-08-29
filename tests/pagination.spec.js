/**
 * A queue longer than the screen.
 *
 * A review queue with filters and bulk selection is what any list becomes once
 * it is busy — and the moment it is busy, a view that loads every row is a view
 * that stops working. The window is the engine's
 * job here: `$limit` with a cursor that is a node id rather than an offset, so a
 * delivery arriving while somebody is reading page two does not shuffle the
 * page under them.
 *
 * The part worth asserting is that it stays *live* while paged. A paged read is
 * normally a snapshot — the ecosystem's own pagination example takes one — but
 * with `$limit` the engine also reports nodes entering and leaving the window,
 * so the list can be both bounded and current. Losing that would be a real
 * regression and an invisible one.
 */
import { expect, test } from "@playwright/test"
import { ALICE, BOB, SUPERADMIN, createSpace, declareSide, enterSpace, openPeer, roleOf } from "./peers.js"

const SPACE = "paging"
const PAGE_SIZE = 12
const DELIVERIES = 13 // one more than a page, so there is a second one

test("a long queue is paged, and the page stays live", async ({ browser }) => {
  const operator = await openPeer(browser, SUPERADMIN)

  const alice = await openPeer(browser, ALICE)
  await declareSide(alice.page, "client", "Acme Inc.")
  await expect(roleOf(alice.page)).toHaveText("client")
  await createSpace(alice.page, SPACE, "Acme Inc.")

  await alice.page.locator("#new-btn").click()
  await alice.page.locator("#campaign-title").fill("Launch week")
  await alice.page.locator("#campaign-brief").fill("Announce 2.0.")
  await alice.page.getByRole("button", { name: "Create" }).click()
  await alice.page.getByRole("button", { name: "Open" }).click()
  await alice.page.getByRole("button", { name: "Add task" }).click()
  await alice.page.locator("#task-title").fill("Post a thread")
  await alice.page.locator("#task-req").fill("Three posts.")
  await alice.page.getByRole("button", { name: "Create" }).click()
  await expect(alice.page.getByText("Post a thread")).toBeVisible()

  const bob = await openPeer(browser, BOB)
  await declareSide(bob.page, "creator", "Bob")
  await expect(roleOf(bob.page)).toHaveText("creator")
  await enterSpace(bob.page, SPACE)
  await expect(bob.page.getByText("Post a thread")).toBeVisible()

  // ── Fill the queue ───────────────────────────────────────────────
  // Through the model rather than the form: this test is about the window, and
  // driving thirteen dialogs would be testing the form thirteen times.
  const taskId = await bob.page.evaluate(async () => {
    const { state } = await import("/src/state/app.js")
    const { results } = await state.db.map({ query: { type: "task" } })
    return results[0].id
  })

  await bob.page.evaluate(
    async ([taskId, space, count]) => {
      const { submitWork } = await import("/src/db/model.js")
      const { state } = await import("/src/state/app.js")
      const { result: entry } = await state.db.get(`client:${space}`)
      for (let i = 1; i <= count; i += 1) {
        await submitWork(state.db, {
          space,
          taskId,
          postUrl: `https://example.com/delivery-${String(i).padStart(2, "0")}`,
          proof: `delivery ${i}`,
          creator: state.address,
          reviewer: entry.value.owner,
        })
        // Deliveries are ordered by the millisecond they were made, and a loop
        // writes faster than that clock ticks: without a pause all thirteen
        // share one timestamp, the sort has nothing to separate them, and which
        // twelve fill the window is arbitrary. People do not submit thirteen
        // pieces of work inside a millisecond; the pause is what makes this
        // data resemble the thing being tested.
        await new Promise((resolve) => setTimeout(resolve, 3))
      }
    },
    [taskId, SPACE, DELIVERIES]
  )

  // ── The reviewer's queue is bounded ──────────────────────────────
  await alice.page.getByRole("button", { name: "Campaigns" }).click()
  // Going back re-renders the client's side; clicking straight through races
  // that render and lands back where it started. Wait for the list to settle.
  await expect(alice.page.getByRole("button", { name: "Open" })).toBeVisible()
  await alice.page.getByRole("button", { name: "Submissions" }).click()

  await expect(alice.page.locator("[data-submission]")).toHaveCount(PAGE_SIZE)
  await expect(alice.page.getByText("Page 1")).toBeVisible()

  // Newest first, so the last delivery is on the first page and the first is not.
  await expect(alice.page.getByText("delivery-13")).toBeVisible()
  await expect(alice.page.getByText("delivery-01")).toHaveCount(0)

  // ── The second page holds the remainder ──────────────────────────
  await alice.page.getByRole("button", { name: "Older" }).click()
  await expect(alice.page.getByText("Page 2")).toBeVisible()
  await expect(alice.page.locator("[data-submission]")).toHaveCount(DELIVERIES - PAGE_SIZE)
  await expect(alice.page.getByText("delivery-01")).toBeVisible()

  // Nothing beyond it, and the control says so rather than leading nowhere.
  await expect(alice.page.getByRole("button", { name: "Older" })).toBeDisabled()

  await alice.page.getByRole("button", { name: "Newer" }).click()
  await expect(alice.page.getByText("Page 1")).toBeVisible()
  await expect(alice.page.locator("[data-submission]")).toHaveCount(PAGE_SIZE)

  // ── And the window is still a subscription ───────────────────────
  // A fourteenth delivery arrives while the reviewer is on page one. It belongs
  // at the top, so it enters the window and the oldest row of that window
  // leaves it — the engine reporting both, with nobody reloading anything.
  await bob.page.evaluate(
    async ([taskId, space]) => {
      const { submitWork } = await import("/src/db/model.js")
      const { state } = await import("/src/state/app.js")
      const { result: entry } = await state.db.get(`client:${space}`)
      await submitWork(state.db, {
        space,
        taskId,
        postUrl: "https://example.com/delivery-14-live",
        proof: "arrived while reading",
        creator: state.address,
        reviewer: entry.value.owner,
      })
    },
    [taskId, SPACE]
  )

  await expect(alice.page.getByText("delivery-14-live")).toBeVisible()
  await expect(alice.page.locator("[data-submission]")).toHaveCount(PAGE_SIZE)

  await operator.context.close()
  await alice.context.close()
  await bob.context.close()
})
