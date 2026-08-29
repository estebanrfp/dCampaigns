/**
 * Deciding many at once, and admitting it.
 *
 * Every review queue grows a "select all" the moment it is busy, and every
 * backend records the result as if it had not happened: fifty rows change
 * `status`, and nothing distinguishes fifty readings from one gesture. The
 * difference is the whole worth of a reviewer's judgement, and it is the first
 * thing a status column loses.
 *
 * Here the act is its own signed node naming what it covered, and each verdict
 * points back at it — so a delivery approved in a batch says so, and anyone
 * reading the record later can weigh it for themselves. That is not a feature
 * a centralised version withholds out of malice; it is one it cannot express.
 */
import { expect, test } from "@playwright/test"
import { ALICE, BOB, ENGINE_URL, RUN, SUPERADMIN, createSpace, declareSide, enterSpace, openPeer, roleOf } from "./peers.js"

const SPACE = "bulk"

test("deliveries decided together are recorded as one act", async ({ browser }) => {
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

  // Two tasks, so the creator can deliver twice.
  for (const title of ["Post a thread", "Post a recap"]) {
    await alice.page.getByRole("button", { name: "Add task" }).click()
    await alice.page.locator("#task-title").fill(title)
    await alice.page.locator("#task-req").fill("As briefed.")
    await alice.page.getByRole("button", { name: "Create" }).click()
    await expect(alice.page.getByText(title)).toBeVisible()
  }

  const bob = await openPeer(browser, BOB)
  await declareSide(bob.page, "creator", "Bob")
  await expect(roleOf(bob.page)).toHaveText("creator")
  await enterSpace(bob.page, SPACE)

  await expect(bob.page.getByText("Post a thread")).toBeVisible()
  for (const [i, url] of [["one", "https://example.com/one"], ["two", "https://example.com/two"]].entries()) {
    await bob.page.getByRole("button", { name: "Submit work" }).nth(0).click()
    await bob.page.locator("#post-url").fill(url[1])
    await bob.page.locator("#proof").fill(`delivery ${url[0]}`)
    await bob.page.getByRole("button", { name: "Submit", exact: true }).click()
    if (i === 0) await expect(bob.page.getByText("Post a recap")).toBeVisible()
  }

  // ── The reviewer's queue ─────────────────────────────────────────
  await alice.page.getByRole("button", { name: "← Campaigns" }).click()
  await alice.page.getByRole("button", { name: "Submissions" }).click()
  await expect(alice.page.locator("[data-submission]")).toHaveCount(2)

  // Nothing is selected, so the bar that acts on a selection is not there.
  await expect(alice.page.locator(".bulk-bar")).toBeHidden()

  // ── Select both and decide once ──────────────────────────────────
  await alice.page.locator(".pick").first().check()
  await expect(alice.page.locator(".bulk-bar")).toBeVisible()
  await expect(alice.page.getByText("1 selected")).toBeVisible()

  await alice.page.locator(".pick").nth(1).check()
  await expect(alice.page.getByText("2 selected")).toBeVisible()

  await alice.page.locator("#bulk-note").fill("Both fine, reviewed together")
  await alice.page.getByRole("button", { name: "Approve all" }).click()

  // Both carry the verdict, and the note the reviewer signed once.
  const cards = alice.page.locator("[data-submission]")
  await expect(cards.nth(0).locator(".verdict")).toContainText("approved")
  await expect(cards.nth(1).locator(".verdict")).toContainText("approved")
  await expect(cards.nth(0).locator(".verdict")).toContainText("reviewed together")

  // The selection is spent, so the bar stands down.
  await expect(alice.page.locator(".bulk-bar")).toBeHidden()

  // ── What the record says about how it happened ───────────────────
  // The claim this test exists for: the graph knows these were decided in one
  // act, and names which act — read from Bob's replica, not the deciding one.
  const batched = await bob.page.evaluate(
    async ([room, engineUrl]) => {
      // Bob's own persisted replica, read with no network: whatever is here
      // arrived signed and was accepted by his peer on its own merits.
      const { gdb } = await import(engineUrl)
      const probe = await gdb(room, { rtc: false })
      const deadline = Date.now() + 25_000
      while (Date.now() < deadline) {
        const approvals = await probe.map({ query: { type: "approval" } })
        const withBatch = approvals.results.filter((row) => row.value?.batchId)
        if (withBatch.length === 2) {
          const batches = await probe.map({ query: { type: "batch" } })
          return {
            approvals: withBatch.length,
            sameBatch: new Set(withBatch.map((row) => row.value.batchId)).size === 1,
            covers: batches.results[0]?.value?.covers?.length ?? 0,
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      return { timeout: true }
    },
    [`dcampaigns-${RUN}`, ENGINE_URL]
  )

  expect(batched.approvals, "both verdicts name the act they belong to").toBe(2)
  expect(batched.sameBatch, "and it is the same act").toBe(true)
  expect(batched.covers, "the act names everything it covered").toBe(2)

  await operator.context.close()
  await alice.context.close()
  await bob.context.close()
})
