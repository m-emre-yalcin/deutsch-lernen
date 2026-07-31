/**
 * App state + persistence.
 *
 * Progress lives in three places on purpose:
 *   1. memory        — what the UI reads
 *   2. the server    — data/progress.json, the real record, backed up daily
 *   3. localStorage  — a mirror, so a dead server never costs you a session
 *
 * On load we take whichever of (2) and (3) is newer, so you can't lose work by
 * studying while the server happens to be down.
 */

import { newCard, newQuickState } from './srs.js'

const LS_KEY = 'deutsch_lernen_v3'
const SAVE_DEBOUNCE = 2000

export const DEFAULT_SETTINGS = {
  newPerDay: 15,
  maxReviews: 120,
  targetRetention: 0.9,
  direction: 'de-en',        // de-en | en-de | mixed
  voice: null,               // preferred SpeechSynthesis voice name
  speechRate: 0.9,
  autoPlayAudio: true,
  showImages: true,
  theme: 'auto',             // auto | light | dark
  modes: { mc: true, flashcard: true, typing: true, listening: true, cloze: true, conjugation: true },
  genderDrillRatio: 0.2,     // share of a session spent on der/die/das
  verbDrillRatio: 0.15,      // share of a session spent on conjugation
  levels: ['A0', 'A1', 'A2'],
  categories: [],            // empty = all
  typingStrict: false,       // false = accept ue/oe/ae/ss for ü/ö/ä/ß
}

export const state = {
  words: [],
  wordsById: new Map(),
  grammar: [],
  meta: {},
  progress: null,
  settings: { ...DEFAULT_SETTINGS },
  pendingReviews: [],
  online: true,
  loaded: false,
}

const listeners = new Set()
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const emit = (evt, data) => listeners.forEach((fn) => fn(evt, data))

const emptyProgress = () => ({
  version: 2,
  updatedAt: new Date(0).toISOString(),
  cards: {},
  gender: {},      // nouns — der/die/das quick track
  verbs: {},       // verbs — conjugation quick track
  grammar: {},
  daily: {},
  settings: {},
  stats: { totalReviews: 0, streak: 0, longestStreak: 0, lastStudyDate: null },
})

// ─── LOAD ─────────────────────────────────────────────────────────────────────

export async function loadAll() {
  const deck = await fetch('/api/deck').then((r) => r.json())
  state.words = deck.words || []
  state.grammar = deck.grammar || []
  state.meta = deck.meta || {}
  state.wordsById = new Map(state.words.map((w) => [w.id, w]))

  let server = null
  try {
    server = await fetch('/api/progress').then((r) => r.json())
    state.online = true
  } catch {
    state.online = false
  }

  let local = null
  try { local = JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch {}

  // Newest wins — studying offline must never be silently thrown away.
  const pick = (a, b) => {
    if (!a) return b
    if (!b) return a
    return new Date(a.updatedAt || 0) >= new Date(b.updatedAt || 0) ? a : b
  }
  state.progress = { ...emptyProgress(), ...(pick(server, local) || {}) }
  state.settings = { ...DEFAULT_SETTINGS, ...(state.progress.settings || {}) }
  state.settings.modes = { ...DEFAULT_SETTINGS.modes, ...(state.progress.settings?.modes || {}) }

  // If localStorage was ahead, push it up immediately.
  if (local && server && new Date(local.updatedAt || 0) > new Date(server.updatedAt || 0)) {
    saveNow()
  }

  // Reviews queued while the server was unreachable in an earlier session.
  restorePendingReviews()

  state.loaded = true
  emit('loaded')
  return state
}

/** Re-read the deck from the server — after adding a word, or editing a file. */
export async function reloadDeck() {
  const deck = await fetch('/api/deck?reload=1').then((r) => r.json())
  state.words = deck.words || []
  state.grammar = deck.grammar || []
  state.meta = deck.meta || {}
  state.wordsById = new Map(state.words.map((w) => [w.id, w]))
  emit('loaded')
  return state.words.length
}

/** Add a word of your own. The server writes it to data/vocab/00-my-words.json. */
export async function addWord(fields) {
  const res = await fetch('/api/words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error || 'Could not add the word.')
  await reloadDeck()
  return body.word
}

// ─── SAVE ─────────────────────────────────────────────────────────────────────

let saveTimer = null
let saving = false
let saveAgain = false

export function save() {
  writeLocal()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE)
}

function writeLocal() {
  state.progress.updatedAt = new Date().toISOString()
  state.progress.settings = state.settings
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.progress)) } catch {}
}

