/**
 * Loading GenosDB without letting the bundler take it apart.
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
 * So the engine is shipped as an untouched folder and loaded from a path the
 * bundler never inspects. `@vite-ignore` keeps the import opaque, and
 * `BASE_URL` keeps it correct under a sub-path deployment such as GitHub Pages.
 */

/** @type {Promise<Function>|null} */
let engine = null

/**
 * The `gdb` factory, loaded once.
 *
 * @returns {Promise<Function>} GenosDB's `gdb(name, options)`.
 */
export const loadGdb = () =>
  (engine ??= import(/* @vite-ignore */ `${import.meta.env.BASE_URL}genosdb/index.js`).then(
    (module) => module.gdb
  ))
