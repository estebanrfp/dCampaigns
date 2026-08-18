/**
 * The newcomer nobody promotes.
 *
 * Reported from real use: a superadmin window open, a second identity signed
 * in, and no promotion ever arrives. This reproduces it, because a rule that
 * only fires on a declared side leaves everyone who did not declare one stuck
 * with no explanation — and "stuck with no explanation" is the worst failure a
 * trust system can have.
 */
import { expect, test } from "@playwright/test"
import { ALICE, APP_URL, SUPERADMIN, openPeer, roleOf, signIn } from "./peers.js"

test("a guest who never declared a side is not left stranded", async ({ browser }) => {
  const operator = await openPeer(browser, SUPERADMIN)
  await expect(roleOf(operator.page)).toHaveText("superadmin")

  // Alice signs in and does NOT answer the onboarding dialog.
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(APP_URL)
  await signIn(page, ALICE)

  // The dialog is there, waiting — but she has not chosen.
  await expect(page.locator("#onboarding-modal")).toBeVisible()

  // The engine is running in the operator's window, so the base tier should
  // arrive whether or not a side was chosen. Staying `guest` forever is the
  // reported bug.
  await expect(roleOf(page)).not.toHaveText("guest", { timeout: 20_000 })

  await context.close()
  await operator.context.close()
})
