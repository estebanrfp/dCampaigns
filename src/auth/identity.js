/**
 * The identity door — the canonical GenosDB flow, plus the one thing this
 * product adds: a newcomer declares which side they came for.
 *
 * There is no server to log into, so this is a door onto a graph that is
 * already on the visitor's machine. Every button is derived from the security
 * state the Security Manager publishes; nothing here keeps a phase flag of its
 * own, which is what makes each pass idempotent and safe to repeat.
 */
import { SUPERADMIN } from "../db/config.js"
import { saveProfile } from "../db/model.js"
import { show, toast } from "../ui/feedback.js"

const $ = (id) => document.getElementById(id)

const el = {
  modal: $("identity-modal"),
  mnemonic: $("mnemonic-input"),
  phraseWarning: $("phrase-warning"),
  generate: $("generate-btn"),
  clip: $("mnemonic-clip"),
  passkeyProtect: $("passkey-protect-btn"),
  passkeyLogin: $("passkey-login-btn"),
  login: $("login-btn"),
  demoLogin: $("demo-login-btn"),
  passkeyUpgrade: $("passkey-upgrade-btn"),
  onboarding: $("onboarding-modal"),
  pickCreator: $("pick-creator"),
  pickClient: $("pick-client"),
  displayName: $("display-name"),
  onboard: $("onboard-btn"),
}

/**
 * Passkeys need two things, and only the first is obvious: a secure context,
 * and a valid RP ID. WebAuthn derives the RP ID from the hostname and requires
 * a *domain* — an IP is never one, so 127.0.0.1 passes every check you would
 * think to make and then fails at registration with "invalid domain".
 */
const PASSKEYS_AVAILABLE =
  window.isSecureContext &&
  !!window.PublicKeyCredential &&
  !/^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname)

/** The side picked in the onboarding dialog, before it is written. */
let pickedSide = null

const autoGrow = () => {
  const field = el.mnemonic
  field.style.height = "auto"
  // scrollHeight excludes borders, and box-sizing counts them in height.
  const borders = field.offsetHeight - field.clientHeight
  field.style.height = `${field.scrollHeight + borders}px`
}

const syncClipAffordance = () => show(el.clip, !!el.mnemonic.value.trim())

/**
 * Draw the door from the session state alone.
 *
 * @param {object} db - The directory instance.
 * @param {import('genosdb').SecurityState} state
 */
const renderIdentityModal = (db, { isActive, hasVolatileIdentity, hasWebAuthnHardwareRegistration, isWebAuthnProtected }) => {
  // `hasVolatileIdentity` stays true after signing in with a fresh phrase — the
  // identity lives in memory until a passkey secures it. Onboarding, though,
  // ends the moment you are in, and the phrase must not outlive it on screen.
  const onboarding = hasVolatileIdentity && !isActive

  show(el.generate, !onboarding)
  show(el.passkeyProtect, onboarding && PASSKEYS_AVAILABLE && !isWebAuthnProtected)
  show(el.passkeyLogin, !onboarding && PASSKEYS_AVAILABLE && hasWebAuthnHardwareRegistration)
  show(el.demoLogin, !onboarding) // hidden while a fresh phrase is unsaved
  show(el.phraseWarning, onboarding) // only a fresh phrase can still be lost
  el.mnemonic.readOnly = onboarding

  // The phrase is the SM's to hand over — the app never keeps a copy.
  if (onboarding) {
    el.mnemonic.value = db.sm.getMnemonicForDisplayAfterRegistrationOrRecovery() ?? el.mnemonic.value
  } else if (isActive || document.activeElement !== el.mnemonic) {
    el.mnemonic.value = "" // signed in: always clear. Signed out: never mid-paste.
  }

  syncClipAffordance()
  autoGrow()
}

/**
 * Wire the door and take ownership of the session UI.
 *
 * @param {object} db - The directory instance.
 * @param {(state: object) => void} onSession - Called on every session change,
 *   after the modal has been drawn. The app renders itself from here.
 * @returns {Promise<void>}
 */
