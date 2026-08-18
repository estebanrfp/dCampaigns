/**
 * Theme: values only.
 *
 * Two attributes, because they answer different questions. `data-theme` is the
 * palette in force, which is what the CSS paints from. `data-pref` is what the
 * reader asked for, and only it can tell "dark because I chose dark" from "dark
 * because the OS is dark" — the distinction the third state exists for.
 */

const THEME_ORDER = ["system", "light", "dark"]
const systemTheme = matchMedia("(prefers-color-scheme: light)")
const themeBtn = document.getElementById("theme-btn")

/**
 * Apply a theme preference and remember it.
 *
 * @param {'system'|'light'|'dark'} pref
 */
export const applyTheme = (pref) => {
  const root = document.documentElement
  root.dataset.pref = pref
  root.dataset.theme = pref === "system" ? (systemTheme.matches ? "light" : "dark") : pref
  localStorage.dcampaignsTheme = pref
  themeBtn.title = `Theme: ${pref}`
}

/** Wire the toggle and follow the OS while the preference is `system`. */
export const initTheme = () => {
  systemTheme.addEventListener("change", () => {
    if (document.documentElement.dataset.pref === "system") applyTheme("system")
  })

  themeBtn.onclick = () =>
    applyTheme(THEME_ORDER[(THEME_ORDER.indexOf(document.documentElement.dataset.pref) + 1) % THEME_ORDER.length])

  applyTheme(localStorage.dcampaignsTheme ?? "system")
}
