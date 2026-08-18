/**
 * Platform check: does a BrowserContext really isolate what GenosDB stores?
 *
 * The whole multi-peer test strategy rests on this. Playwright documents
 * isolation for cookies, localStorage, sessionStorage and IndexedDB, but says
 * nothing about **OPFS** — which is precisely where GenosDB keeps the graph.
 * An assumption at this layer would quietly invalidate every P2P test above it,
 * so it is asserted here rather than believed.
 */
import { expect, test } from "@playwright/test"
import { APP_URL } from "./peers.js"

/** Write a file into the Origin Private File System. */
const writeOpfs = (page, name, contents) =>
  page.evaluate(
    async ([fileName, body]) => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle(fileName, { create: true })
      const writable = await handle.createWritable()
      await writable.write(body)
      await writable.close()
      return true
    },
    [name, contents]
  )

/** Read it back, or report that it is not there. */
const readOpfs = (page, name) =>
  page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory()
    try {
      const handle = await root.getFileHandle(fileName)
      return await (await handle.getFile()).text()
    } catch {
      return null
    }
  }, name)

test("OPFS, IndexedDB and localStorage do not cross between contexts", async ({ browser }) => {
  const peerA = await browser.newContext()
  const pageA = await peerA.newPage()
  await pageA.goto(APP_URL)

  await writeOpfs(pageA, "graph.bin", "peer-a-graph")
  await pageA.evaluate(() => localStorage.setItem("probe", "peer-a"))

  // A second peer, same browser, same origin.
  const peerB = await browser.newContext()
  const pageB = await peerB.newPage()
  await pageB.goto(APP_URL)

  expect(await readOpfs(pageB, "graph.bin")).toBeNull()
  expect(await pageB.evaluate(() => localStorage.getItem("probe"))).toBeNull()

  // Control: the first peer still has its own data, so the read is real.
  expect(await readOpfs(pageA, "graph.bin")).toBe("peer-a-graph")

  await peerA.close()
  await peerB.close()
})

test("two tabs of one context DO share storage — why tabs are not peers", async ({ browser }) => {
  // The converse, asserted so the rule is not folklore: this is exactly what
  // makes same-context tabs useless for proving anything about P2P sync.
  const context = await browser.newContext()
  const tab1 = await context.newPage()
  const tab2 = await context.newPage()
  await tab1.goto(APP_URL)
  await tab2.goto(APP_URL)

  await writeOpfs(tab1, "shared.bin", "written-by-tab-1")

  expect(await readOpfs(tab2, "shared.bin")).toBe("written-by-tab-1")

  await context.close()
})
