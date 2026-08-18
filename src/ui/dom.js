/**
 * DOM helpers.
 *
 * Everything a peer can write is set through `textContent`, never `innerHTML`:
 * a P2P app has no server to sanitize for it, and the only content here that is
 * not user-written is the icon markup shipped in index.html.
 */

/**
 * Build an element.
 *
 * @param {string} tag
 * @param {object} [props] - Properties and `dataset`/`attrs` sub-objects.
 * @param {...(Node|string)} children
 * @returns {HTMLElement}
 */
export const elt = (tag, props = {}, ...children) => {
  const node = document.createElement(tag)
  const { dataset, attrs, ...rest } = props
  Object.assign(node, rest)
  Object.entries(dataset ?? {}).forEach(([key, value]) => (node.dataset[key] = value))
  Object.entries(attrs ?? {}).forEach(([key, value]) => node.setAttribute(key, value))
  node.append(...children.filter(Boolean))
  return node
}

/** Remove every child of a node. */
export const clear = (node) => node.replaceChildren()

/** Abbreviated, monospaced address — the canonical way to show machine data. */
export const addr = (db, address) =>
  elt("span", { className: "addr", textContent: address ? db.sm.abbrAddr(address) : "unknown" })

/** Localized timestamp — never a raw epoch number in the UI. */
export const when = (ts) => (ts ? new Date(ts).toLocaleString() : "")

/**
 * Keep a list in sync with a realtime subscription, handling all four actions.
 *
 * Rows are keyed by node id in the DOM itself, so there is no mirrored array to
 * fall out of step with the graph.
 *
 * @param {HTMLElement} container
 * @param {(node: object) => HTMLElement} renderRow
 * @returns {(event: object) => void} The map callback.
 */
export const liveList = (container, renderRow) => {
  return ({ id, value, action }) => {
    const existing = container.querySelector(`[data-id="${CSS.escape(id)}"]`)

    if (action === "removed") return existing?.remove()

    const row = renderRow({ id, value })
    row.dataset.id = id

    if (action === "initial") return container.append(row) // already sorted by the engine
    if (action === "added") return container.prepend(row) // newest by definition

    // `updated`: rebuild and move to the top, so the thing that just changed is
    // where the eye already is. A silent in-place swap hides the event.
    existing?.remove()
    container.prepend(row)
  }
}
