/**
 * Assignment: work asked of a named creator.
 *
 * Assignment is the piece that turns a board of open tasks into a workflow, and
 * it belongs in the core of any campaign tool. Here it is a signed statement by the
 * client — *this is the person I asked* — which is worth being precise about:
 * it buys attribution, not prevention. The room is shared, so a member could
 * still sign a delivery for a task asked of someone else; the graph would
 * record exactly who did it, and the client rejects it.
 */
import { expect, test } from "@playwright/test"
import { ALICE, BOB, SUPERADMIN, declareSide, openPeer, roleOf, signIn } from "./peers.js"

const SPACE = "assign"
const CODE = "code-7731"

test("a task asked of one creator is not deliverable by another", async ({ browser }) => {
  const operator = await openPeer(browser, SUPERADMIN)

  const alice = await openPeer(browser, ALICE)
  await declareSide(alice.page, "client", "Acme Inc.")
  await expect(roleOf(alice.page)).toHaveText("client")

  await alice.page.getByRole("button", { name: "Client", exact: true }).first().click()
  await alice.page.locator("#space-slug").fill(SPACE)
  await alice.page.locator("#space-name").fill("Acme Inc.")
  await alice.page.locator("#space-password").fill(CODE)
  await alice.page.getByRole("button", { name: "Create" }).click()
  await signIn(alice.page, ALICE)

  await alice.page.getByRole("button", { name: "Client", exact: true }).first().click()
  await alice.page.locator("#new-btn").click()
  await alice.page.locator("#campaign-title").fill("Launch week")
  await alice.page.locator("#campaign-brief").fill("Announce 2.0.")
  await alice.page.getByRole("button", { name: "Create" }).click()

  // Bob joins before the task exists, so he is available to be asked.
  const bob = await openPeer(browser, BOB)
  await declareSide(bob.page, "creator", "Bob")
  await expect(roleOf(bob.page)).toHaveText("creator")
  await bob.page.locator("#join-slug").fill(SPACE)
  await bob.page.locator("#join-password").fill(CODE)
  await bob.page.getByRole("button", { name: "Join" }).click()
  await signIn(bob.page, BOB)

  // The client can now pick him by name — the room knows who joined it,
  // because every identity introduces itself in each graph it enters.
  await alice.page.getByRole("button", { name: "Open" }).click()
  await alice.page.getByRole("button", { name: "Add task" }).click()
  await expect(alice.page.locator("#task-assignee")).toBeVisible()
  await expect(alice.page.locator("#task-assignee option", { hasText: "Bob" })).toHaveCount(1)

  await alice.page.locator("#task-title").fill("Post a thread")
  await alice.page.locator("#task-req").fill("Three posts.")
  await alice.page.locator("#task-assignee").selectOption({ label: "Bob" })
  await alice.page.getByRole("button", { name: "Create" }).click()

  // The client sees who was asked.
  await expect(alice.page.getByText("Post a thread")).toBeVisible()
  await expect(alice.page.getByText("→ Bob")).toBeVisible()

  // Bob sees it is his, and can deliver.
  await expect(bob.page.getByText("Post a thread")).toBeVisible()
  await expect(bob.page.getByText("asked of you")).toBeVisible()
  await expect(bob.page.getByRole("button", { name: "Submit work" })).toBeEnabled()

  // The operator is in the same room but was not asked: the control is there,
  // visible and locked, rather than missing.
  await operator.page.getByRole("button", { name: "Creator", exact: true }).first().click()
  await operator.page.locator("#join-slug").fill(SPACE)
  await operator.page.locator("#join-password").fill(CODE)
  await operator.page.getByRole("button", { name: "Join" }).click()
  await signIn(operator.page, SUPERADMIN)
  // The operator lands on their own panel after the restart, by design.
  await operator.page.getByRole("button", { name: "Creator", exact: true }).first().click()

  await expect(operator.page.getByText("Post a thread")).toBeVisible()
  const lockedButton = operator.page.getByRole("button", { name: "Submit work" })
  await expect(lockedButton).toBeDisabled()
  await expect(lockedButton).toHaveAttribute("title", "This task was asked of someone else")

  // Reopening it to the room puts everyone back in play.
  await alice.page.getByRole("button", { name: "Reassign" }).click()
  await alice.page.locator("#assign-to").selectOption("")
  await alice.page.getByRole("button", { name: "Save" }).click()

  await expect(alice.page.getByText("open to anyone")).toBeVisible()
  await expect(operator.page.getByRole("button", { name: "Submit work" })).toBeEnabled()

  await operator.context.close()
  await alice.context.close()
  await bob.context.close()
})
