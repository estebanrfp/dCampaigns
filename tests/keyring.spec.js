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
import { ALICE, ENGINE_URL, RUN, SUPERADMIN, declareSide, openPeer, roleOf, signIn } from "./peers.js"

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

  // Rewrite the node the engine owns, the way the engine once did. A naive
  // `assignRole` rebuilt `user:<address>` from `{ role, ethAddress, … }` alone,
  // dropping every application field on it — and, back when the keyring was one
  // of those fields, the room passwords with them. This reproduces that rewrite
  // directly, from a second instance holding Alice's key, then reads the keyring
  // where it lives now: a node of its own, which the rewrite cannot reach.
  //
  // Driving it through governance instead would hang on cross-peer meshing (the
  // promotion is signed in the operator's window, and a throwaway peer may never
  // connect to it) and fight `keepSide`, which now restores a cleared side. The
  // property under test is structural — two nodes, not one — not a matter of who
  // signs, so the throwaway shares this context's OPFS and the assertions read
  // the graph directly.
  const survived = await alice.page.evaluate(
    async ([room, mnemonic, superAdmin, addr, engineUrl]) => {
      const { gdb } = await import(engineUrl)
      const db = await gdb(room, { rtc: true, sm: { superAdmins: [superAdmin], acls: true } })
      await db.sm.loginOrRecoverUserWithMnemonic(mnemonic)
      const id = `user:${addr}`

      const before = (await db.get(`keyring:${addr}`)).result?.value?.rooms
      // Collapse the user node to bare role fields: the dangerous rewrite.
      await db.put({ role: "user", ethAddress: addr }, id)
      const userAfter = Object.keys((await db.get(id)).result?.value ?? {})
      const after = (await db.get(`keyring:${addr}`)).result?.value?.rooms

      return { before: !!before, userAfter, after: !!after }
    },
    [`dcampaigns-${RUN}`, ALICE.mnemonic, SUPERADMIN.address, ALICE.address, ENGINE_URL]
  )

  // The rewrite really did strip the user node down…
  expect(survived.before, "the keyring existed before the rewrite").toBe(true)
  expect(survived.userAfter, "the user node was collapsed to bare role fields").not.toContain("displayName")
  // …and the keyring, living in its own node, came through it untouched.
  expect(survived.after, "the keyring survived the user-node rewrite").toBe(true)

  // And on Alice's own screen the key is still there: the sidebar reads the
  // keyring node, which the rewrite never touched.
  await expect(alice.page.locator(`.item[data-id="${SPACE}"]`)).toBeVisible()

  await operator.context.close()
  await alice.context.close()
})
