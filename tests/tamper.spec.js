/**
 * The adversarial case — the one that decides whether any of this is worth
 * building distributed.
 *
 * A creator whose work was rejected runs code we did not write: a second
 * GenosDB instance, their real key, no UI in the way. They sign an operation
 * that flips the verdict on their own delivery. That is not a hypothetical —
 * it is a `db.put` away for anyone who opens a console.
 *
 * If the network accepts it, the product is a lie: an approval would be a row
 * anyone can edit. If every honest peer rejects it, then an approval really is
 * a claim by the person who signed it, and the creator's own replica of what
 * they delivered cannot be rewritten by the client either.
 */
import { expect, test } from "@playwright/test"
import { ALICE, BOB, RUN, SUPERADMIN, declareSide, openPeer, roleOf, signIn } from "./peers.js"

const SPACE = "tamper"
const CODE = "code-9182"

test("a rejected creator cannot sign their own approval", async ({ browser }) => {
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

  await alice.page.getByRole("button", { name: "Client", exact: true }).first().click()
  await alice.page.locator("#new-btn").click()
  await alice.page.locator("#campaign-title").fill("Launch week")
  await alice.page.locator("#campaign-brief").fill("Announce 2.0.")
  await alice.page.getByRole("button", { name: "Create" }).click()
  await alice.page.getByRole("button", { name: "Open" }).click()
  await alice.page.getByRole("button", { name: "Add task" }).click()
  await alice.page.locator("#task-title").fill("Post a thread")
  await alice.page.locator("#task-req").fill("Three posts.")
  await alice.page.getByRole("button", { name: "Create" }).click()
  // Wait for the task to land before moving on: without this the next steps
  // race the render, and the campaign view may not be on screen yet.
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
  await bob.page.locator("#post-url").fill("https://x.com/bob/status/2")
  await bob.page.locator("#proof").fill("thin proof")
  await bob.page.getByRole("button", { name: "Submit", exact: true }).click()

  // The client rejects it, on the record.
  await alice.page.getByRole("button", { name: "← Campaigns" }).click()
  await alice.page.getByRole("button", { name: "Submissions" }).click()
  const aliceCard = alice.page.locator("[data-submission]").first()
  await expect(aliceCard).toBeVisible()
  await aliceCard.getByPlaceholder("note (optional)").fill("Does not meet the brief")
  await aliceCard.getByRole("button", { name: "Reject" }).click()
  await expect(aliceCard.locator(".verdict")).toContainText("rejected")

  // Bob sees the rejection, and the UI offers him no way to change it.
  await bob.page.getByRole("button", { name: "My submissions" }).click()
  const bobCard = bob.page.locator("[data-submission]").first()
  await expect(bobCard.locator(".verdict")).toContainText("rejected")
  await expect(bobCard.getByRole("button", { name: "Approve" })).toHaveCount(0)

  const submissionId = await bobCard.getAttribute("data-submission")

  // ── The tampered client ──────────────────────────────────────────
  // Bob's own key, his own GenosDB instance, no interface in the way.
  const attack = await bob.page.evaluate(
    async ([room, id, mnemonic, superAdmin, owner, password]) => {
      // The same engine the app loads, from the same path: a tampered client is
      // ordinary code with the user's key, not a different library.
      const { gdb } = await import("/genosdb/index.js")
      const db = await gdb(room, {
        rtc: true,
        password,
        sm: { superAdmins: [superAdmin, owner], acls: true },
      })
      await db.sm.loginOrRecoverUserWithMnemonic(mnemonic)

      // The attack only means anything if it was actually broadcast. Wait for
      // the tampered instance to have peers, and report how many — a forged op
      // that never left the machine would prove nothing.
      const deadline = Date.now() + 20_000
      let peers = 0
      while (Date.now() < deadline) {
        peers = Object.keys(db.room?.getPeers() ?? {}).length
        if (peers > 0) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      try {
        // Forgery A — self-signed: Bob approves his own delivery, naming
        // himself the reviewer. Refused by every honest peer on sight: nobody
        // decides on their own work.
        await db.put({ type: "approval", submissionId: id, verdict: "approved", note: "self-approved", reviewer: db.sm.getActiveEthAddress(), decidedAt: Date.now() }, `approval:${id}`)
        // Forgery B — impersonation: Bob writes the client's own address as the
        // reviewer, with a newer clock, to overwrite the honest verdict by
        // last-write-wins on any peer that reconciles state instead of ops.
        // The client's device draws its verdict from the copy it kept off the
        // graph, so the flip never reaches the one screen that decides.
        await db.put({ type: "approval", submissionId: id, verdict: "approved", note: "impersonated", reviewer: owner, decidedAt: Date.now() + 1 }, `approval:${id}`)
        const { result } = await db.get(`approval:${id}`)
        return { threw: null, localVerdict: result?.value?.verdict ?? null, peers }
      } catch (error) {
        return { threw: error.message, localVerdict: null, peers }
      }
    },
    [
      `dcampaigns-${RUN}-c-${SPACE}`,
      submissionId,
      BOB.mnemonic,
      SUPERADMIN.address,
      ALICE.address,
      CODE,
    ]
  )

  // Whatever happened on Bob's machine, the network's answer is what counts:
  // the client's peer still shows the verdict its owner signed.
  await expect(aliceCard.locator(".verdict")).toContainText("rejected")
  await expect(aliceCard.locator(".verdict")).not.toContainText("approved")

  // And it stays that way — long enough for a forged op to have propagated.
  await expect(aliceCard.locator(".verdict")).toContainText("rejected", { timeout: 8_000 })

  console.log("tampered client result:", JSON.stringify(attack))
  expect(attack.peers, "the tampered client was connected, so the forged op was broadcast").toBeGreaterThan(0)

  await operator.context.close()
  await alice.context.close()
  await bob.context.close()
})
