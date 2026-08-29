/**
 * The evidence itself, and the fingerprint that pins it.
 *
 * A link to a file host is the last part of a delivery that still asks the
 * reviewer to trust a server: it can 404, change hands, or serve different
 * bytes tomorrow than it served when the work was accepted. The file travels in
 * the graph instead, and its digest is written into the *delivery* — signed
 * before any verdict exists.
 *
 * That ordering is the whole point. On a backend, whoever can write the row can
 * swap the attachment afterwards and nothing disagrees; the approval still says
 * "approved" and now points at a different file. Here the delivery named the
 * file it was making a claim about, so a swap is detectable by anyone holding a
 * replica — including the creator, against the client, and the client, against
 * the creator.
 */
import { expect, test } from "@playwright/test"
import { ALICE, BOB, ENGINE_URL, RUN, SUPERADMIN, createSpace, declareSide, enterSpace, openPeer, roleOf } from "./peers.js"

const SPACE = "evidence"

test("the attached file is pinned by a fingerprint the delivery signed", async ({ browser }) => {
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

  // ── The creator delivers, with the file rather than a link to one ─
  const bob = await openPeer(browser, BOB)
  await declareSide(bob.page, "creator", "Bob")
  await expect(roleOf(bob.page)).toHaveText("creator")
  await enterSpace(bob.page, SPACE)

  await expect(bob.page.getByText("Post a thread")).toBeVisible()
  await bob.page.getByRole("button", { name: "Submit work" }).click()
  await bob.page.locator("#post-url").fill("https://example.com/thread")
  await bob.page.locator("#proof").fill("three posts, as briefed")
  await bob.page.locator("#proof-file").setInputFiles({
    name: "screenshot.png",
    mimeType: "image/png",
    buffer: Buffer.from("the original evidence, byte for byte"),
  })
  await bob.page.getByRole("button", { name: "Submit", exact: true }).click()

  // ── It reaches the reviewer as a file, not a promise of one ──────
  await alice.page.getByRole("button", { name: "Campaigns" }).click()
  // Going back re-renders the client's side; clicking straight through races
  // that render and lands back where it started. Wait for the list to settle.
  await expect(alice.page.getByRole("button", { name: "Open" })).toBeVisible()
  await alice.page.getByRole("button", { name: "Submissions" }).click()
  const card = alice.page.locator("[data-submission]").first()
  await expect(card).toBeVisible()
  await expect(card.getByText("screenshot.png")).toBeVisible()

  // ── On the reviewer's own replica, the bytes match what was signed ─
  const submissionId = await card.getAttribute("data-submission")
  const check = await alice.page.evaluate(
    async ([room, id, engineUrl]) => {
      const { gdb } = await import(engineUrl)
      const probe = await gdb(room, { rtc: false })

      const digest = async (bytes) =>
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")

      const deadline = Date.now() + 25_000
      while (Date.now() < deadline) {
        const { result: delivery } = await probe.get(id)
        const proofId = delivery?.value?.proofId
        if (proofId) {
          const { result: proof } = await probe.get(proofId)
          if (proof?.value?.data) {
            const bytes = Uint8Array.from(atob(proof.value.data), (c) => c.charCodeAt(0))
            return {
              signedHash: delivery.value.proofHash,
              actualHash: await digest(bytes.buffer),
              text: new TextDecoder().decode(bytes),
              name: proof.value.name,
            }
          }
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      return { timeout: true }
    },
    [`dcampaigns-${RUN}`, submissionId, ENGINE_URL]
  )

  expect(check.text, "the bytes themselves crossed, not a URL").toBe("the original evidence, byte for byte")
  expect(check.name).toBe("screenshot.png")
  expect(check.actualHash, "and they are the ones the delivery was signed over").toBe(check.signedHash)

  // ── Now swap the file, the way a backend would let you ───────────
  // Bob rewrites his own evidence node — which the ACL permits, because it is
  // his. What it cannot do is change the fingerprint already signed into the
  // delivery, and that is what makes the substitution visible to everyone.
  const swapped = await bob.page.evaluate(
    async ([room, id, engineUrl, superAdmin, mnemonic]) => {
      const { gdb } = await import(engineUrl)
      const db = await gdb(room, { rtc: true, sm: { superAdmins: [superAdmin], acls: true } })
      await db.sm.loginOrRecoverUserWithMnemonic(mnemonic)

      const { result: delivery } = await db.get(id)
      const proofId = delivery.value.proofId
      const { result: proof } = await db.get(proofId)
      await db.sm.acls.set({ ...proof.value, data: btoa("a different file entirely") }, proofId)

      const digest = async (bytes) =>
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      const bytes = Uint8Array.from(atob((await db.get(proofId)).result.value.data), (c) => c.charCodeAt(0))
      return { signedHash: delivery.value.proofHash, actualHash: await digest(bytes.buffer) }
    },
    [`dcampaigns-${RUN}`, submissionId, ENGINE_URL, SUPERADMIN.address, BOB.mnemonic]
  )

  // The substitution succeeded — it is his node — and it is exactly as loud as
  // it should be: the bytes no longer answer to the name the delivery signed.
  expect(swapped.actualHash).not.toBe(swapped.signedHash)

  await operator.context.close()
  await alice.context.close()
  await bob.context.close()
})
