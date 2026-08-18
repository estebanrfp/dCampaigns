/**
 * Did it actually cross the wire?
 *
 * Every other test asserts that state arrives. This one asserts *how*: that a
 * real peer connection was negotiated and carried bytes. Without it, a suite of
 * green P2P tests can be measuring nothing but two tabs sharing a disk — the
 * exact failure mode the context-per-peer rule exists to prevent.
 */
import { expect, test } from "@playwright/test"
import { ALICE, APP_URL, SUPERADMIN, declareSide, roleOf, signIn } from "./peers.js"
import { observePeerConnections, transportStats } from "./webrtc.js"

test("state that reaches another peer has crossed a real peer connection", async ({ browser }) => {
  const operator = await browser.newContext()
  await observePeerConnections(operator) // before any navigation
  const opPage = await operator.newPage()
  await opPage.goto(APP_URL)
  await signIn(opPage, SUPERADMIN)

  const alice = await browser.newContext()
  await observePeerConnections(alice)
  const alicePage = await alice.newPage()
  await alicePage.goto(APP_URL)
  await signIn(alicePage, ALICE)
  await declareSide(alicePage, "client", "Acme Inc.")

  // The application-level proof: a grant only the operator's key could sign.
  await expect(roleOf(alicePage)).toHaveText("client")

  // The transport-level proof, on both ends.
  const opStats = await transportStats(opPage)
  const aliceStats = await transportStats(alicePage)

  expect(opStats.connections, "the operator opened peer connections").toBeGreaterThan(0)
  expect(aliceStats.connections, "alice opened peer connections").toBeGreaterThan(0)

  expect(opStats.succeededPairs, "ICE selected a working candidate pair").toBeGreaterThan(0)
  expect(aliceStats.succeededPairs, "ICE selected a working candidate pair").toBeGreaterThan(0)

  expect(aliceStats.bytesReceived, "alice received bytes over WebRTC").toBeGreaterThan(0)
  expect(opStats.bytesSent, "the operator sent bytes over WebRTC").toBeGreaterThan(0)

  expect(aliceStats.dataChannelsOpen, "a data channel is open").toBeGreaterThan(0)

  await operator.close()
  await alice.close()
})
