import { defineConfig } from "vite"

// GenosDB resolves its optional modules relative to itself (`import.meta.url`),
// so it must not be pre-bundled in dev nor re-bundled in the build, or those
// modules end up unemitted at runtime. See docs/bundler-configuration.md.
export default defineConfig({
  optimizeDeps: { exclude: ["genosdb"] },
  build: { target: "es2022" }, // GenosDB uses top-level await
})
