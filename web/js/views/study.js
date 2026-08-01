/**
 * The study surface.
 *
 * Owns the loop: pick the next item → hand it to a mode → collect the answer →
 * show the full word → take a rating → schedule → repeat. Modes stay dumb about
 * scheduling; this file stays dumb about how any individual exercise works.
 */

import { esc, plural, fmtDuration } from '../lib/ui.js'
import { renderAnswer, bindAnswerAudio } from '../lib/wordcard.js'
import { previewIntervals, formatInterval, AGAIN, HARD, GOOD, EASY } from '../srs.js'
import { buildQueue, commit, requeue, dueCounts } from '../session.js'
import { state, saveNow } from '../store.js'
import { stopSpeaking } from '../lib/tts.js'

import * as flashcard from '../modes/flashcard.js'
import * as mc from '../modes/mc.js'
import * as typing from '../modes/typing.js'
import * as gender from '../modes/gender.js'
import * as listening from '../modes/listening.js'
import * as cloze from '../modes/cloze.js'
import * as conjugation from '../modes/conjugation.js'

export const MODE_IMPL = { flashcard, mc, typing, gender, listening, cloze, conjugation }

let queue = []
let index = 0
let phase = 'question'        // question | answer | done
let current = null
let lastAnswer = null
let cardStart = 0
let sessionStart = 0
let counters = { answered: 0, correct: 0, newSeen: 0 }
let opts = {}

// Handlers the active mode installs, reset for every card.
let submitFn = null
let keyFn = null
let focusTarget = null

const root = () => document.getElementById('view-study')

/**
 * `options` present  → an explicit request (a drill), always start fresh.
 * `options` absent   → plain navigation. Resume an in-progress session, or
 *                      start a NORMAL daily session.
 *
 * The reset matters: without it, the drill options stuck around forever, so
 * after one free-practice run the Study tab silently replayed that drill
 * instead of your scheduled reviews — and since practice never touches the
 * schedule, "due" would climb while the app looked like it was working.
 */
export function open(options) {
  if (options) {
    opts = options
    start()
    return
  }
  const inProgress = phase !== 'done' && queue.length && index < queue.length
  if (inProgress) { render(); return }
  opts = {}          // plain navigation always means the scheduled session
  start()
}

export function start() {
  queue = buildQueue(opts)
  index = 0
  counters = { answered: 0, correct: 0, newSeen: 0 }
  sessionStart = Date.now()
  phase = 'question'
  render()
}

