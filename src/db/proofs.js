/**
 * Evidence too large to live in the graph.
 *
 * A replicated graph is the right home for a claim and the wrong one for a
 * twelve-megabyte screen recording: every peer would carry it forever, whether
 * or not anyone ever looks. So above a threshold the bytes stay on the machine
 * that made them and travel directly to whoever asks, over a data channel.
 *
 * What is always in the graph is the part that matters — the digest, written
 * into the delivery and signed before any verdict exists. The transport can be
 * whatever suits the size; the claim about *which file* is settled either way,
 * and the receiver checks the bytes against it before showing anything.
 *
 * The cost is honest and worth stating: a channel reaches whoever is connected
 * at that moment. Evidence held this way is available when its author is, which
 * is why anything small enough goes in the graph instead and is there whether
 * they are or not.
 */

const DB_NAME = "dcampaigns-proofs"
const STORE = "files"

/** Channel names are capped at 12 bytes by GenosRTC, so these are terse. */
const REQUEST_CHANNEL = "proof-req"
const DELIVER_CHANNEL = "proof"

/** How long to wait for a peer that may simply not be online. */
const FETCH_TIMEOUT_MS = 20_000

/**
 * The local shelf. Deliberately outside the graph: this is the one place in the
 * app where data is *not* meant to replicate.
 *
 * @returns {Promise<IDBDatabase>}
 */
const shelf = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

/**
 * Keep a file the graph will not carry.
 *
 * @param {string} proofId
 * @param {Blob} blob
 * @returns {Promise<void>}
 */
export const stash = async (proofId, blob) => {
  const idb = await shelf()
  await new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(blob, proofId)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  idb.close()
}

/**
 * Read a stashed file back, if this device is the one holding it.
 *
 * @param {string} proofId
 * @returns {Promise<Blob|null>}
 */
export const stashed = async (proofId) => {
  const idb = await shelf()
  const blob = await new Promise((resolve, reject) => {
    const request = idb.transaction(STORE, "readonly").objectStore(STORE).get(proofId)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
  })
  idb.close()
  return blob
}

/**
 * Answer requests for evidence this device holds.
 *
 * Wired once at boot and left running: a creator serving their own files is not
 * a background job, it is what being a peer means. A request for something this
 * device never had is met with silence rather than an error — several peers
 * hear every request, and only the one holding it has anything to say.
 *
 * @param {object} db - The database.
 * @returns {Function} Teardown.
 */
export const serveProofs = (db) => {
  if (!db.room) return () => {}

  const requests = db.room.channel(REQUEST_CHANNEL)
  const deliveries = db.room.channel(DELIVER_CHANNEL)

  requests.on("message", async (message, peerId) => {
    const proofId = message?.proofId
    if (!proofId) return
    try {
      const blob = await stashed(proofId)
      if (!blob) return // not ours to answer
      // `meta` rides only with binary payloads, which is what this is.
      await deliveries.send(await blob.arrayBuffer(), peerId, { proofId })
    } catch (error) {
      console.error("[dCampaigns] could not serve evidence:", error)
    }
  })

  return () => {}
}

/**
 * Ask the network for evidence this device does not hold.
 *
 * @param {object} db - The database.
 * @param {string} proofId
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Promise<ArrayBuffer|null>} Null if nobody answered in time.
 */
export const fetchProof = (db, proofId, onProgress) =>
  new Promise((resolve) => {
    if (!db.room) return resolve(null)

    const deliveries = db.room.channel(DELIVER_CHANNEL)
    const requests = db.room.channel(REQUEST_CHANNEL)

    const timer = setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)
    const done = (buffer) => {
      clearTimeout(timer)
      resolve(buffer)
    }

    deliveries.on("message", (data, _peerId, meta) => {
      if (meta?.proofId === proofId) done(data)
    })
    if (onProgress) {
      deliveries.on("progress", (fraction, _peerId, meta) => {
        if (meta?.proofId === proofId) onProgress(fraction)
      })
    }

    requests.send({ proofId })
  })
