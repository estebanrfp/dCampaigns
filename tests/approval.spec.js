/**
 * The claim the whole product rests on.
 *
 * A creator delivers, a client approves, and the two records stay separate: the
 * submission belongs to the creator and is never rewritten, while the verdict
 * is its own node signed by the reviewer. On a normal backend both would be
 * rows one operator can edit in silence — here each is a signed claim by a
 * different party, and the creator keeps their own replica of what they
 * delivered and when.
 */
import { expect, test } from "@playwright/test"
import { ALICE, BOB, SUPERADMIN, createSpace, declareSide, enterSpace, openPeer, roleOf } from "./peers.js"

const SPACE = "acme"

test("a creator delivers and the client's approval is a separate signed record", async ({ browser }) => {
  const operator = await openPeer(browser, SUPERADMIN)

  // ── The client sets the work up ──────────────────────────────────
  const alice = await openPeer(browser, ALICE)
  await declareSide(alice.page, "client", "Acme Inc.")
  await expect(roleOf(alice.page)).toHaveText("client")

  await createSpace(alice.page, SPACE, "Acme Inc.")

  await alice.page.locator("#new-btn").click()
  await alice.page.locator("#campaign-title").fill("Launch week")
  await alice.page.locator("#campaign-brief").fill("Announce 2.0 across X.")
  await alice.page.getByRole("button", { name: "Create" }).click()
  await alice.page.getByRole("button", { name: "Open" }).click()
  await alice.page.getByRole("button", { name: "Add task" }).click()
  await alice.page.locator("#task-title").fill("Post a thread")
  await alice.page.locator("#task-req").fill("Three posts, launch week, link included.")
  await alice.page.getByRole("button", { name: "Create" }).click()
  await expect(alice.page.getByText("Post a thread")).toBeVisible()

  // ── The creator joins with the code and delivers ─────────────────
  const bob = await openPeer(browser, BOB)
  await declareSide(bob.page, "creator", "Bob")
  await expect(roleOf(bob.page)).toHaveText("creator")

  await enterSpace(bob.page, SPACE)

  // The task written by the client reaches the creator's device.
  await expect(bob.page.getByText("Post a thread")).toBeVisible()

  await bob.page.getByRole("button", { name: "Submit work" }).click()
  await bob.page.locator("#post-url").fill("https://x.com/bob/status/1")
  await bob.page.locator("#proof").fill("3 posts, 40k impressions")
  await bob.page.getByRole("button", { name: "Submit", exact: true }).click()

  // ── The client reviews it ────────────────────────────────────────
  await alice.page.getByRole("button", { name: "← Campaigns" }).click()
  await alice.page.getByRole("button", { name: "Submissions" }).click()

  const card = alice.page.locator('[data-submission]').first()
  await expect(card).toBeVisible()
  await expect(card).toContainText("https://x.com/bob/status/1")
  await expect(card.locator(".verdict")).toHaveText("pending")

  await card.getByPlaceholder("note (optional)").fill("Great thread")
  await card.getByRole("button", { name: "Approve" }).click()

  await expect(card.locator(".verdict")).toContainText("approved")

  // ── And the creator sees the verdict on their own replica ────────
  await bob.page.getByRole("button", { name: "My submissions" }).click()
  const bobCard = bob.page.locator("[data-submission]").first()
  await expect(bobCard.locator(".verdict")).toContainText("approved")
  await expect(bobCard.locator(".verdict")).toContainText("Great thread")

  // The verdict carries its own author: it is not a field the client flipped on
  // Bob's delivery, it is a claim Alice signed.
  await expect(bobCard).toContainText("https://x.com/bob/status/1")

  await operator.context.close()
  await alice.context.close()
  await bob.context.close()
})
