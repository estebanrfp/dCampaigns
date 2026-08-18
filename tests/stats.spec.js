/**
 * Stats as live queries: the figures follow the work, with nothing in between.
 *
 * The point is not that a number appears — it is that it appears *without a
 * service*. Every count here is recomputed on the device from the same signed
 * operations that produced the campaign, so a creator sees the same approval
 * rate the client does, and can check it against their own replica.
 */
import { expect, test } from "@playwright/test"
import { ALICE, BOB, SUPERADMIN, declareSide, openPeer, roleOf, signIn } from "./peers.js"

const SPACE = "stats"
const CODE = "code-4410"

test("figures follow the work, on both sides of it", async ({ browser }) => {
  const operator = await openPeer(browser, SUPERADMIN)

  const alice = await openPeer(browser, ALICE)
  await declareSide(alice.page, "client", "Acme Inc.")
  await expect(roleOf(alice.page)).toHaveText("client")

  await alice.page.getByRole("button", { name: "Client", exact: true }).first().click()
  await alice.page.locator("#space-slug").fill(SPACE)
  await alice.page.locator("#space-name").fill("Acme Inc.")
  await alice.page.locator("#space-password").fill(CODE)
  await alice.page.getByRole("button", { name: "Create" }).click()
  await signIn(alice.page, ALICE)

  // An empty room reports emptiness rather than a fake zero-shaped dashboard.
  await alice.page.getByRole("button", { name: "Client", exact: true }).first().click()
  await alice.page.getByRole("button", { name: "Stats" }).click()
  await expect(alice.page.getByText("approval rate")).toBeVisible()
  await expect(alice.page.getByText("median time to decide")).toBeVisible()

  // Put one piece of work through the whole cycle.
  await alice.page.getByRole("button", { name: "← Back" }).click()
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
  await bob.page.locator("#join-slug").fill(SPACE)
  await bob.page.locator("#join-password").fill(CODE)
  await bob.page.getByRole("button", { name: "Join" }).click()
  await signIn(bob.page, BOB)

  await expect(bob.page.getByText("Post a thread")).toBeVisible()
  await bob.page.getByRole("button", { name: "Submit work" }).click()
  await bob.page.locator("#post-url").fill("https://x.com/bob/status/9")
  await bob.page.locator("#proof").fill("3 posts")
  await bob.page.getByRole("button", { name: "Submit", exact: true }).click()

  // Before any verdict: one submission, awaiting review, no rate yet.
  await bob.page.getByRole("button", { name: "My stats" }).click()
  const bobPending = bob.page.locator(".card", { hasText: "awaiting review" })
  await expect(bobPending.locator(".stat-value")).toHaveText("1")

  // The client decides, and the figures move on their own — no reload, no
  // refresh button, nothing recalculated by a server.
  await alice.page.getByRole("button", { name: "← Campaigns" }).click()
  await alice.page.getByRole("button", { name: "Submissions" }).click()
  const card = alice.page.locator("[data-submission]").first()
  await expect(card).toBeVisible()
  await card.getByRole("button", { name: "Approve" }).click()
  await expect(card.locator(".verdict")).toContainText("approved")

  // The creator's own view updates from the same signed operation.
  await expect(bobPending.locator(".stat-value")).toHaveText("0")
  const bobRate = bob.page.locator(".card", { hasText: "approval rate" })
  await expect(bobRate.locator(".stat-value")).toHaveText("100%")

  // And the client sees the same number, because it is the same graph.
  await alice.page.getByRole("button", { name: "← Back" }).click()
  await alice.page.getByRole("button", { name: "Stats" }).click()
  const aliceRate = alice.page.locator(".card", { hasText: "approval rate" })
  await expect(aliceRate.locator(".stat-value")).toHaveText("100%")

  await operator.context.close()
  await alice.context.close()
  await bob.context.close()
})
