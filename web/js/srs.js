/**
 * FSRS-5 — Free Spaced Repetition Scheduler.
 *
 * Models memory as two variables per card:
 *   stability (S)  — days until recall probability decays to 90%
 *   difficulty (D) — 1..10, how hard this card is for *you*
 * and schedules the next review at the moment you're about to forget.
 *
 * This replaces fixed intervals: a word you find easy stretches to months fast,
 * a word you keep failing stays in your face. Same algorithm Anki ships today.
 *
 * Reference: github.com/open-spaced-repetition/fsrs4anki (FSRS-5, 19 weights)
 */

// Default FSRS-5 weights, trained on ~20k users' review histories.
// These get you ~95% of the benefit; retraining on personal data is a later luxury.
export const DEFAULT_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
  1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
  2.9898, 0.51655, 0.6621,
]

const DECAY = -0.5
const FACTOR = 19 / 81          // = 0.9^(1/DECAY) - 1
const MIN_S = 0.01
const MAX_S = 36500             // 100 years
const DAY = 86400000

export const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** A brand-new, never-seen card. */
export function newCard() {
  return {
    stability: 0,
    difficulty: 0,
    due: 0,               // ms timestamp; 0 = due now
    lastReview: 0,
    reps: 0,
    lapses: 0,
    state: 'new',         // new | learning | review | relearning
    streak: 0,            // consecutive non-Again answers
    seenModes: [],
  }
}

/**
 * Probability you'd recall the card right now.
 * elapsedDays since last review, against stability.
 */
export function retrievability(card, now = Date.now()) {
  // `lastReview == null` rather than `!lastReview` — 0 is a valid timestamp
  // (the epoch), and treating it as "never reviewed" silently returns R=1
  // for a card that should be fully decayed.
  if (!card.stability || card.lastReview == null) return 0
  const elapsed = Math.max(0, (now - card.lastReview) / DAY)
  return Math.pow(1 + FACTOR * elapsed / card.stability, DECAY)
}

/** Days until recall probability falls to `target`. */
function intervalFor(stability, target = 0.9) {
  const days = (stability / FACTOR) * (Math.pow(target, 1 / DECAY) - 1)
  return clamp(Math.round(days), 1, 36500)
}

const initialStability = (w, g) => clamp(w[g - 1], MIN_S, MAX_S)
const initialDifficulty = (w, g) => clamp(w[4] - Math.exp(w[5] * (g - 1)) + 1, 1, 10)

function nextDifficulty(w, d, g) {
  const delta = -w[6] * (g - 3)
  const damped = d + delta * (10 - d) / 9      // large D moves less than small D
  const reverted = w[7] * initialDifficulty(w, EASY) + (1 - w[7]) * damped
  return clamp(reverted, 1, 10)
}

function stabilityAfterRecall(w, d, s, r, g) {
  const hardPenalty = g === HARD ? w[15] : 1
  const easyBonus = g === EASY ? w[16] : 1
  const growth = Math.exp(w[8])
    * (11 - d)
    * Math.pow(s, -w[9])
    * (Math.exp(w[10] * (1 - r)) - 1)
    * hardPenalty
    * easyBonus
  return clamp(s * (1 + growth), MIN_S, MAX_S)
}

function stabilityAfterLapse(w, d, s, r) {
  const post = w[11]
    * Math.pow(d, -w[12])
    * (Math.pow(s + 1, w[13]) - 1)
    * Math.exp(w[14] * (1 - r))
  // FSRS-5: a lapse can never *increase* stability.
  return clamp(Math.min(post, s), MIN_S, MAX_S)
}

/** Reviews within the same day barely consolidate — this models that. */
function shortTermStability(w, s, g) {
  return clamp(s * Math.exp(w[17] * (g - 3 + w[18])), MIN_S, MAX_S)
}

/**
 * Apply a rating and return the updated card.
 * `rating` is 1 Again / 2 Hard / 3 Good / 4 Easy.
 */
export function schedule(card, rating, opts = {}) {
  const w = opts.weights || DEFAULT_W
  const now = opts.now ?? Date.now()          // ?? not || — `now: 0` is legitimate
  const target = opts.targetRetention || 0.9
  const c = { ...card }

  const isNew = !c.reps || c.state === 'new'
  const sameDay = !isNew && c.lastReview && (now - c.lastReview) < DAY

  if (isNew) {
    c.difficulty = initialDifficulty(w, rating)
    c.stability = initialStability(w, rating)
    c.state = rating === AGAIN ? 'learning' : 'review'
  } else {
    const r = retrievability(c, now)
    const d = c.difficulty || initialDifficulty(w, GOOD)
    const s = c.stability || initialStability(w, GOOD)

    c.difficulty = nextDifficulty(w, d, rating)

    if (sameDay) {
      c.stability = shortTermStability(w, s, rating)
    } else if (rating === AGAIN) {
      c.stability = stabilityAfterLapse(w, c.difficulty, s, r)
    } else {
      c.stability = stabilityAfterRecall(w, c.difficulty, s, r, rating)
    }

    if (rating === AGAIN) {
      c.lapses = (c.lapses || 0) + 1
      c.state = 'relearning'
    } else {
      c.state = 'review'
    }
  }

  c.reps = (c.reps || 0) + 1
  c.streak = rating === AGAIN ? 0 : (c.streak || 0) + 1
  c.lastReview = now

  if (rating === AGAIN) {
    // Show it again in this session, not tomorrow.
    c.due = now + 5 * 60 * 1000
    c.intervalDays = 0
  } else if (c.state === 'learning' || (isNew && rating === HARD)) {
    c.due = now + 10 * 60 * 1000
    c.intervalDays = 0
  } else {
    const days = intervalFor(c.stability, target)
    c.intervalDays = days
    c.due = now + days * DAY
  }

  return c
}

