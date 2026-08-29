/**
 * Rows or cards, over one markup.
 *
 * The same list serves two readers. Somebody working a queue wants rows —
 * aligned columns to compare down, many at once. Somebody browsing wants cards,
 * where each item is a thing rather than a line. Neither is right for both, so
 * it is a choice, remembered.
 *
 * What it is *not* is two renderers. This app grew a second copy of a task list
 * by accident and quietly painted the old design from it before anyone noticed
 * — exactly the failure a duplicated view invites. So the table is the only
 * markup and the card layout is CSS over the same rows: one source of truth,
 * two presentations, nothing to keep in step.
 *
 * The control lives in the band across the top of the content, level with the
 * search head, as a bare mark rather than a button in a box: it is chrome, and
 * a border there competes with the bands that give the layout its shape. It
 * shows the layout you would be switching to, which is the same bargain the
 * theme switch makes two icons along.
 */
import { elt } from "./dom.js"

const MODES = ["table", "cards"]

/** Drawn once and kept, so a change repaints the mark already on screen. */
let mark = null

const PATHS = {
  // Showing rows → offer cards: two panels.
  table: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>',
  // Showing cards → offer rows: a table with a header rule.
  cards: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M11 9v11"/>',
}

const paint = (mode) => {
  if (!mark) return
  mark.title = mode === "table" ? "Showing rows — switch to cards" : "Showing cards — switch to rows"
  mark.setAttribute("aria-label", mark.title)
  const svg = mark.querySelector("svg")
  // The only innerHTML in the app, and on a string this module owns: the shapes
  // are literals here, never anything a peer could have written.
  svg.innerHTML = PATHS[mode]
}

/**
 * Apply a view mode and remember it.
 *
 * @param {'table'|'cards'} mode
 */
export const applyViewMode = (mode) => {
  document.documentElement.dataset.view = mode
  localStorage.dcampaignsView = mode
  paint(mode)
}

/**
 * The control: one mark, cycling.
 *
 * @returns {HTMLElement}
 */
export const viewToggle = () => {
  if (mark) return mark
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")

  mark = elt("button", {
    className: "head-btn",
    onclick: () =>
      applyViewMode(MODES[(MODES.indexOf(document.documentElement.dataset.view) + 1) % MODES.length]),
  })
  mark.append(svg)
  paint(document.documentElement.dataset.view ?? "table")
  return mark
}

/** Restore the remembered mode before anything paints. */
export const initViewMode = () => {
  document.getElementById("head-right").append(viewToggle())
  applyViewMode(localStorage.dcampaignsView ?? "table")
}
