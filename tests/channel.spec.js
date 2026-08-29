/**
 * Evidence too large for the graph, carried by the peers instead.
 *
 * A replicated graph is the right home for a claim and the wrong one for a
 * large file: every peer would carry it forever whether or not anyone looks. So
 * above a threshold the record still goes in the graph — name, size and digest,
 * which is what the delivery is signed over — while the bytes stay on the
 * machine that made them and travel over a data channel to whoever asks.
 *
 * This asserts the split is real, not cosmetic: the node genuinely has no bytes
 * in it, and the reviewer still ends up holding the file, verified against the
 * fingerprint the delivery was signed with.
 */
import { expect, test } from "@playwright/test"
import { ALICE, BOB, ENGINE_URL, RUN, SUPERADMIN, createSpace, declareSide, enterSpace, openPeer, roleOf } from "./peers.js"

const SPACE = "channel"

// Comfortably over the 400 KB the graph will carry, and compressible enough to
// stay a quick test.
const BIG = 600 * 1024

test("evidence too large for the graph reaches the reviewer over a channel", async ({ browser }) => {
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
  await alice.page.locator("#task-title").fill("Record a walkthrough")
  await alice.page.locator("#task-req").fill("Screen capture, full length.")
  await alice.page.getByRole("button", { name: "Create" }).click()
  await expect(alice.page.getByText("Record a walkthrough")).toBeVisible()

  // ── A delivery with a file the graph will not carry ──────────────
  const bob = await openPeer(browser, BOB)
  await declareSide(bob.page, "creator", "Bob")
  await expect(roleOf(bob.page)).toHaveText("creator")
  await enterSpace(bob.page, SPACE)

  await expect(bob.page.getByText("Record a walkthrough")).toBeVisible()
  await bob.page.getByRole("button", { name: "Submit work" }).click()
  await bob.page.locator("#post-url").fill("https://example.com/walkthrough")
  await bob.page.locator("#proof").fill("full capture")
  await bob.page.locator("#proof-file").setInputFiles({
    name: "walkthrough.bin",
    mimeType: "application/octet-stream",
    // A recognisable head so the receiver can prove it got THIS file.
    buffer: Buffer.concat([Buffer.from("HEAD-OF-THE-REAL-FILE"), Buffer.alloc(BIG, 7)]),
  })
  await bob.page.getByRole("button", { name: "Submit", exact: true }).click()

  await alice.page.getByRole("button", { name: "Campaigns" }).click()
  // Going back re-renders the client's side; clicking straight through races
  // that render and lands back where it started. Wait for the list to settle.
  await expect(alice.page.getByRole("button", { name: "Open" })).toBeVisible()
  await alice.page.getByRole("button", { name: "Submissions" }).click()
  const card = alice.page.locator("[data-submission]").first()
  await expect(card).toBeVisible()
  await expect(card.getByText("walkthrough.bin")).toBeVisible()

  const submissionId = await card.getAttribute("data-submission")

  // ── The graph carries the claim and not the bytes ────────────────
  const inGraph = await alice.page.evaluate(
    async ([room, id, engineUrl]) => {
      const { gdb } = await import(engineUrl)
      const probe = await gdb(room, { rtc: false })
      const deadline = Date.now() + 25_000
      while (Date.now() < deadline) {
        const { result: delivery } = await probe.get(id)
        if (delivery?.value?.proofId) {
          const { result: proof } = await probe.get(delivery.value.proofId)
          if (proof?.value) {
            return {
              transport: proof.value.transport,
              hasBytes: Boolean(proof.value.data),
              size: proof.value.size,
              signedHash: delivery.value.proofHash,
            }
          }
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      return { timeout: true }
    },
    [`dcampaigns-${RUN}`, submissionId, ENGINE_URL]
  )

  expect(inGraph.transport, "the record says how the bytes travel").toBe("channel")
  expect(inGraph.hasBytes, "and the graph is not the one carrying them").toBe(false)
  expect(inGraph.size).toBeGreaterThan(400 * 1024)

  // ── Asking for it fetches it from the peer that holds it ─────────
  // Driven through the app's own reader, so this exercises the request,
  // the peer's answer, and the digest check the reviewer performs.
  const fetched = await alice.page.evaluate(
    async ([id, expectedHash]) => {
      const { readProof } = await import("/src/db/model.js")
      const { state } = await import("/src/state/app.js")
      const proof = await readProof(state.db, id, expectedHash)
      if (!proof) return { arrived: false }
      const head = new TextDecoder().decode((await proof.blob.arrayBuffer()).slice(0, 21))
      return { arrived: true, intact: proof.intact, size: proof.blob.size, head, name: proof.name }
    },
    [(await alice.page.evaluate(async ([room, sid, engineUrl]) => {
      const { gdb } = await import(engineUrl)
      const probe = await gdb(room, { rtc: false })
      return (await probe.get(sid)).result.value.proofId
    }, [`dcampaigns-${RUN}`, submissionId, ENGINE_URL])), inGraph.signedHash]
  )

  expect(fetched.arrived, "the peer holding it answered").toBe(true)
  expect(fetched.head, "and it is the file that was delivered").toBe("HEAD-OF-THE-REAL-FILE")
  expect(fetched.intact, "matching the fingerprint the delivery signed").toBe(true)
  expect(fetched.size).toBeGreaterThan(400 * 1024)

  await operator.context.close()
  await alice.context.close()
  await bob.context.close()
})
