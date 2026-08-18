/**
 * Your keys outlive your promotions.
 *
 * The keyring used to be a field on `user:<address>`, which is the one node the
 * governance engine rewrites. Observed directly: after a promotion the node was
 * left as `{ role, ethAddress, assignedByEthAddress, expiresAt }` and nothing
 * else — every application field gone, the encrypted room passwords with them.
 * Accounts survived it only because the app happened to rewrite them soon
 * enough, which is a race whose losing outcome is losing access to your own
 * client spaces.
 *
 * It lives in a node of its own now. This asserts the property that matters:
 * a role change must not cost you a room you were admitted to.
 */
import { expect, test } from "@playwright/test"
import { ALICE, RUN, SUPERADMIN, declareSide, openPeer, roleOf, signIn } from "./peers.js"

const SPACE = "keyring"
const CODE = "code-3390"

test("a role assignment does not take the room keys with it", async ({ browser }) => {
  const operator = await openPeer(browser, SUPERADMIN)

  const alice = await openPeer(browser, ALICE)
  await declareSide(alice.page, "client", "Acme Inc.")
  await expect(roleOf(alice.page)).toHaveText("client")

  // A space, which is what puts a key in the keyring.
  await alice.page.getByRole("button", { name: "Client", exact: true }).first().click()
  await alice.page.locator("#space-slug").fill(SPACE)
  await alice.page.locator("#space-name").fill("Acme Inc.")
  await alice.page.locator("#space-password").fill(CODE)
  await alice.page.getByRole("button", { name: "Create" }).click()
  await signIn(alice.page, ALICE)
  await expect(alice.page.locator("#status-meta")).toContainText(SPACE)

  // The key is on the sidebar: that list is the keyring, rendered.
  await alice.page.getByRole("button", { name: "Client", exact: true }).first().click()
  await expect(alice.page.locator(`.item[data-id="${SPACE}"]`)).toBeVisible()

  // Force the node the engine rewrites to be rewritten: a demotion and a
  // promotion, driven by clearing and restoring the declared side.
  await alice.page.evaluate(
    async ([room, mnemonic, superAdmin]) => {
      const { gdb } = await import("/genosdb/index.js")
      const db = await gdb(room, { rtc: true, sm: { superAdmins: [superAdmin], acls: true } })
      const identity = await db.sm.loginOrRecoverUserWithMnemonic(mnemonic)
      const id = `user:${identity.address}`
      const { result } = await db.get(id)
      // Drop the side: last-match-wins sends the role back to the floor, and
      // the engine rewrites the node to do it.
      const { requestedSide, ...rest } = result?.value ?? {}
      await db.put(rest, id)
    },
    [
      `dcampaigns-${RUN}`,
      ALICE.mnemonic,
      SUPERADMIN.address,
    ]
  )

  // The role moves — proof the engine rewrote the user node.
  await expect(roleOf(alice.page)).toHaveText("user", { timeout: 25_000 })

  // And the key is still there. That is the whole point.
  await expect(alice.page.locator(`.item[data-id="${SPACE}"]`)).toBeVisible()

  await operator.context.close()
  await alice.context.close()
})
