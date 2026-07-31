/**
 * Session engine — decides WHAT you see next and WHY.
 *
 * A session is built from three pools and then interleaved:
 *   due       — cards FSRS says you're about to forget (highest priority)
 *   learning  — cards you failed recently, still in short-term rotation
 *   new       — words you've never met, capped per day so you don't drown
 *
 * Interleaving matters: 30 new words in a row is the fastest way to remember
 * none of them. New cards are spread through the reviews instead.
 */

import {
  state, getCard, setCard, getGender, setGender, getVerb, setVerb,
  recordAnswer, logReview, todayStats,
} from './store.js'
import { schedule, scheduleQuick, isDue, pickMode, AGAIN, GOOD } from './srs.js'
import { shuffle } from './lib/ui.js'

export const MODES = ['mc', 'flashcard', 'typing', 'listening', 'cloze', 'gender', 'conjugation']

/** Words allowed by the current level/category settings. */
export function eligibleWords() {
  const { levels, categories } = state.settings
  return state.words.filter((w) => {
    if (levels?.length && !levels.includes(w.level)) return false
    if (categories?.length && !categories.includes(w.category)) return false
    return true
  })
}

/** Counts for the sidebar badge and the session header. */
export function dueCounts() {
  const now = Date.now()
  const words = eligibleWords()
  let due = 0, learning = 0, fresh = 0

  for (const w of words) {
    const c = state.progress.cards[w.id]
    if (!c || !c.reps) { fresh++; continue }
    if (c.state === 'learning' || c.state === 'relearning') { if (isDue(c, now)) learning++; continue }
    if (isDue(c, now)) due++
  }

  const t = todayStats()
  const newLeft = Math.max(0, (state.settings.newPerDay || 15) - (t.newCards || 0))
  return { due, learning, new: Math.min(fresh, newLeft), newAvailable: fresh, newLeft, total: words.length }
}

/**
 * Build a study queue.
 * @param {object} opts { limit, mode, category, level, onlyNew, onlyDue, ignoreSchedule }
 */
export function buildQueue(opts = {}) {
  const now = Date.now()
  let words = eligibleWords()

  // An explicit id list (weak words, today's new words) overrides every filter —
  // you asked for exactly these cards, in this order.
  if (opts.ids?.length) {
    const byId = new Map(state.words.map((w) => [w.id, w]))
    const chosen = opts.ids.map((id) => byId.get(id)).filter(Boolean)
    return chosen.map((w) => ({
      word: w,
      mode: opts.mode || pickMode(getCard(w.id), w, state.settings.modes),
      genderOnly: opts.mode === 'gender',
      verbOnly: opts.mode === 'conjugation',
      practice: !!opts.ignoreSchedule,
    }))
  }

  if (opts.category) words = words.filter((w) => w.category === opts.category)
  if (opts.level) words = words.filter((w) => w.level === opts.level)
  if (opts.pos) words = words.filter((w) => w.partOfSpeech === opts.pos)

  // Free-practice drills ignore scheduling entirely — you asked to practise,
  // so you get cards whether or not FSRS thinks they're due.
  if (opts.ignoreSchedule) {
    const pool = opts.mode === 'gender'
      ? words.filter((w) => w.partOfSpeech === 'noun' && w.article)
      : opts.mode === 'conjugation'
        ? words.filter((w) => w.partOfSpeech === 'verb' && w.forms?.du)
        : opts.mode === 'cloze'
          ? words.filter((w) => w.cloze?.[0]?.de)
          : words
    return shuffle(pool)
      .slice(0, opts.limit || 30)
      .map((w) => ({
        word: w,
        mode: opts.mode || pickMode(getCard(w.id), w, state.settings.modes),
        genderOnly: opts.mode === 'gender',
        verbOnly: opts.mode === 'conjugation',
        practice: true,
      }))
  }

  const due = [], learning = [], fresh = []
  for (const w of words) {
    const c = state.progress.cards[w.id]
    if (!c || !c.reps) { fresh.push(w); continue }
    if (!isDue(c, now)) continue
    if (c.state === 'learning' || c.state === 'relearning') learning.push(w)
    else due.push(w)
  }

  // Most-overdue first — those are closest to being forgotten outright.
  due.sort((a, b) => (getCard(a.id).due || 0) - (getCard(b.id).due || 0))
  // New words in usefulness order, so the most useful German enters your head first.
  fresh.sort((a, b) => (a.frequency || 9999) - (b.frequency || 9999))

  const t = todayStats()
  // ?? not || — newPerDay of 0 is a deliberate "pause new words", not unset.
  const newBudget = Math.max(0, (state.settings.newPerDay ?? 15) - (t.newCards || 0))
  const reviewCap = state.settings.maxReviews || 120

  const newCards = fresh.slice(0, newBudget)
  const reviewCards = [...learning, ...due].slice(0, reviewCap)

  const interleaved = interleave(reviewCards, newCards)
    .map(({ w, isNew }) => ({ word: w, mode: pickMode(getCard(w.id), w, state.settings.modes), isNew }))

  const withDrills = injectVerbDrills(injectGenderDrills(interleaved))
  return opts.limit ? withDrills.slice(0, opts.limit) : withDrills
}