export async function saveNow() {
  clearTimeout(saveTimer)
  if (saving) { saveAgain = true; return }
  saving = true
  writeLocal()

  try {
    const res = await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.progress),
    })

    if (res.status === 409) {
      // The server has meaningfully newer progress (another tab, another
      // machine). Merge card-by-card, keeping whichever side reviewed each
      // card last — that loses nothing from either session.
      const { server } = await res.json()
      if (server?.cards) {
        mergeProgress(server)
        writeLocal()
        const retry = await fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.progress),
        })
        if (!retry.ok) throw new Error(`save failed after merge: ${retry.status}`)
        emit('loaded')   // views re-render with the merged truth
      }
    } else if (!res.ok) {
      throw new Error(`save failed: ${res.status}`)
    }

    state.online = true
    await flushReviews()
  } catch (e) {
    state.online = false
    console.warn('Progress kept locally only:', e.message)
  } finally {
    saving = false
    emit('saved', state.online)
    if (saveAgain) { saveAgain = false; save() }
  }
}

/**
 * Merge another progress state into ours, per key, newest review wins.
 * Used when the server refuses a stale write — typically two open tabs.
 */
function mergeProgress(server) {
  const mine = state.progress
  for (const [id, card] of Object.entries(server.cards || {})) {
    const ours = mine.cards[id]
    if (!ours || (card.lastReview || 0) > (ours.lastReview || 0)) mine.cards[id] = card
  }
  for (const key of ['gender', 'verbs']) {
    for (const [id, s] of Object.entries(server[key] || {})) {
      const ours = mine[key]?.[id]
      if (!ours || (s.lastReview || 0) > (ours.lastReview || 0)) (mine[key] ||= {})[id] = s
    }
  }
  for (const [id, g] of Object.entries(server.grammar || {})) {
    const ours = mine.grammar[id]
    if (!ours || (g.lastSeen || 0) > (ours.lastSeen || 0)) mine.grammar[id] = g
  }
  // Daily counters: take the larger of each day's numbers rather than summing —
  // both sides saw overlapping history, and overcounting inflates streak stats.
  for (const [day, d] of Object.entries(server.daily || {})) {
    const ours = mine.daily[day]
    if (!ours) { mine.daily[day] = d; continue }
    for (const k of ['reviews', 'newCards', 'correct', 'ms']) {
      ours[k] = Math.max(ours[k] || 0, d[k] || 0)
    }
  }
  const ss = server.stats || {}, ms = mine.stats
  ms.totalReviews = Math.max(ms.totalReviews || 0, ss.totalReviews || 0)
  ms.longestStreak = Math.max(ms.longestStreak || 0, ss.longestStreak || 0)
  if ((ss.lastStudyDate || '') > (ms.lastStudyDate || '')) {
    ms.lastStudyDate = ss.lastStudyDate
    ms.streak = ss.streak
  }
}

/** Every rating, appended to data/reviews.jsonl. Batched, never lost on failure. */
const PENDING_KEY = 'deutsch_lernen_pending_reviews'

export function logReview(entry) {
  state.pendingReviews.push({ t: Date.now(), ...entry })
  // Mirror to localStorage so a session studied while the server was down
  // still reaches reviews.jsonl after a restart, not just this tab's memory.
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(state.pendingReviews)) } catch {}
}

export function restorePendingReviews() {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]')
    if (Array.isArray(saved) && saved.length) state.pendingReviews.push(...saved)
  } catch {}
}

async function flushReviews() {
  if (!state.pendingReviews.length) return
  const batch = state.pendingReviews.splice(0)
  try {
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviews: batch }),
    })
    // A non-2xx is a failure too — previously it silently discarded the batch.
    if (!res.ok) throw new Error(`reviews: ${res.status}`)
    try { localStorage.removeItem(PENDING_KEY) } catch {}
  } catch {
    state.pendingReviews.unshift(...batch)   // put them back, try next save
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(state.pendingReviews)) } catch {}
  }
}

/**
 * Last chance to persist when the tab closes.
 *
 * Order matters, because each step is a weaker guarantee than the last:
 *
 *  1. writeLocal() — synchronous, no size limit, always succeeds. This is the
 *     real safety net: on the next load, whichever of localStorage / server is
 *     newer wins, so anything the network steps miss is recovered then.
 *  2. sendBeacon — best effort. Browsers cap a beacon at 64 KB, and progress
 *     passes that at roughly 120 studied cards, after which the browser simply
 *     refuses it. Sending anyway would be theatre, so the size is checked and
 *     the attempt reported.
 *
 * The genuinely reliable network save is the visibilitychange handler in
 * main.js, which runs a full fetch (no size cap) whenever the tab is hidden —
 * and that fires before beforeunload when you close a tab or switch away.
 */
