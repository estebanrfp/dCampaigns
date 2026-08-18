import { defineConfig } from "vite"

/**
 * GenosDB is never bundled.
 *
 * It resolves its optional modules at runtime, relative to itself, so any
 * rewrite of its entry point orphans them: a build that looks perfectly clean
 * answers 404 for `sm-acls.min.js` and `sm-gov.min.js` — ACLs and governance,
 * the two things this app is built on. `pnpm sync-engine` copies its `dist/`
 * verbatim into `public/genosdb/`, and `src/db/engine.js` loads it from there.
 *
 * `base` supports a project-site deployment (GitHub Pages serves it under a
 * sub-path). `BASE_URL` carries that prefix into the engine's own path, so the
 * same source works at a domain root and under `/dCampaigns/`.
 */
export default defineConfig({
  base: process.env.PAGES_BASE ?? "/",
  optimizeDeps: { exclude: ["genosdb"] },
  build: { target: "es2022" }, // GenosDB uses top-level await
})