export function refresh() {
  if (phase === 'done' || !queue.length) start()
  else render()
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function render() {
  const el = root()
  if (!queue.length) return renderEmpty(el)
  if (index >= queue.length) return renderDone(el)

  current = queue[index]
  const impl = MODE_IMPL[current.mode] || MODE_IMPL.flashcard

  el.innerHTML = `
    <div class="session">
      <div class="session-top">
        <div class="session-counts">
          <span class="count-pill count-due">${queue.length - index}</span>
          <span class="session-mode-tag">${esc(impl.meta.name)}</span>
        </div>
        <div class="bar-track" style="flex:1">
          <div class="bar-fill" style="width:${(index / queue.length) * 100}%"></div>
        </div>
        <button class="btn ghost sm" id="endBtn" title="End session (Esc)">End</button>
      </div>
      <div class="card-stage" id="stage"></div>
      <div id="controls"></div>
    </div>
  `

  el.querySelector('#endBtn').addEventListener('click', finish)

  submitFn = null
  keyFn = null
  focusTarget = null
  phase = 'question'
  lastAnswer = null
  cardStart = Date.now()

  impl.render(el.querySelector('#stage'), {
    word: current.word,
    card: state.progress.cards[current.word.id],
    direction: state.settings.direction,
    onAnswer: handleAnswer,
    setSubmit: (fn) => { submitFn = fn },
    setKeyHandler: (fn) => { keyFn = fn },
    setFocusTarget: (t) => { focusTarget = t },
  })
}

/** A mode has collected the user's response. Show the truth and ask for a rating. */
function handleAnswer(result) {
  if (phase !== 'question') return
  phase = 'answer'
  lastAnswer = result

  if (result.skipped) { next(); return }

  const el = root()
  const controls = el.querySelector('#controls')
  const stage = el.querySelector('#stage')

  // Quick drills stay fast — correct/incorrect is the whole story, no answer
  // panel, no rating row. Slowing them down would defeat the point. The
  // conjugation mode has already shown its own table by this point.
  if (current.genderOnly || current.verbOnly) {
    commitAndAdvance(result.correct ? GOOD : AGAIN, result)
    return
  }

  const mistake = result.correct === false && result.answer
    ? { given: result.answer, expected: result.expected || current.word.word }
    : null

  stage.insertAdjacentHTML('beforeend', renderAnswer(current.word, { mistake }))
  bindAnswerAudio(stage)
  stage.scrollTop = stage.scrollHeight

  const card = state.progress.cards[current.word.id] || {}
  const iv = previewIntervals(card, { targetRetention: state.settings.targetRetention })
  const suggested = result.suggestedRating

  controls.innerHTML = `
    <div class="rating-row">
      ${[
        [AGAIN, 'rate-again', 'Again', '1'],
        [HARD, 'rate-hard', 'Hard', '2'],
        [GOOD, 'rate-good', 'Good', '3'],
        [EASY, 'rate-easy', 'Easy', '4'],
      ].map(([r, cls, label, key]) => `
        <button class="rate-btn ${cls}" data-r="${r}"
          style="${suggested === r ? 'border-width:2px' : ''}">
          <span class="rate-label">${label}</span>
          <span class="rate-when">${formatInterval(iv[r])}</span>
          <span class="rate-key">${key}</span>
        </button>`).join('')}
    </div>
    <div class="hint-line" style="text-align:center">
      ${suggested ? `<kbd>Space</kbd> accepts <b>${['', 'Again', 'Hard', 'Good', 'Easy'][suggested]}</b>` : `<kbd>1</kbd>–<kbd>4</kbd> to rate`}
    </div>
  `

  controls.querySelectorAll('.rate-btn').forEach((b) => {
    b.addEventListener('click', () => commitAndAdvance(Number(b.dataset.r), result))
  })
}

function commitAndAdvance(rating, result = {}) {
  stopSpeaking()
  const ms = Date.now() - cardStart
  commit(current, rating, { ...result, ms })

  counters.answered++
  if (rating >= GOOD) counters.correct++
  if (current.isNew) counters.newSeen++

  // Failed cards come back before the session ends — that's what makes a
  // session actually teach rather than just measure.
  if (rating === AGAIN && !current.requeued) requeue(queue, index, current)

  next()
}

function next() {
  index++
  if (index >= queue.length) { finish(); return }
  render()
}

async function finish() {
  stopSpeaking()
  phase = 'done'
  // A finished drill must not leave its options armed — "Keep going" and the
  // next visit to Study mean the scheduled session, not the drill again.
  if (opts.ignoreSchedule) opts = {}
  await saveNow()
  renderDone(root())
}

// ─── END STATES ───────────────────────────────────────────────────────────────

function renderDone(el) {
  const elapsed = Date.now() - sessionStart
  const accuracy = counters.answered ? Math.round((counters.correct / counters.answered) * 100) : 0
  const counts = dueCounts()

  el.innerHTML = `
    <div class="done">
      <div class="done-icon">${accuracy >= 85 ? '🎉' : accuracy >= 60 ? '👏' : '💪'}</div>
      <h2>Session complete</h2>
      <div class="done-stats">
        <div class="done-stat">
          <span class="done-stat-num">${counters.answered}</span>
          <span class="done-stat-label">answered</span>
        </div>
        <div class="done-stat">
          <span class="done-stat-num">${accuracy}%</span>
          <span class="done-stat-label">correct</span>
        </div>
        <div class="done-stat">
          <span class="done-stat-num">${counters.newSeen}</span>
          <span class="done-stat-label">new words</span>
        </div>
        <div class="done-stat">
          <span class="done-stat-num">${fmtDuration(elapsed)}</span>
          <span class="done-stat-label">time</span>
        </div>
      </div>
      <p style="color:var(--text3);max-width:400px">
        ${counts.due + counts.learning > 0
          ? `${plural(counts.due + counts.learning, 'card')} still due today.`
          : counts.newLeft > 0 && counts.newAvailable > 0
            ? `All caught up. You can still learn ${counts.newLeft} new word${counts.newLeft === 1 ? '' : 's'} today.`
            : `Everything due is done. Come back tomorrow — that's how the spacing works.`}
      </p>
      <div class="done-actions">
        ${counts.due + counts.learning + counts.new > 0
          ? `<button class="btn primary big" id="againBtn">Keep going</button>` : ''}
        <button class="btn big" data-nav="stats">See progress</button>
        <button class="btn big" data-nav="drills">Free practice</button>
      </div>
    </div>
  `
  el.querySelector('#againBtn')?.addEventListener('click', start)
}

function renderEmpty(el) {
  const counts = dueCounts()

  // Three genuinely different situations, three honest messages. The old code
  // collapsed them and told someone whose filters excluded everything that
  // they had "studied every word in the deck".
  let icon, title, body
  if (counts.total === 0) {
    icon = '🔍'
    title = 'Your filters exclude every word'
    body = `The level and category filters in Settings currently match nothing.
            Switch a level back on to keep studying.`
  } else if (counts.newAvailable === 0 && counts.due + counts.learning === 0) {
    icon = '🏆'
    title = 'You have studied every word in the deck'
    body = `Nothing is due and there are no unseen words left. Add your own in
            Browse, or keep everything warm with free practice.`
  } else {
    icon = '☕'
    title = 'Nothing due right now'
    body = state.settings.newPerDay === 0
      ? `New words are paused (daily limit is 0), and today's reviews are done.
         Free practice doesn't touch your schedule.`
      : `You've hit today's limit of ${state.settings.newPerDay} new words. That cap exists
         on purpose — tomorrow's reviews are what make today's words stick.
         Free practice doesn't touch your schedule.`
  }

  el.innerHTML = `
    <div class="empty" style="height:100%">
      <div class="empty-icon">${icon}</div>
      <h3>${title}</h3>
      <p>${body}</p>
      <div class="done-actions" style="margin-top:.6rem">
        ${counts.total === 0
          ? `<button class="btn primary" data-nav="settings">Open Settings</button>`
          : `<button class="btn primary" data-nav="drills">Free practice</button>
             <button class="btn" data-nav="settings">Change daily limit</button>`}
      </div>
    </div>
  `
}

// ─── KEYBOARD ─────────────────────────────────────────────────────────────────

export function handleKey(e) {
  if (phase === 'done') {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); start(); return true }
    return false
  }

  // Give the active mode first refusal — it owns 1-4 during the question phase.
  if (phase === 'question' && keyFn?.(e)) { e.preventDefault(); return true }

  if (e.key === 'Escape') { e.preventDefault(); finish(); return true }

  if (phase === 'question') {
    if (e.key === ' ' && document.activeElement !== focusTarget) {
      e.preventDefault()
      submitFn?.()
      return true
    }
    return false
  }

  // answer phase — rating
  if (e.key >= '1' && e.key <= '4') {
    e.preventDefault()
    commitAndAdvance(Number(e.key), lastAnswer || {})
    return true
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    commitAndAdvance(lastAnswer?.suggestedRating || GOOD, lastAnswer || {})
    return true
  }
  return false
}

export const activeWord = () => (phase !== 'done' ? current?.word : null)
