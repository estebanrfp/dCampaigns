import { defineConfig, devices } from "@playwright/test"

/**
 * Peers, not tabs.
 *
 * Every simulated participant runs in its own `BrowserContext`, which carries
 * its own storage partition — separate OPFS, localStorage and BroadcastChannel.
 * Two tabs of one origin share all of that, so they would sync through shared
 * storage and prove nothing about the P2P layer.
 *
 * Tests run serially: they share one graph (and one signaling network), so
 * parallel workers would race each other through the same rooms.
 *
 * `TARGET_URL` points the suite at a deployment instead of the local server —
 * `TARGET_URL=https://estebanrfp.github.io/dCampaigns/ pnpm test`. Worth doing
 * before showing the thing to anyone: with no build step the files are the same
 * either way, but the sub-path a project site is served from and an engine
 * fetched cross-origin from a CDN are not exercised locally, and both fail
 * quietly.
 */
const TARGET = process.env.TARGET_URL

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  // P2P convergence is not instant: peers discover each other through relays,
  // and governance resolves roles on a cycle. Assertions retry until then.
  expect: { timeout: 30_000 },
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: TARGET ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Against a deployment there is nothing to start.
  ...(TARGET
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          url: "http://localhost:5173",
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
})
