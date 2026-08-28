/**
 * The identity governance cannot see.
 *
 * Observed in real use, and confirmed by reading the live graph: a node holding
 * `displayName`, `requestedSide` and `keyring` — and **no `role`** — while fresh
 * accounts were promoted normally.
 *
 * A rule matching `{ role: "guest" }` cannot reach a node without that field.
 * The account is not waiting, it is unreachable; and the interface prints
 * "guest" for it anyway, because that is the sensible fallback. Two mechanisms
 * conspiring to make a dead identity look like an ordinary newcomer.
 */
import { expect, test } from "@playwright/test"
import { APP_URL, BOB, ENGINE_URL, RUN, SUPERADMIN, openPeer, roleOf, signIn } from "./peers.js"

test("an identity whose node carries no role is repaired and promoted", async ({ browser }) => {
  const operator = await openPeer(browser, SUPERADMIN)
  await expect(roleOf(operator.page)).toHaveText("superadmin")

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(APP_URL)

  // Reproduce the observed shape exactly, from a second instance so the app
  // itself never gets a chance to write a role first.
  const before = await page.evaluate(
    async ([room, mnemonic, superAdmin, engineUrl]) => {
      const { gdb } = await import(engineUrl)
      const db = await gdb(room, { rtc: true, sm: { superAdmins: [superAdmin], acls: true } })
      const identity = await db.sm.loginOrRecoverUserWithMnemonic(mnemonic)
      await db.put(
        { displayName: "estebanrfp", requestedSide: "creator", keyring: "opaque" },
        `user:${identity.address}`
      )
      const { result } = await db.get(`user:${identity.address}`)
      return Object.keys(result?.value ?? {})
    },
    [`dcampaigns-${RUN}`, BOB.mnemonic, SUPERADMIN.address, ENGINE_URL]
  )

  expect(before, "the forged node reproduces the reported shape").not.toContain("role")

  // Now the app opens with that identity. It must notice and repair.
  await page.reload()
  await signIn(page, BOB)

  await expect(roleOf(page)).not.toHaveText("guest", { timeout: 25_000 })
  const after = await page.evaluate(async ([room, superAdmin, addr, engineUrl]) => {
    const { gdb } = await import(engineUrl)
    const db = await gdb(room, { rtc: true, sm: { superAdmins: [superAdmin], acls: true } })
    await new Promise(r => setTimeout(r, 3000))
    const { result } = await db.get(`user:${addr}`)
    return result?.value ?? null
  }, [`dcampaigns-${RUN}`, SUPERADMIN.address, BOB.address, ENGINE_URL])
  console.log("NODE AFTER:", JSON.stringify(after))

  // It reaches the base tier, not its declared side. The promotion is written
  // from the superadmin's replica, and when that replica is behind, the write
  // lands without `requestedSide` — so the rule for the side has nothing left
  // to match. Not fixed here: the app cannot make another peer's replica
  // complete. What this guards is that the identity is no longer unreachable.
  await expect(roleOf(page)).toHaveText("user", { timeout: 40_000 })


  await context.close()
  await operator.context.close()
})
