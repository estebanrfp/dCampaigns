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
 */
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
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
