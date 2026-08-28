/**
 * Loading GenosDB from the CDN, in one piece.
 *
 * GenosDB resolves its optional modules at runtime, relative to itself
 * (`import.meta.url`): `sm.min.js` reaches for `sm-acls.min.js` and
 * `sm-gov.min.js` only when ACLs and governance are actually configured. From
 * the CDN that resolution lands in the CDN's own directory, where every sibling
 * is served next to it, so the engine arrives whole and the app carries no copy
 * of it.
 *
 * Worth stating because the alternative was tried here: bundling it rewrites the
 * entry point, emits it under a hashed name and leaves the siblings behind. The
 * build looked clean and answered 404 for exactly those two modules — node
 * ownership and role promotion failing silently in production while working in
 * development. There is no bundler now, and no copy to keep in step either.
 *
 * The version is deliberately floating. This app exists to show what GenosDB
 * can carry, so it should demonstrate the engine as it is today rather than as
 * it was the week the app was written — and if a release ever breaks it, that
 * is worth learning from a real application rather than from a report months
 * later.
 */

/** Where the engine comes from — written down once, used by the app and the suite. */
export const ENGINE_URL = "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.min.js"

/** @type {Promise<Function>|null} */
let engine = null

/**
 * The `gdb` factory, loaded once.
 *
 * @returns {Promise<Function>} GenosDB's `gdb(name, options)`.
 */
export const loadGdb = () =>
  (engine ??= import(ENGINE_URL).then((module) => module.gdb))