/** What the next interval *would* be for each button — shown on the rating row. */
export function previewIntervals(card, opts = {}) {
  const out = {}
  for (const g of [AGAIN, HARD, GOOD, EASY]) {
    const next = schedule(card, g, opts)
    out[g] = next.intervalDays > 0 ? next.intervalDays : 0
  }
  return out
}

export function formatInterval(days) {
  if (!days || days < 1) return '<10m'
  if (days === 1) return '1d'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${(days / 365).toFixed(1)}y`
}

export const isDue = (card, now = Date.now()) => !card.due || card.due <= now

/**
 * A "leech" is a card you keep failing — it needs a different approach
 * (a mnemonic, a sentence, breaking it apart), not more repetitions.
 */
export const isLeech = (card, threshold = 5) => (card.lapses || 0) >= threshold

// ─── MODE LADDER ──────────────────────────────────────────────────────────────
/**
 * Which exercise to use for a card *right now*.
 *
 * The idea: recognition is easy and production is hard, so the demand should
 * rise as the memory gets stronger. You are never asked to type a word you met
 * two minutes ago, and never allowed to coast on multiple-choice for a word
 * you've known for a month.
 *
 *   never seen        → mc         recognise it among 4 options
 *   S < 2 days        → flashcard  recall it, grade yourself
 *   S < 10 days       → typing     produce it from memory, spelled correctly
 *   S < 30 days       → listening  understand it with no text at all
 *   S >= 30 days      → cloze      use it inside a real sentence
 */
export const MODE_LADDER = [
  { mode: 'mc', maxStability: 0 },
  { mode: 'flashcard', maxStability: 2 },
  { mode: 'typing', maxStability: 10 },
  { mode: 'listening', maxStability: 30 },
  { mode: 'cloze', maxStability: Infinity },
]

export function pickMode(card, word, enabled = {}) {
  const on = (m) => enabled[m] !== false
  const s = card.stability || 0

  let chosen = 'flashcard'
  if (!card.reps) chosen = 'mc'
  else if (s < 2) chosen = 'flashcard'
  else if (s < 10) chosen = 'typing'
  else if (s < 30) chosen = 'listening'
  else chosen = 'cloze'

  // Fall back down the ladder if the mode is switched off or the data isn't there.
  const canDo = (m) => {
    if (!on(m)) return false
    if (m === 'cloze') return Array.isArray(word?.cloze) && word.cloze.length > 0 && word.cloze[0]?.de
    return true
  }

  if (canDo(chosen)) return chosen

  // Fall back along the ladder in difficulty order, starting from where this
  // card actually sits — EASIER first, then harder. The old list was ordered
  // typing-first, so switching off multiple choice threw brand-new words
  // straight into the hardest mode they had never seen.
  const LADDER = ['mc', 'flashcard', 'typing', 'listening', 'cloze']
  const at = Math.max(0, LADDER.indexOf(chosen))
  for (let step = 1; step < LADDER.length; step++) {
    const down = LADDER[at - step]
    if (down && canDo(down)) return down
    const up = LADDER[at + step]
    if (up && canDo(up)) return up
  }
  return 'flashcard'
}

/**
 * Quick tracks — gender for nouns, conjugation for verbs.
 *
 * Both are things you either know instantly or don't. They don't deserve full
 * FSRS machinery (there's no partial credit on der/die/das), but they do deserve
 * constant cheap drilling, because they're exactly where the marks and the
 * sounding-foreign go. So they get a simple expanding-interval schedule and
 * live alongside the main card state rather than replacing it.
 */
export function newQuickState() {
  return { correct: 0, wrong: 0, streak: 0, due: 0, lastReview: 0 }
}

export function scheduleQuick(state, correct, now = Date.now()) {
  const s = { ...(state || newQuickState()) }
  if (correct) {
    s.correct++
    s.streak++
    // 1 → 3 → 9 → 27 … days, capped at 6 months
    const days = Math.min(180, Math.pow(3, Math.max(0, s.streak - 1)))
    s.due = now + days * DAY
  } else {
    s.wrong++
    s.streak = 0
    s.due = now + 60 * 1000
  }
  s.lastReview = now
  return s
}

export const quickMastered = (s) => (s?.streak || 0) >= 4

// Original names kept — gender is the track most of the app talks about.
export const newGenderState = newQuickState
export const scheduleGender = scheduleQuick
export const genderMastered = quickMastered
