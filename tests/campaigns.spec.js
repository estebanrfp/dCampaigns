/**
 * The client's path: become a client, own a space, put work in it.
 *
 * This is where two corrections are actually verified rather than assumed —
 * that a superadmin inherits the lateral roles' verbs (or the owner of a room
 * cannot act in their own space), and that an identity introduces itself in
 * every graph it joins (or it arrives at its own room as a stranger).
 */
import { expect, test } from "@playwright/test"
import { ALICE, SUPERADMIN, declareSide, enterSpace, openPeer, roleOf } from "./peers.js"

const SPACE = "acme"
const CODE = "launch-week-2026"

test("a client creates a space and fills it with a campaign and a task", async ({ browser }) => {
  // Governance only runs while a superadmin is present.
  const operator = await openPeer(browser, SUPERADMIN)

  const alice = await openPeer(browser, ALICE)
  await declareSide(alice.page, "client", "Acme Inc.")
  await expect(roleOf(alice.page)).toHaveText("client")

  // Her own space: a catalogue entry in the public graph, and a room behind it
  // whose code never touches that graph.
  await alice.page.getByRole("button", { name: "Client", exact: true }).first().click()
  await alice.page.locator("#space-slug").fill(SPACE)
  await alice.page.locator("#space-name").fill("Acme Inc.")
  await alice.page.locator("#space-password").fill(CODE)
  await alice.page.getByRole("button", { name: "Create" }).click()

  // Creating enters the room, which restarts the app.
  await expect(alice.page.locator("#identity-modal")).toBeVisible()
  await alice.page.locator("#mnemonic-input").fill(ALICE.mnemonic)
  await alice.page.getByRole("button", { name: "Login with mnemonic" }).click()
  await expect(alice.page.locator("#status-meta")).toContainText(SPACE)

  // Inside her room she is the authority, so the campaign gate must let her past.
  await alice.page.getByRole("button", { name: "Client", exact: true }).first().click()
  await alice.page.locator("#new-btn").click()
  await alice.page.locator("#campaign-title").fill("Launch week")
  await alice.page.locator("#campaign-brief").fill("Announce 2.0 across X.")
  await alice.page.getByRole("button", { name: "Create" }).click()

  // The campaign appears through the live subscription, not a reload.
  await expect(alice.page.getByText("Launch week")).toBeVisible()

  // And a task hangs off it, which is what a creator will later deliver against.
  await alice.page.getByRole("button", { name: "Open" }).click()
  await alice.page.getByRole("button", { name: "Add task" }).click()
  await alice.page.locator("#task-title").fill("Post a thread")
  await alice.page.locator("#task-req").fill("Three posts, launch week, link included.")
  await alice.page.getByRole("button", { name: "Create" }).click()

  await expect(alice.page.getByText("Post a thread")).toBeVisible()

  await operator.context.close()
  await alice.context.close()
})
