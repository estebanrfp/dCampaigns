/**
 * Governance: a role is a signed grant that travels as data.
 *
 * This is the claim the whole product rests on, so it is the first thing under
 * test. Two genuinely separate peers: one runs the engine because a superadmin
 * is logged into it, the other only declares a side and waits. Nothing in the
 * second peer's browser can promote it — the grant has to arrive signed.
 */
import { expect, test } from "@playwright/test"
import { ALICE, SUPERADMIN, declareSide, openPeer, roleOf } from "./peers.js"

test("a declared side becomes a signed role, granted by another peer", async ({ browser }) => {
  // The authority. Governance only runs while a superadmin is present.
  const operator = await openPeer(browser, SUPERADMIN)
  await expect(roleOf(operator.page)).toHaveText("superadmin")

  // A newcomer, in a context that shares no storage with the operator.
  const alice = await openPeer(browser, ALICE)
  await declareSide(alice.page, "client", "Acme Inc.")

  // She cannot grant herself anything: she starts read-only…
  await expect(roleOf(alice.page)).toHaveText("guest")

  // …and the role arrives only because the operator's key signed it.
  // No sleep: the assertion retries while the rules cycle and the op replicates.
  await expect(roleOf(alice.page)).toHaveText("client")

  await operator.context.close()
  await alice.context.close()
})

test("with no superadmin present, nothing is granted", async ({ browser }) => {
  // The honest converse, and the reason a GenosSRV peer exists in production:
  // rules describe intent, but only a signature grants a role.
  const alice = await openPeer(browser, ALICE)
  await declareSide(alice.page, "creator", "Alice")

  await expect(roleOf(alice.page)).toHaveText("guest")
  // Still a guest after a full governance cycle would have run.
  await expect(roleOf(alice.page)).toHaveText("guest", { timeout: 10_000 })

  await alice.context.close()
})
