/**
 * Rows or cards, over one markup.
 *
 * The same list serves two readers. Somebody working a queue wants rows —
 * aligned columns to compare down, many at once. Somebody browsing wants cards,
 * where each item is a thing rather than a line. Neither is right for both, so
 * it is a choice, remembered.
 *
 * What it is *not* is two renderers. This app already grew a second copy of one
 * task list by accident and painted the old design from it for a while before
 * anyone noticed — exactly the failure a duplicated view invites. So the table
 * is the only markup and the card layout is CSS over the same rows: one source
 * of truth, two presentations, nothing to keep in step.
 *
 * The control sits above the list it governs rather than in the top bar, where
 * it read as a sibling of the theme switch and was mistaken for one. Both modes
 * are on screen at once with the current one marked, so the answer to "which am
 * I looking at" is visible instead of inferred from an icon that changed.
 */
import { elt } from "./dom.js"

const MODES = ["table", "cards"]

/** Everything drawn so far, so a change reaches the controls already on screen. */
const toggles = new Set()

const ICONS = {
  table: [
    { tag: "rect", attrs: { x: 3, y: 4, width: 18, height: 16, rx: 2 } },
    { tag: "path", attrs: { d: "M3 9h18M11 9v11" } },
  ],
  cards: [
    { tag: "rect", attrs: { x: 3, y: 4, width: 7, height: 16, rx: 1.5 } },
    { tag: "rect", attrs: { x: 14, y: 4, width: 7, height: 16, rx: 1.5 } },
  ],
}

const icon = (mode) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  for (const { tag, attrs } of ICONS[mode]) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag)
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value))
    svg.append(node)
  }
  return svg
}

/**
 * Apply a view mode and remember it.
 *
 * @param {'table'|'cards'} mode
 */
export const applyViewMode = (mode) => {
  document.documentElement.dataset.view = mode
  localStorage.dcampaignsView = mode
  for (const button of toggles) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode))
  }
}

/**
 * The control itself: both modes, the current one marked.
 *
 * @returns {HTMLElement}
 */
export const viewToggle = () => {
  const current = document.documentElement.dataset.view ?? "table"
  const group = elt("div", { className: "view-toggle", attrs: { role: "group", "aria-label": "List layout" } })

  for (const mode of MODES) {
    const button = elt("button", {
      className: "icon-btn",
      title: mode === "table" ? "Show as rows" : "Show as cards",
      dataset: { mode },
      attrs: { "aria-pressed": String(mode === current), "aria-label": mode === "table" ? "Rows" : "Cards" },
      onclick: () => applyViewMode(mode),
    })
    button.append(icon(mode))
    // Controls are rebuilt with their view, so the set would grow without bound
    // if it held them forever; a rebuilt one replaces the one it succeeds.
    for (const stale of [...toggles]) if (!stale.isConnected) toggles.delete(stale)
    toggles.add(button)
    group.append(button)
  }
  return group
}

/** Restore the remembered mode before anything paints. */
export const initViewMode = () => applyViewMode(localStorage.dcampaignsView ?? "table")
