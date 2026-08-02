/**
 * German speech.
 *
 * Two engines, in this order:
 *   1. Web Speech API — instant, offline, uses the German voices already on your
 *      Mac (Anna, Eddy, Flo, Reed, Sandy…). No network, no latency.
 *   2. /api/audio — the server's Google TTS proxy, cached to disk. Used when no
 *      German voice is installed, or when you explicitly prefer it.
 *
 * Anything spoken through (2) stays cached, so a studied word plays offline forever.
 */

import { state } from '../store.js'
import { stripArticle } from './normalize.js'

let voices = []
let voicesReady = false

function loadVoices() {
  if (!('speechSynthesis' in window)) return
  voices = window.speechSynthesis.getVoices()
  voicesReady = voices.length > 0
}

if ('speechSynthesis' in window) {
  loadVoices()
  window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
}

/** German voices installed on this machine, best first. */
export function germanVoices() {
  if (!voicesReady) loadVoices()
  return voices
    .filter((v) => v.lang?.toLowerCase().startsWith('de'))
    .sort((a, b) => {
      // Prefer de-DE over de-AT/de-CH, and local voices over network ones.
      const score = (v) => (v.lang === 'de-DE' ? 2 : 0) + (v.localService ? 1 : 0)
      return score(b) - score(a)
    })
}

export const hasGermanVoice = () => germanVoices().length > 0

function pickVoice(lang) {
  if (!voicesReady) loadVoices()
  if (lang === 'de') {
    const list = germanVoices()
    const preferred = state.settings?.voice && list.find((v) => v.name === state.settings.voice)
    return preferred || list[0] || null
  }
  return voices.find((v) => v.lang === 'en-US' && v.localService)
    || voices.find((v) => v.lang?.startsWith('en'))
    || null
}

let currentAudio = null

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  if (currentAudio) { currentAudio.pause(); currentAudio = null }
}

/**
 * Speak text. Returns a promise that resolves when playback ends.
 * `text` may include an article ("das Haus") — we keep it, because hearing
 * "das Haus" is exactly how you should be learning the gender.
 */
export async function speak(text, opts = {}) {
  const clean = String(text || '').trim()
  if (!clean) return

  const lang = opts.lang || 'de'
  const rate = opts.rate ?? state.settings?.speechRate ?? 0.9
  stopSpeaking()

  const voice = pickVoice(lang)
  if (voice && !opts.forceServer) {
    return new Promise((resolve) => {
      const utt = new SpeechSynthesisUtterance(clean)
      utt.voice = voice
      utt.lang = voice.lang
      utt.rate = rate
      utt.pitch = 1
      utt.onend = resolve
      utt.onerror = () => serverAudio(clean, lang, rate).then(resolve).catch(resolve)
      window.speechSynthesis.speak(utt)
    })
  }
  return serverAudio(clean, lang, rate)
}

/** Server-side TTS, cached on disk. */
export function serverAudio(text, lang = 'de', rate = 1) {
  return new Promise((resolve, reject) => {
    const speed = rate < 0.8 ? '0.24' : '1'
    const url = `/api/audio?text=${encodeURIComponent(text)}&lang=${lang}&speed=${speed}`
    const audio = new Audio(url)
    currentAudio = audio
    audio.onended = () => { currentAudio = null; resolve() }
    audio.onerror = () => { currentAudio = null; reject(new Error('audio failed')) }
    audio.play().catch(reject)
  })
}

/** Speak a word the way you should hear it: article included for nouns. */
export const speakWord = (word, opts) =>
  speak(word.partOfSpeech === 'noun' ? word.word : stripArticle(word.word), opts)

export const speakSentence = (sentence, opts) => speak(sentence, { ...opts, lang: 'de' })

/** Slow, deliberate repeat — for when you can't catch a word in listening mode. */
export const speakSlowly = (text) => speak(text, { rate: 0.55 })

/** Warm the disk cache for a set of words without playing anything. */
export async function prefetchAudio(words, onProgress) {
  let done = 0
  for (const w of words) {
    const text = w.partOfSpeech === 'noun' ? w.word : stripArticle(w.word)
    try { await fetch(`/api/audio?text=${encodeURIComponent(text)}&lang=de&speed=1`) } catch {}
    onProgress?.(++done, words.length)
  }
}
