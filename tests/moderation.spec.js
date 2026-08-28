/**
 * What moderation actually costs.
 *
 * The product claims a submission belongs to its creator and is never
 * rewritten. But moderation over node-level ACLs is granted, never inherited,
 * so the operator is made a collaborator at creation time — and the ACL
 * middleware treats `delete` as covering writes:
 *
 *   collaborators[signer] === "write" || collaborators[signer] === "delete"
 *
 * If that holds, the operator can edit a delivery, and the claim is too strong
 * as written. This test finds out rather than assuming, because a promise about
 * who can rewrite what is the one thing this product sells.
 */
import { expect, test } from "@playwright/test"
import { ALICE, BOB, ENGINE_URL, RUN, SUPERADMIN, createSpace, declareSide, enterSpace, openPeer, roleOf } from "./peers.js"

const SPACE = "moderation"

test("what the operator can do to a delivery it did not make", async ({ browser }) => {
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
  await bob.page.getByRole("button", { name: "Submit work" }).click()
  await bob.page.locator("#post-url").fill("https://x.com/bob/status/77")
  await bob.page.locator("#proof").fill("the original proof")
  await bob.page.getByRole("button", { name: "Submit", exact: true }).click()

  await bob.page.getByRole("button", { name: "My submissions" }).click()
  const bobCard = bob.page.locator("[data-submission]").first()
  await expect(bobCard).toContainText("https://x.com/bob/status/77")
  const submissionId = await bobCard.getAttribute("data-submission")

  // The operator, from its own instance, tries to rewrite what Bob delivered.
  const attempt = await operator.page.evaluate(
    async ([room, id, mnemonic, superAdmin, engineUrl]) => {
      const { gdb } = await import(engineUrl)
      const db = await gdb(room, { rtc: true, sm: { superAdmins: [superAdmin], acls: true } })
      await db.sm.loginOrRecoverUserWithMnemonic(mnemonic)

      const deadline = Date.now() + 20_000
      let peers = 0
      while (Date.now() < deadline) {
        peers = Object.keys(db.room?.getPeers() ?? {}).length
        if (peers > 0) break
        await new Promise((r) => setTimeout(r, 250))
      }

      const { result } = await db.get(id)
      try {
        await db.put({ ...result.value, proof: "REWRITTEN BY THE PLATFORM" }, id)
        return { peers, threw: null }
      } catch (error) {
        return { peers, threw: error.message }
      }
    },
    [`dcampaigns-${RUN}`, submissionId, SUPERADMIN.mnemonic, SUPERADMIN.address, ENGINE_URL]
  )

  console.log("operator rewrite attempt:", JSON.stringify(attempt))
  expect(attempt.peers, "the attempt was broadcast").toBeGreaterThan(0)

  // The answer that matters is on the creator's own replica.
  await expect(bobCard).toContainText("the original proof", { timeout: 10_000 })
  await expect(bobCard).not.toContainText("REWRITTEN BY THE PLATFORM")

  await operator.context.close()
  await alice.context.close()
  await bob.context.close()
})
