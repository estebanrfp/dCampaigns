/**
 * The search box narrows the list in the engine, not on the screen.
 *
 * The cheap way to build a filter is to hide rows that were already drawn. It
 * looks identical until the graph changes underneath: a space arriving while
 * somebody is typing either shows up when it should not, or never shows up at
 * all, because the rendered list stopped being a subscription the moment a
 * filter started editing it by hand.
 *
 * So the box rebuilds the subscription with `$text` folded into the view's own
 * query. This asserts both halves — that it narrows, and that what it narrows
 * to is still live. The accent folding is the engine's, and worth asserting
 * because it is the difference between a search that reads the way a person
 * types and one that reads the way the data happens to be spelled.
 */
import { expect, test } from "@playwright/test"
import { ALICE, SUPERADMIN, declareSide, openPeer, roleOf } from "./peers.js"

const items = (page) => page.locator("#item-list .item")
const search = (page) => page.locator("#search-input")

/**
 * Spaces through the model rather than the form: this test is about the box in
 * the sidebar, and the form only offers itself while no space is open — so
 * driving it would be testing that flow rather than this one.
 */
const seedSpaces = (page, spaces) =>
  page.evaluate(async (list) => {
    const { createClientSpace } = await import("/src/db/model.js")
    const { state } = await import("/src/state/app.js")
    for (const space of list) {
      await createClientSpace(state.db, space)
      // The catalogue is ordered by the millisecond it was written, and a loop
      // writes faster than that clock ticks.
      await new Promise((resolve) => setTimeout(resolve, 3))
    }
  }, spaces)

test("the sidebar search narrows a live list", async ({ browser }) => {
  const operator = await openPeer(browser, SUPERADMIN)

  const alice = await openPeer(browser, ALICE)
  await declareSide(alice.page, "client", "Acme Inc.")
  await expect(roleOf(alice.page)).toHaveText("client")

  // Two that share a word and one that shares nothing. The accented name is
  // there to be found by typing it flat.
  await seedSpaces(alice.page, [
    { slug: "acme-launch", name: "Acme Launch" },
    { slug: "acme-retail", name: "Acme Retail" },
    { slug: "bodega", name: "Bodega Peña" },
  ])
  await expect(items(alice.page)).toHaveCount(3)

  // ── It narrows ───────────────────────────────────────────────────
  await search(alice.page).fill("acme")
  await expect(items(alice.page)).toHaveCount(2)
  await expect(alice.page.getByText("Bodega Peña")).toHaveCount(0)

  // ── Case and accents are folded by the engine ────────────────────
  await search(alice.page).fill("PENA")
  await expect(items(alice.page)).toHaveCount(1)
  await expect(alice.page.getByText("Bodega Peña")).toBeVisible()

  // ── The slug is searchable too, not just the name ────────────────
  await search(alice.page).fill("retail")
  await expect(items(alice.page)).toHaveCount(1)
  await expect(alice.page.getByText("Acme Retail")).toBeVisible()

  // ── A term that matches nothing says so ──────────────────────────
  await search(alice.page).fill("zzz-nothing")
  await expect(items(alice.page)).toHaveCount(0)
  await expect(alice.page.locator("#list-empty")).toContainText("zzz-nothing")

  // ── Clearing it restores the whole list ──────────────────────────
  await search(alice.page).fill("")
  await expect(items(alice.page)).toHaveCount(3)

  // ── And the narrowed list is still a subscription ────────────────
  // The claim this test exists for. With a search active, a space that matches
  // it appears on its own, and one that does not stays out — which a filter
  // that hides already-drawn rows cannot do.
  await search(alice.page).fill("acme")
  await expect(items(alice.page)).toHaveCount(2)

  await seedSpaces(alice.page, [{ slug: "acme-winter", name: "Acme Winter" }])
  await expect(items(alice.page)).toHaveCount(3)
  await expect(alice.page.getByText("Acme Winter")).toBeVisible()

  await seedSpaces(alice.page, [{ slug: "unrelated", name: "Unrelated Co." }])
  await expect(alice.page.getByText("Unrelated Co.")).toHaveCount(0)
  await expect(items(alice.page)).toHaveCount(3)

  // It was excluded by the search, not lost: clearing shows all five.
  await search(alice.page).fill("")
  await expect(items(alice.page)).toHaveCount(5)

  await operator.context.close()
  await alice.context.close()
})