/** Spread new cards evenly through the reviews instead of clumping them. */
function interleave(reviews, news) {
  const r = shuffle(reviews).map((w) => ({ w, isNew: false }))
  const n = news.map((w) => ({ w, isNew: true }))
  if (!n.length) return r
  if (!r.length) return n

  const out = []
  const gap = r.length / n.length
  let ni = 0
  for (let i = 0; i < r.length; i++) {
    out.push(r[i])
    while (ni < n.length && (ni + 1) * gap <= i + 1) out.push(n[ni++])
  }
  while (ni < n.length) out.push(n[ni++])
  return out
}

/**
 * Sprinkle article-only drills through the session for nouns whose gender is
 * due. They're ~2 seconds each, so they cost almost nothing and they keep
 * der/die/das constantly warm instead of only when the word itself comes up.
 */
function injectGenderDrills(items) {
  const ratio = state.settings.genderDrillRatio ?? 0.2
  // The Settings checkbox must actually switch the mode off — previously only
  // the ratio slider was honoured, so unchecking "Der/die/das" did nothing.
  if (ratio <= 0 || state.settings.modes?.gender === false) return items

  const now = Date.now()
  const seen = new Set(items.map((i) => i.word.id))
  const candidates = eligibleWords()
    .filter((w) => w.partOfSpeech === 'noun' && w.article && !seen.has(w.id))
    .filter((w) => {
      const g = state.progress.gender[w.id]
      return !g || !g.due || g.due <= now
    })
    .sort((a, b) => (a.frequency || 9999) - (b.frequency || 9999))

  const count = Math.min(candidates.length, Math.round(items.length * ratio))
  if (count <= 0) return items

  const drills = shuffle(candidates.slice(0, count * 2)).slice(0, count)
    .map((w) => ({ word: w, mode: 'gender', isNew: false, genderOnly: true }))

  const out = [...items]
  for (const d of drills) {
    out.splice(Math.floor(Math.random() * (out.length + 1)), 0, d)
  }
  return out
}

/**
 * The same trick for verbs. A conjugation card takes a couple of seconds and
 * keeps the stem changes and the haben/sein choice warm, which otherwise only
 * ever get tested indirectly.
 */
function injectVerbDrills(items) {
  const ratio = state.settings.verbDrillRatio ?? 0.15
  if (ratio <= 0 || state.settings.modes?.conjugation === false) return items

  const now = Date.now()
  const seen = new Set(items.map((i) => i.word.id))
  const candidates = eligibleWords()
    .filter((w) => w.partOfSpeech === 'verb' && w.forms?.du && !seen.has(w.id))
    .filter((w) => {
      const v = state.progress.verbs?.[w.id]
      return !v || !v.due || v.due <= now
    })
    .sort((a, b) => (a.frequency || 9999) - (b.frequency || 9999))

  const count = Math.min(candidates.length, Math.round(items.length * ratio))
  if (count <= 0) return items

  const drills = shuffle(candidates.slice(0, count * 2)).slice(0, count)
    .map((w) => ({ word: w, mode: 'conjugation', isNew: false, verbOnly: true }))

  const out = [...items]
  for (const d of drills) {
    out.splice(Math.floor(Math.random() * (out.length + 1)), 0, d)
  }
  return out
}

// ─── ANSWER HANDLING ──────────────────────────────────────────────────────────

/**
 * Commit a rating for one card and return what changed.
 * `item` is a queue entry, `rating` is 1-4.
 */
export function commit(item, rating, meta = {}) {
  const { word } = item
  const wasNew = !getCard(word.id).reps

  if (item.genderOnly) {
    // Quick drills use the lighter track and never touch FSRS state — a fast
    // article guess isn't evidence about whether you know the word's meaning.
    setGender(word.id, scheduleQuick(getGender(word.id), rating >= GOOD))
  } else if (item.verbOnly) {
    setVerb(word.id, scheduleQuick(getVerb(word.id), rating >= GOOD))
  } else if (item.practice) {
    // Free practice is the promise the Drills page makes: "this never changes
    // your review schedule". So no FSRS write and no new-card budget — an hour
    // of extra practice must not bury tomorrow in reviews or mark 30 unseen
    // words as "started". It still counts in today's stats and the review log.
  } else {
    const card = schedule(getCard(word.id), rating, {
      targetRetention: state.settings.targetRetention,
    })
    card.seenModes = [...new Set([...(card.seenModes || []), item.mode])]
    setCard(word.id, card)

    // A noun answered correctly in a full mode is also evidence about gender.
    if (word.partOfSpeech === 'noun' && word.article && rating >= GOOD) {
      const g = getGender(word.id)
      if (!g.lastReview) setGender(word.id, scheduleQuick(g, true))
    }
  }

  const isScheduled = !item.genderOnly && !item.verbOnly && !item.practice

  recordAnswer({
    mode: item.mode,
    correct: rating >= GOOD,
    isNew: wasNew && isScheduled,
    ms: meta.ms,
  })

  logReview({
    id: word.id,
    mode: item.mode,
    rating,
    correct: meta.correct ?? (rating >= GOOD),
    ms: meta.ms,
    answer: meta.answer,
    practice: item.practice || undefined,
  })

  return { wasNew }
}

/**
 * Where a failed card goes back into the queue.
 * Far enough away that you can't parrot it, close enough to still be in
 * the same session.
 */
export function requeue(queue, index, item) {
  const remaining = queue.length - index - 1
  const offset = Math.min(remaining, 4 + Math.floor(Math.random() * 4))
  queue.splice(index + 1 + offset, 0, { ...item, requeued: true })
}
