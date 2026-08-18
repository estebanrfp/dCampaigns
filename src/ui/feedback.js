/**
 * Feedback: toasts for what happened, a dialog for what is about to.
 *
 * Never `alert()` or `confirm()` — both block the main thread, which in a P2P
 * app freezes the very sync the interface exists to show: peer messages queue
 * and `requestAnimationFrame` never runs behind the browser's box.
 */

const el = {
  toasts: document.getElementById("toasts"),
  confirmModal: document.getElementById("confirm-modal"),
  confirmTitle: document.getElementById("confirm-title"),
  confirmText: document.getElementById("confirm-text"),
  confirmOk: document.getElementById("confirm-ok"),
}

const MAX_TOASTS = 3
const TOAST_ICONS = { info: "ⓘ", success: "✓", error: "✕", warning: "!" }

/** Remove a toast, and put the stack away once it is empty. */
const dropToast = (node) => {
  node.classList.add("out")
  setTimeout(() => {
    node.remove()
    if (!el.toasts.children.length && el.toasts.matches(":popover-open")) el.toasts.hidePopover()
  }, 400)
}

/**
 * Report an operation. Messages stack rather than replace each other: in a P2P
 * app a peer event can land while you are saving, and the one you did not ask
 * for is often the one worth reading.
 *
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'} [kind='info']
 */
export const toast = (message, kind = "info") => {
  const node = document.createElement("div")
  node.className = `toast ${kind}`

  const icon = document.createElement("span")
  icon.className = "toast-icon"
  icon.textContent = TOAST_ICONS[kind] ?? TOAST_ICONS.info
  icon.setAttribute("aria-hidden", "true") // the text alone is the message

  const text = document.createElement("span")
  text.className = "toast-text"
  text.textContent = message

  node.append(icon, text)
  node.addEventListener("click", () => dropToast(node))
  // Show the stack first: a node appended while the container is still
  // display:none starts its animation frozen at translateX(100%).
  if (!el.toasts.matches(":popover-open")) el.toasts.showPopover()
  el.toasts.append(node)
  while (el.toasts.children.length > MAX_TOASTS) el.toasts.firstElementChild.remove()

  // Errors stay longer: the message you most need to read is the longest one.
  setTimeout(() => node.isConnected && dropToast(node), kind === "error" ? 5000 : 3000)
}

/**
 * Ask before anything irreversible. The title asks, the body says what is lost,
 * and the button names the act rather than saying OK.
 *
 * @param {{title: string, body: string, confirmLabel: string}} question
 * @returns {Promise<boolean>} whether the destructive action was accepted
 */
export const confirmAction = ({ title, body, confirmLabel }) =>
  new Promise((resolve) => {
    el.confirmTitle.textContent = title
    el.confirmText.textContent = body
    el.confirmOk.textContent = confirmLabel
    el.confirmModal.addEventListener(
      "close",
      () => resolve(el.confirmModal.returnValue === "ok"),
      { once: true } // Esc and the backdrop both land here, as a "no"
    )
    el.confirmModal.showModal()
  })

/**
 * Toggle an element's visibility.
 *
 * @param {HTMLElement} node
 * @param {boolean} visible
 */
export const show = (node, visible) => node.classList.toggle("hidden", !visible)
