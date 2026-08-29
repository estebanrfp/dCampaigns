/**
 * The network, made visible.
 *
 * Every other screen here shows work. This one shows the thing that carries it:
 * the peers themselves, where they are, right now. A centralised product can
 * report how many accounts are logged in; it has no peers to draw, because
 * everyone is talking to the same machine and to nobody else.
 *
 * Three decisions, each of them the point rather than a detail:
 *
 * **It is opt-in and off by default.** An application whose argument is that it
 * asks you for nothing cannot open by asking for your position.
 *
 * **It is coarse.** Coordinates are rounded to one decimal — roughly eleven
 * kilometres — before they leave the device. That is enough to say a peer is
 * near Madrid and not enough to say which street, and rounding *before*
 * broadcasting is what makes that a property of the data rather than a promise
 * about the interface.
 *
 * **It travels on a channel and never reaches the graph.** Presence is true
 * while it is happening and meaningless afterwards; writing it to a replicated
 * graph would leave a permanent record of where people have been, on every
 * peer's disk, forever. The channel forgets, which is the correct behaviour.
 *
 * The basemap is Esri's dark canvas, which serves without a key. The ecosystem's
 * geo examples use CARTO's `dark_all`, and that provider now stamps
 * "API KEY REQUIRED" across every tile it returns — the tile still arrives with
 * a 200, so only looking at it reveals the problem. Worth knowing before
 * copying those examples.
 */
import { elt } from "./dom.js"

/** Read a palette value, so Leaflet can be handed colours it understands. */
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Channel names are capped at 12 bytes by GenosRTC. */
const CHANNEL = "peer-where"

/** ~11 km. Enough to place someone, not enough to find them. */
const round = (value) => Math.round(value * 10) / 10

/** How long a peer stays on the plot after its last word. */
const STALE_MS = 90_000

/**
 * Start showing the network, and let the viewer join it if they choose.
 *
 * @param {object} db - The database.
 * @param {HTMLElement} mount - Where the panel goes.
 * @returns {Function} Teardown.
 */
export const livePeerMap = (db, mount) => {
  const seen = new Map() // peerId → { lat, lon, at }
  let watcher = null
  let sharing = false

  const plot = elt("div", { className: "peer-plot" })
  const status = elt("p", { className: "hint" })
  const toggle = elt("button", { textContent: "Show my region" })

  /**
   * Esri's dark and light canvases, which serve without a key.
   *
   * The ecosystem's geo examples reach for CARTO's `dark_all`, and that
   * provider now returns every tile stamped "API KEY REQUIRED" — with a 200,
   * so nothing but looking at it says so.
   */
  const BASEMAPS = {
    dark: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    light: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  }
  const palette = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark")

  let map = null
  let basemap = null
  const markers = new Map()

  const ensureMap = () => {
    if (map || !window.L) return map
    map = L.map(plot, { zoomControl: false, attributionControl: true, worldCopyJump: true }).setView([20, 0], 1)
    basemap = L.tileLayer(BASEMAPS[palette()], {
      maxZoom: 12,
      attribution: "Esri",
    }).addTo(map)
    L.control.zoom({ position: "bottomright" }).addTo(map)
    return map
  }

  // Leaflet takes its colours as values rather than CSS, so a palette change
  // has to be handed to it — the same way the ecosystem's geo examples do it.
  const themeWatcher = new MutationObserver(() => basemap?.setUrl(BASEMAPS[palette()]))
  themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })

  const draw = () => {
    const now = Date.now()
    for (const [id, entry] of seen) if (now - entry.at > STALE_MS) seen.delete(id)
    if (!ensureMap()) return

    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }

    for (const [id, { lat, lon }] of seen) {
      const existing = markers.get(id)
      if (existing) {
        existing.setLatLng([lat, lon])
        continue
      }
      // A circle in the accent, not a pin: a pin points at an address, and this
      // is deliberately only accurate to about eleven kilometres.
      const marker = L.circleMarker([lat, lon], {
        radius: 7,
        weight: 2,
        color: id === "self" ? token("--ok") : token("--accent"),
        fillColor: id === "self" ? token("--ok") : token("--accent"),
        fillOpacity: 0.35,
      }).addTo(map)
      marker.bindTooltip(id === "self" ? "You" : "A peer")
      markers.set(id, marker)
    }

    const others = seen.size - (seen.has("self") ? 1 : 0)
    status.textContent = seen.size
      ? `${seen.size} ${seen.size === 1 ? "peer" : "peers"} on the map — ${others} of them somebody else's device, reached directly.`
      : sharing
        ? "Sharing. Nobody else has, so the map is yours alone."
        : "Nobody is sharing a region. This is a live picture of the network, not a record — nothing here is written to the graph."
  }

  const channel = db.room?.channel(CHANNEL)

  channel?.on("message", (message, peerId) => {
    if (typeof message?.lat !== "number" || typeof message?.lon !== "number") return
    seen.set(peerId, { lat: message.lat, lon: message.lon, at: Date.now() })
    draw()
  })

  // A newcomer sees an empty plot until somebody moves, so answer their arrival.
  const greet = () => sharing && announce()
  db.room?.on("peer:join", greet)

  let last = null
  const announce = () => last && channel?.send(last)

  const startSharing = () => {
    if (!navigator.geolocation) {
      status.textContent = "This browser will not report a position."
      return
    }
    watcher = navigator.geolocation.watchPosition(
      ({ coords }) => {
        // Rounded here, before anything leaves: the coarseness is in the data,
        // not in how it happens to be displayed.
        last = { lat: round(coords.latitude), lon: round(coords.longitude) }
        seen.set("self", { ...last, at: Date.now() })
        announce()
        draw()
      },
      () => {
        status.textContent = "No position was given, which is a perfectly good answer."
        sharing = false
        toggle.textContent = "Show my region"
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 }
    )
  }

  const stopSharing = () => {
    if (watcher !== null) navigator.geolocation.clearWatch(watcher)
    watcher = null
    last = null
    seen.delete("self")
    draw()
  }

  toggle.onclick = () => {
    sharing = !sharing
    toggle.textContent = sharing ? "Stop sharing" : "Show my region"
    sharing ? startSharing() : stopSharing()
  }

  mount.append(
    elt(
      "div",
      { className: "card" },
      elt("div", { className: "row spread" },
        elt("div", { className: "stat-label", textContent: "Peers, right now" }),
        toggle),
      plot,
      status
    )
  )

  draw()
  const sweep = setInterval(draw, 15_000)

  return () => {
    clearInterval(sweep)
    themeWatcher.disconnect()
    map?.remove()
    map = null
    stopSharing()
    db.room?.off?.("peer:join", greet)
  }
}
