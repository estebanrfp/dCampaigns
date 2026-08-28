/**
 * Test helpers: a peer is a browser context, never a tab.
 *
 * The identities are the ecosystem's canonical throwaway ones, so a test reads
 * like the demo it mirrors.
 */
import { expect } from "@playwright/test"

/**
 * The engine under test, from the same place the app loads it.
 *
 * A tampered client is ordinary code holding a user's key, not a different
 * library — so the specs that build a second instance must load the very build
 * the deployed app runs, or they prove something about a version nobody uses.
 */
export { ENGINE_URL } from "../src/db/engine.js"

export const SUPERADMIN = {
  name: "Superadmin",
  mnemonic: "panic now afford carbon donate lecture drift excite collect essay stuff prosper",
  address: "0xbfDe0eCEC5332Fd86D2570085571D6051Df098dA",
}

export const ALICE = {
  name: "Alice",
  mnemonic: "prosper fossil kitten crisp view spread jeans shield prosper myself awake usage",
  address: "0x3546D4BA0ac3bfDea3F1511F82a078DDdb3F4931",
}

export const BOB = {
  name: "Bob",
  mnemonic: "salmon grant recall neutral banner glow pluck divert cactus theory rally ship captain shaft cactus",
  address: "0x8089C0480139d85D82c1E20eeF08a77EF8cD7DEC",
}

/**
 * One namespace per run.
 *
 * Fresh contexts give each peer a clean disk, but the graph also lives on the
 * wire: any peer still holding yesterday's state would replicate it straight
 * back in. A room nobody else knows about is what makes a run actually start
 * from nothing.
 */
export const RUN = `t${Date.now().toString(36)}`

/** The app, scoped to this run's network. */
// Relative on purpose: a leading slash resolves against the origin and drops
// the sub-path a project site is served from, so `TARGET_URL` runs would have
// loaded a different site entirely and reported the app as broken.
export const APP_URL = `?room=${RUN}`

/**
 * Open a fresh peer: its own context, its own storage, its own identity.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {{mnemonic: string}} identity
 * @returns {Promise<{page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext}>}
 */
export const openPeer = async (browser, identity) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(APP_URL)
  await signIn(page, identity)
  return { page, context }
}

/**
 * Enter a client space from the sidebar.
 *
 * A space is a view over the one shared graph, so entering is a click — no
 * password, no restart, and the session stays put.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} slug
 */
export const enterSpace = async (page, slug) => {
  const item = page.locator(`.item[data-id="client:${slug}"]`)
  await item.waitFor() // it arrives by sync — wait for the catalogue entry to land
  await item.click()
  await expect(page.locator("#status-meta")).toContainText(slug)
}

/**
 * Create a client space and land in it.
 *
 * No access code and no reload: the entry is signed as the caller's on
 * creation, and entering it is a filter over the one shared graph.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} slug
 * @param {string} name
 */
export const createSpace = async (page, slug, name) => {
  await page.getByRole("button", { name: "Client", exact: true }).first().click()
  await page.locator("#space-slug").fill(slug)
  await page.locator("#space-name").fill(name)
  await page.getByRole("button", { name: "Create" }).click()
  await expect(page.locator("#status-meta")).toContainText(slug)
}

/**
 * Sign in through the identity door, the way a person does.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{mnemonic: string}} identity
 */
export const signIn = async (page, identity) => {
  const modal = page.locator("#identity-modal")
  await expect(modal).toBeVisible()
  await page.locator("#mnemonic-input").fill(identity.mnemonic)
  await page.getByRole("button", { name: "Login with mnemonic" }).click()
  await expect(modal).toBeHidden()
}

/**
 * Declare a side in the onboarding dialog — the newcomer's single write.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'creator'|'client'} side
 * @param {string} displayName
 */
export const declareSide = async (page, side, displayName) => {
  const modal = page.locator("#onboarding-modal")
  await expect(modal).toBeVisible()
  // Scoped to the dialog: the top bar carries buttons with the same names.
  await modal.locator(side === "client" ? "#pick-client" : "#pick-creator").click()
  await page.locator("#display-name").fill(displayName)
  await modal.getByRole("button", { name: "Continue" }).click()
  await expect(modal).toBeHidden()
}

/** The live role shown in the top bar — the thing governance changes. */
export const roleOf = (page) => page.locator("#session-role")
