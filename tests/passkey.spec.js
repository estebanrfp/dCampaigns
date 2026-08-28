/**
 * Passkeys: a session that survives a reload without retyping a phrase.
 *
 * The cryptographic identity is what makes an approval verifiable, but a
 * mnemonic session lives only in memory and dies on every reload. A
 * WebAuthn-backed session is resumed silently when the SM initializes. This
 * asserts that promise end to end, with Playwright's virtual authenticator —
 * no hardware, no prompts, works headless.
 *
 * (Entering a space no longer reloads — one graph, a click — but a reload still
 * happens for real reasons: a refresh, a reopened tab. That is what this guards.)
 */
import { expect, test } from "@playwright/test"
import { ALICE, APP_URL, SUPERADMIN, declareSide, openPeer, roleOf, signIn } from "./peers.js"

const SPACE = "passkey"

test("a passkey session survives a reload and opening a room", async ({ browser }) => {
  const operator = await openPeer(browser, SUPERADMIN)

  // The virtual authenticator must be installed before the page touches
  // navigator.credentials.
  const context = await browser.newContext()
  await context.credentials.install()
  const page = await context.newPage()
  await page.goto(APP_URL)

  // Sign in the hard way first — a phrase, as any newcomer would.
  await signIn(page, ALICE)
  await declareSide(page, "client", "Acme Inc.")
  await expect(roleOf(page)).toHaveText("client")

  // The upgrade is offered, because this session is not protected yet.
  const upgrade = page.locator("#passkey-upgrade-btn")
  await expect(upgrade).toBeVisible()
  await upgrade.click()

  // Once protected, the offer withdraws itself.
  await expect(upgrade).toBeHidden()

  // The app only says this once the registration is durable — the button hides
  // earlier, when the security state changes, and reloading in that window
  // loses the passkey that was just created.
  await expect(page.getByText("Passkey saved")).toBeVisible()

  // A reload used to mean retyping the phrase. Now the door stays shut.
  await page.reload()
  await expect(page.locator("#identity-modal")).toBeHidden()
  await expect(roleOf(page)).toHaveText("client")

  // Still signed in after the reload, and able to work: create a space and put
  // a campaign in it, without a phrase having been typed since login.
  await page.getByRole("button", { name: "Client", exact: true }).first().click()
  await page.locator("#space-slug").fill(SPACE)
  await page.locator("#space-name").fill("Acme Inc.")
  await page.getByRole("button", { name: "Create" }).click()

  await expect(page.locator("#status-meta")).toContainText(SPACE)
  await expect(page.locator("#identity-modal")).toBeHidden()

  await page.locator("#new-btn").click()
  await page.locator("#campaign-title").fill("Launch week")
  await page.locator("#campaign-brief").fill("Announce 2.0.")
  await page.getByRole("button", { name: "Create" }).click()
  await expect(page.getByText("Launch week")).toBeVisible()

  await context.close()
  await operator.context.close()
})
