/**
 * The whole life of one piece of work, and the thing a status column cannot do.
 *
 * A delivery comes back rejected, the creator delivers again, the second
 * attempt is accepted and the client records what they owe for it. Four claims
 * by two people at four moments — and every one of them survives: the rejected
 * attempt keeps the verdict that rejected it, and the reason is still readable
 * after the work has been paid for.
 *
 * On a backend this is one row whose `status` walked from `pending` to `paid`,
 * and the rejection is gone the moment it stops being true. Here nothing is
 * overwritten, so the record answers what was asked, what came back, why, what
 * changed, and what was settled — each signed by whoever said it.
 */
import { expect, test } from "@playwright/test"
import { ALICE, BOB, SUPERADMIN, createSpace, declareSide, enterSpace, openPeer, roleOf } from "./peers.js"

const SPACE = "lifecycle"

test("a rejected delivery is answered by a second attempt, and both stay on the record", async ({ browser }) => {
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

  // ── Attempt 1 ────────────────────────────────────────────────────
  const bob = await openPeer(browser, BOB)
  await declareSide(bob.page, "creator", "Bob")
  await expect(roleOf(bob.page)).toHaveText("creator")
  await enterSpace(bob.page, SPACE)

  await expect(bob.page.getByText("Post a thread")).toBeVisible()
  await bob.page.getByRole("button", { name: "Submit work" }).click()
  await bob.page.locator("#post-url").fill("https://example.com/first")
  await bob.page.locator("#proof").fill("one post, thin")
  await bob.page.getByRole("button", { name: "Submit", exact: true }).click()

  // ── The client sends it back, with a reason ──────────────────────
  await alice.page.getByRole("button", { name: "← Campaigns" }).click()
  await alice.page.getByRole("button", { name: "Submissions" }).click()
  const firstCard = alice.page.locator("[data-submission]").first()
  await expect(firstCard).toBeVisible()
  await firstCard.getByPlaceholder("note").fill("Only one post, the brief asked for three")
  await firstCard.getByRole("button", { name: "Reject" }).click()
  await expect(firstCard.locator(".verdict")).toContainText("rejected")

  // ── The creator answers it ───────────────────────────────────────
  await bob.page.getByRole("button", { name: "My submissions" }).click()
  const bobFirst = bob.page.locator("[data-submission]").first()
  await expect(bobFirst.locator(".verdict")).toContainText("rejected")
  // The reason travelled with the verdict — it is not a UI string, it is the
  // note the reviewer signed.
  await expect(bobFirst.locator(".verdict")).toContainText("Only one post")

  // The rejection is what offers the way forward. A creator is never given a
  // control that edits the delivery that was judged.
  await expect(bobFirst.getByRole("button", { name: "Approve" })).toHaveCount(0)
  await bobFirst.getByRole("button", { name: "Deliver again" }).click()

  await bob.page.locator("#post-url").fill("https://example.com/second")
  await bob.page.locator("#proof").fill("three posts, as asked")
  await bob.page.getByRole("button", { name: "Submit attempt" }).click()

  // Two deliveries now, and the second says which attempt it is.
  await expect(bob.page.locator("[data-submission]")).toHaveCount(2)
  await expect(bob.page.getByText("attempt 2")).toBeVisible()

  // ── The client accepts the second and records what it owes ───────
  const secondCard = alice.page.locator("[data-submission]").filter({ hasText: "second" })
  await expect(secondCard).toBeVisible()
  await secondCard.getByRole("button", { name: "Approve" }).click()
  await expect(secondCard.locator(".verdict")).toContainText("approved")

  await secondCard.getByPlaceholder("amount").fill("250")
  await secondCard.getByRole("button", { name: "Record payment" }).click()
  await expect(secondCard.getByText("paid 250 USD")).toBeVisible()

  // ── What the record still says ───────────────────────────────────
  // The point of the whole test: after the work is paid for, the attempt that
  // was sent back is still there, still rejected, still carrying its reason.
  const rejected = alice.page.locator("[data-submission]").filter({ hasText: "first" })
  await expect(rejected.locator(".verdict")).toContainText("rejected")
  await expect(rejected.locator(".verdict")).toContainText("Only one post")

  // And the creator sees the settlement on their own replica, signed by the
  // payer — the proof they were told they would be paid, held by the person
  // who would need it.
  await expect(bob.page.getByText("paid 250 USD")).toBeVisible()

  await operator.context.close()
  await alice.context.close()
  await bob.context.close()
})
