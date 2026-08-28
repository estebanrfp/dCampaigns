/**
 * Loading GenosDB from the CDN, in one piece.
 *
 * GenosDB resolves its optional modules at runtime, relative to itself
 * (`import.meta.url`): `sm.min.js` reaches for `sm-acls.min.js` and
 * `sm-gov.min.js` only when ACLs and governance are actually configured.
 * A bundler cannot see those imports, so it rewrites the entry point, emits it
 * under a hashed name, and leaves the siblings behind — the build succeeds and
 * then 404s at runtime for exactly the two modules this app is built on.
 *
 * Verified on this project: a production build served `sm.min-<hash>.js` fine
 * and answered 404 for `sm-acls.min.js` and `sm-gov.min.js`. Node ownership and
 * role promotion would have failed silently in production while working in dev.
 *
 * Loading from the CDN sidesteps that: `import.meta.url` then points at the CDN
 * directory, where every sibling is served next to it. `@vite-ignore` keeps the
 * import opaque, so the bundler never inspects it and the app carries no copy
 * of the engine at all.
 *
 * The version is deliberately floating. This app exists to show what GenosDB
 * can carry, so it should demonstrate the engine as it is today rather than as
 * it was the week the app was written — and if a release ever breaks it, that
 * is worth learning from a real application rather than from a report months
 * later.
 */

/** Where the engine comes from — written down once, used by the app and the suite. */
export const ENGINE_URL = "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.js"

/** @type {Promise<Function>|null} */
let engine = null

/**
 * The `gdb` factory, loaded once.
 *
 * @returns {Promise<Function>} GenosDB's `gdb(name, options)`.
 */
export const loadGdb = () =>
  (engine ??= import(/* @vite-ignore */ ENGINE_URL).then((module) => module.gdb))
