/**
 * The sidebar's search box.
 *
 * A view that fills the sidebar declares what searching means for it: the query
 * it is already subscribed with, and the fields somebody would plausibly type
 * into. Typing rebuilds that subscription with `$text` folded into the query,
 * so the narrowing happens in the engine — the list stays a live subscription,
 * and a node that arrives matching what is typed appears on its own.
 *
 * Hiding rows that were already drawn is the other way to build this, and it
 * stops being true the moment the graph changes underneath. `$text` also folds
 * accents and case before matching, so a search reads the way a person types
 * rather than the way the data happens to be spelled.
 */
const input = document.getElementById("search-input")

/** @type {{query: object, fields: string[], subscribe: Function, live: any}|null} */
let current = null
let timer = null
let generation = 0

/** A view's own query, narrowed by a term across the fields it named. */
const narrow = (query, fields, term) =>
  term ? { $and: [query, { $or: fields.map((field) => ({ [field]: { $text: term } })) }] } : query

/** Swap the live subscription for one narrowed by `term`, newest keystroke wins. */
const resubscribe = async (term) => {
  if (!current) return
  const mine = ++generation
  current.live?.unsubscribe?.()
  current.live = null

  const live = await current.subscribe(narrow(current.query, current.fields, term), term)
  // A later keystroke resolved first: this one is stale and owns nothing.
  if (mine !== generation) return live?.unsubscribe?.()
  if (current) current.live = live
}

/**
 * Hand the search box to the list currently in the sidebar.
 * @param {object} spec
 * @param {object} spec.query The view's own query; narrowed, never replaced.
 * @param {string[]} spec.fields Fields the term is matched across.
 * @param {string} [spec.placeholder] What the box invites, for this list.
 * @param {(query: object, term: string) => Promise<any>} spec.subscribe
 * @returns {Promise<{unsubscribe: Function}>} Teardown, shaped like `db.map`'s.
 */
export const searchable = async ({ query, fields, placeholder = "Search…", subscribe }) => {
  generation += 1
  current = { query, fields, subscribe, live: null }
  input.value = ""
  input.placeholder = placeholder
  input.disabled = false

  current.live = await subscribe(query, "")

  return {
    unsubscribe: () => {
      clearTimeout(timer)
      generation += 1
      current?.live?.unsubscribe?.()
      current = null
      input.value = ""
      input.placeholder = "Search…"
      input.disabled = true
    },
  }
}

// Nothing is searchable until a view says otherwise: a box that accepts typing
// and answers nothing is worse than one that is plainly not available yet.
if (input) {
  input.disabled = true
  input.addEventListener("input", () => {
    clearTimeout(timer)
    timer = setTimeout(() => resubscribe(input.value.trim()), 180)
  })
}

/** The empty state a list should show while a search is narrowing it. */
export const emptyFor = (term, fallback) => (term ? `Nothing matches “${term}”.` : fallback)
