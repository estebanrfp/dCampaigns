import { defineConfig } from "vite"

/**
 * GenosDB is never bundled.
 *
 * It resolves its optional modules at runtime, relative to itself, so any
 * rewrite of its entry point orphans them: a build that looks perfectly clean
 * answers 404 for `sm-acls.min.js` and `sm-gov.min.js` — ACLs and governance,
 * the two things this app is built on. It is loaded from the CDN instead, where
 * those siblings sit next to it; see `src/db/engine.js`.
 *
 * `base` supports a project-site deployment (GitHub Pages serves it under a
 * sub-path). It applies to this app's own assets — the engine's URL is absolute
 * and unaffected.
 */
export default defineConfig({
  base: process.env.PAGES_BASE ?? "/",
  build: { target: "es2022" }, // GenosDB uses top-level await
})