const BEACON_LIMIT = 60 * 1024   // a little under the 64 KB browser cap

window.addEventListener('beforeunload', () => {
  writeLocal()
  try {
    const body = JSON.stringify(state.progress)
    if (body.length <= BEACON_LIMIT) {
      navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }))
    }
    // The review log is small and append-only, so it almost always fits.
    if (state.pendingReviews.length) {
      const reviews = JSON.stringify({ reviews: state.pendingReviews })
      if (reviews.length <= BEACON_LIMIT) {
        navigator.sendBeacon('/api/reviews', new Blob([reviews], { type: 'application/json' }))
      }
    }
  } catch {}
})

// ─── ACCESSORS ────────────────────────────────────────────────────────────────

export const getCard = (id) => state.progress.cards[id] || newCard()
export const setCard = (id, card) => { state.progress.cards[id] = card; save() }
export const getGender = (id) => state.progress.gender[id] || newQuickState()
export const setGender = (id, s) => { state.progress.gender[id] = s; save() }
export const getVerb = (id) => state.progress.verbs?.[id] || newQuickState()
export const setVerb = (id, s) => { (state.progress.verbs ||= {})[id] = s; save() }
export const getWord = (id) => state.wordsById.get(id)

export function updateSettings(patch) {
  Object.assign(state.settings, patch)
  state.progress.settings = state.settings
  save()
  emit('settings', state.settings)
}

export const today = () => new Date().toLocaleDateString('sv')   // YYYY-MM-DD, local time

export function todayStats() {
  const d = today()
  state.progress.daily[d] ||= { reviews: 0, newCards: 0, correct: 0, ms: 0, modes: {} }
  return state.progress.daily[d]
}

/** Record one answer against today's counters and the streak. */
export function recordAnswer({ mode, correct, isNew, ms }) {
  const t = todayStats()
  t.reviews++
  if (correct) t.correct++
  if (isNew) t.newCards++
  if (ms) t.ms += ms
  t.modes[mode] = (t.modes[mode] || 0) + 1

  const st = state.progress.stats
  st.totalReviews = (st.totalReviews || 0) + 1
  bumpStreak()
  save()
}

function bumpStreak() {
  const st = state.progress.stats
  const d = today()
  if (st.lastStudyDate === d) return
  // setDate, not −86400000: on the night the clocks go forward, subtracting a
  // fixed 24 hours lands on the day before yesterday, so a genuinely unbroken
  // streak resets to 1 once a year.
  const y = new Date()
  y.setDate(y.getDate() - 1)
  const yesterday = y.toLocaleDateString('sv')
  st.streak = st.lastStudyDate === yesterday ? (st.streak || 0) + 1 : 1
  st.longestStreak = Math.max(st.longestStreak || 0, st.streak)
  st.lastStudyDate = d
}

// ─── EXPORT / IMPORT ──────────────────────────────────────────────────────────

export function exportProgress() {
  const blob = new Blob([JSON.stringify(state.progress, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `deutsch-lernen-progress-${today()}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function importProgress(file) {
  const text = await file.text()
  const data = JSON.parse(text)
  if (!data || typeof data !== 'object' || !data.cards) {
    throw new Error('That file does not look like a Deutsch Lernen progress export.')
  }
  state.progress = { ...emptyProgress(), ...data }
  state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
  await saveNow()
  emit('loaded')
}

export async function resetProgress() {
  state.progress = emptyProgress()
  state.settings = { ...DEFAULT_SETTINGS }
  await saveNow()
  emit('loaded')
}

/** Weak words, worst first — the list worth actually looking at. */
export function weakWords(limit = 50) {
  return state.words
    .map((w) => ({ word: w, card: state.progress.cards[w.id] }))
    .filter(({ card }) => card && (card.lapses || 0) > 0)
    .sort((a, b) => (b.card.lapses - a.card.lapses) || (a.card.stability - b.card.stability))
    .slice(0, limit)
}

export function exportWeakCsv() {
  const rows = [['word', 'translation', 'level', 'category', 'lapses', 'stability_days', 'reps']]
  for (const { word, card } of weakWords(500)) {
    rows.push([word.word, word.translation, word.level, word.category,
      card.lapses, (card.stability || 0).toFixed(1), card.reps])
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `deutsch-lernen-weak-words-${today()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
