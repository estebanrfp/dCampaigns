/**
 * Observing the transport from outside the library.
 *
 * GenosDB is a black box here: we never import its internals. But WebRTC is a
 * platform API, so wrapping `RTCPeerConnection` before the app boots gives full
 * visibility into what the engine actually did — how many connections it opened,
 * whether ICE succeeded, and whether bytes moved.
 *
 * This is what turns "the data appeared in the other peer" into "the data
 * crossed a real peer connection", which is the only version worth asserting in
 * a P2P app.
 */

/**
 * Wrap `RTCPeerConnection` in a context so every instance is recorded.
 *
 * Must run before any page script — `addInitScript` guarantees that.
 *
 * @param {import('@playwright/test').BrowserContext} context
 */
export const observePeerConnections = (context) =>
  context.addInitScript(() => {
    const Native = window.RTCPeerConnection
    window.__pcs = []
    window.RTCPeerConnection = class extends Native {
      constructor(...args) {
        super(...args)
        window.__pcs.push(this)
      }
    }
    // Keep the statics (generateCertificate) and the prototype chain intact.
    Object.setPrototypeOf(window.RTCPeerConnection, Native)
  })

/**
 * Summarise the transport as the page sees it.
 *
 * `candidate-pair` with `state: 'succeeded'` is the pair ICE actually selected:
 * its presence means a real connection was negotiated, and its byte counters
 * mean traffic flowed over it. `peer-connection` reports how many data channels
 * were opened and closed, so the difference is what is currently open.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{connections: number, connected: number, succeededPairs: number, bytesSent: number, bytesReceived: number, dataChannelsOpen: number}>}
 */
export const transportStats = (page) =>
  page.evaluate(async () => {
    const pcs = window.__pcs ?? []
    const summary = {
      connections: pcs.length,
      connected: 0,
      succeededPairs: 0,
      bytesSent: 0,
      bytesReceived: 0,
      dataChannelsOpen: 0,
    }

    for (const pc of pcs) {
      if (pc.connectionState === "connected") summary.connected++
      let report
      try {
        report = await pc.getStats()
      } catch {
        continue
      }
      report.forEach((stat) => {
        if (stat.type === "candidate-pair" && stat.state === "succeeded") {
          summary.succeededPairs++
          summary.bytesSent += stat.bytesSent ?? 0
          summary.bytesReceived += stat.bytesReceived ?? 0
        }
        if (stat.type === "peer-connection") {
          summary.dataChannelsOpen += (stat.dataChannelsOpened ?? 0) - (stat.dataChannelsClosed ?? 0)
        }
      })
    }
    return summary
  })