export const initIdentity = async (db, onSession) => {
  el.generate.onclick = async () => {
    if (!(await db.sm.startNewUserRegistration())) return toast("Could not generate an identity", "error")
    toast("Identity generated — save the phrase before you leave", "success")
  }

  el.login.onclick = async () => {
    const mnemonic = el.mnemonic.value.trim()
    if (!mnemonic) return toast("Paste a mnemonic phrase first", "error")
    try {
      await db.sm.loginOrRecoverUserWithMnemonic(mnemonic)
    } catch {
      toast("That mnemonic is not valid", "error")
    }
  }

  /**
   * Registering a passkey succeeds before it is durable.
   *
   * The security state changes — and the UI reacts — a moment before the
   * encrypted key material and the resume flag are stored. Reloading inside
   * that window loses the passkey that was just created, silently, and the next
   * visit asks for the phrase again. So nothing is announced until the SM says
   * a registration exists on this origin.
   */
  const registrationIsDurable = async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await db.sm.hasExistingWebAuthnRegistration()) return true
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return false
  }

  const protectWithPasskey = async () => {
    try {
      if (!(await db.sm.protectCurrentIdentityWithWebAuthn())) return toast("Passkey registration cancelled", "error")
      if (!(await registrationIsDurable())) return toast("The passkey did not finish saving — try again", "error")
      toast("Passkey saved — this device will sign you in from now on", "success")
    } catch {
      toast("Could not register the passkey", "error")
    }
  }

  el.passkeyProtect.onclick = protectWithPasskey
  el.passkeyUpgrade.onclick = protectWithPasskey

  el.passkeyLogin.onclick = async () => {
    try {
      if (!(await db.sm.loginCurrentUserWithWebAuthn())) toast("Passkey login cancelled", "error")
    } catch {
      toast("Could not sign in with the passkey", "error")
    }
  }

  el.demoLogin.onclick = () => db.sm.loginOrRecoverUserWithMnemonic(SUPERADMIN.mnemonic)

  el.clip.onclick = async () => {
    await navigator.clipboard.writeText(el.mnemonic.value.trim())
    toast("Phrase copied", "success")
  }

  el.mnemonic.addEventListener("input", () => {
    syncClipAffordance()
    autoGrow()
  })

  // Nothing is usable without an identity, so the door is mandatory: Esc is
  // native to <dialog> and has to be refused explicitly, and the backdrop has
  // no handler at all.
  el.modal.addEventListener("cancel", (event) => {
    if (!db.sm.isSecurityActive()) event.preventDefault()
  })

  // ── Onboarding ────────────────────────────────────────────────────
  const pick = (side) => {
    pickedSide = side
    el.pickCreator.setAttribute("aria-pressed", String(side === "creator"))
    el.pickClient.setAttribute("aria-pressed", String(side === "client"))
  }
  el.pickCreator.onclick = () => pick("creator")
  el.pickClient.onclick = () => pick("client")

  el.onboard.onclick = async () => {
    if (!pickedSide) return toast("Pick a side first", "error")
    const address = db.sm.getActiveEthAddress()
    try {
      await saveProfile(db, address, {
        displayName: el.displayName.value.trim() || db.sm.abbrAddr(address),
        requestedSide: pickedSide,
      })
      el.onboarding.close()
      toast("Side declared — a superadmin signs the role from here", "success")
    } catch {
      toast("Could not write your profile", "error")
    }
  }

  el.onboarding.addEventListener("cancel", (event) => event.preventDefault())

  /**
   * The single source of truth for the session. It opens and closes the door,
   * resets the field and hands the state to the app.
   *
   * The data subscriptions are deliberately NOT touched here: re-subscribing on
   * every session change tears down the live subscription and freezes the other
   * window.
   */
  const onSecurityStateChange = async (state) => {
    renderIdentityModal(db, state)
    onSession(state)

    // The upgrade is offered exactly while it is useful: a live session that
    // still depends on a phrase nobody wants to retype at every room.
    show(el.passkeyUpgrade, state.isActive && PASSKEYS_AVAILABLE && !state.isWebAuthnProtected)

    if (!state.isActive) {
      if (!el.modal.open) el.modal.showModal()
      return
    }

    el.modal.close()

    // The operator declares no side: governance is immune to superadmins, so
    // the write would lead nowhere, and the platform is neither party.
    if (state.activeAddress === SUPERADMIN.address) return

    // Any other signed-in identity with no profile still owes its one write.
    const { result } = await db.get(`user:${state.activeAddress}`)
    if (!result?.value?.requestedSide && !el.onboarding.open) el.onboarding.showModal()
  }

  db.sm.setSecurityStateChangeCallback(onSecurityStateChange)
}
