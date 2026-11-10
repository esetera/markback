/**
 * Speaking a comment into a text box. What matters most is where the sound goes, so a route is chosen first and said out loud:
 *
 *   device     Chrome's on-device speech: stays on this computer
 *   install    the same, once a language pack of about 60 MB is fetched, on a press
 *   cloud      the browser sends the sound to its maker: off until the person turns it on
 *   none       no microphone here, and it says what to do
 */

export const COMMANDS = { 'looks good': 'good', next: 'next', back: 'back', previous: 'back', send: 'send', 'send it': 'send', 'stop listening': 'stop' }

/** A whole phrase that is a command, and nothing else. A comment with "next" in it is a comment. */
export function commandIn(phrase) {
  return COMMANDS[String(phrase).toLowerCase().replace(/[^a-z ]+/g, '').trim()] ?? null
}

/** Which route, from what this browser says. Plain, so it can be tested without one. */
export function routeFor({ hasSpeech, micState, onDevice, vendor }) {
  if (micState === 'denied') return { route: 'none', why: 'This window has no microphone. Open this page in Chrome to speak.' }
  if (!hasSpeech) return { route: 'none', why: 'This browser cannot turn speech into words. Open this page in Chrome to speak.' }
  if (onDevice === 'available') return { route: 'device' }
  if (onDevice === 'downloadable' || onDevice === 'downloading') return { route: 'install' }
  return { route: 'cloud', goesTo: vendor }
}

const vendorOf = nav => (/Apple/.test(nav.vendor ?? '') ? 'Apple' : /Edg\//.test(nav.userAgent) ? 'Microsoft' : 'Google')
const Recognition = () => window.SpeechRecognition ?? window.webkitSpeechRecognition

export async function findRoute() {
  const SR = Recognition()
  const lang = navigator.language || 'en-US'
  let micState = 'prompt'
  try {
    micState = (await navigator.permissions.query({ name: 'microphone' })).state
  } catch {
    // Not every browser can say. Pressing the button asks.
  }
  let onDevice = 'unavailable'
  try {
    if (SR?.available && 'processLocally' in SR.prototype) onDevice = await SR.available({ langs: [lang], processLocally: true })
  } catch {
    onDevice = 'unavailable'
  }
  return { ...routeFor({ hasSpeech: !!SR, micState, onDevice, vendor: vendorOf(navigator) }), lang }
}

/** Fetches the language pack, on a press. True when it is here. */
export async function installPack(lang) {
  return Recognition().install({ langs: [lang], processLocally: true })
}

/**
 * Listens and writes into whichever box `box()` gives. Words still being heard show as they come and are replaced as they
 * settle. What is typed meanwhile stays. `onCommand` gets a phrase that was only a command, and it leaves no words behind.
 */
export function createListener({ box, local, lang, onCommand, onState, onProblem }) {
  let rec = null
  let wanted = false
  // The phrase being heard belongs to a box that has gone: what is left of it is let go, to its last settled word.
  let skipping = false
  let hearing = ''
  let hearingIn = null

  const dropHearing = () => {
    const el = hearingIn
    if (el && hearing && el.value.endsWith(hearing)) el.value = el.value.slice(0, -hearing.length)
    hearing = ''
    hearingIn = null
  }
  const put = (el, words) => {
    el.value = words
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.scrollTop = el.scrollHeight
  }
  const joined = (before, words) => `${before}${before && !/\s$/.test(before) ? ' ' : ''}${words}`

  const heard = event => {
    if (skipping) {
      // The rest of that phrase must not land in whatever box is asked for next.
      for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) skipping = false
      return
    }
    const el = box()
    if (!el) return
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const words = event.results[i][0].transcript.trim()
      if (!event.results[i].isFinal) continue
      dropHearing()
      const command = onCommand ? commandIn(words) : null
      if (command) {
        put(el, el.value)
        if (command === 'stop') stop()
        else onCommand(command)
      } else if (words) put(el, joined(el.value, words))
    }
    let still = ''
    for (let i = event.resultIndex; i < event.results.length; i++) if (!event.results[i].isFinal) still += event.results[i][0].transcript
    dropHearing()
    still = still.trim()
    if (still) {
      const before = el.value
      const shown = joined(before, still)
      hearing = shown.slice(before.length)
      hearingIn = el
      put(el, shown)
    }
  }

  function begin() {
    // Each recogniser answers only while it is the one in use: one that is still ending must not hear, or start another.
    const mine = new (Recognition())()
    rec = mine
    mine.lang = lang
    mine.continuous = true
    mine.interimResults = true
    if (local) mine.processLocally = true
    mine.onresult = event => rec === mine && heard(event)
    mine.onerror = event => {
      if (rec !== mine || event.error === 'no-speech' || event.error === 'aborted') return
      wanted = false
      onProblem(event.error === 'not-allowed' ? 'The microphone is blocked. Allow it for this page in the browser.' : `Speech stopped: ${event.error}.`)
    }
    // It stops by itself after a silence. Still on means carry on.
    mine.onend = () => {
      if (rec !== mine) return
      if (wanted) begin()
      else {
        dropHearing()
        onState(false)
      }
    }
    mine.start()
  }

  function start() {
    if (wanted) return
    wanted = true
    onState(true)
    begin()
  }
  function stop() {
    wanted = false
    skipping = false
    const ending = rec
    rec = null
    ending?.stop()
    dropHearing()
    onState(false)
  }
  /** The box the phrase was going to has gone: keep what was heard so far there, and let the rest of the phrase go. */
  function skip() {
    if (!hearing) return
    hearing = ''
    hearingIn = null
    skipping = true
  }
  return { start, stop, skip, toggle: () => (wanted ? stop() : start()), get on() { return wanted } }
}
