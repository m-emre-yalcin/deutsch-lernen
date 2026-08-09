/**
 * The study surface.
 *
 * Owns the loop: pick the next item → hand it to a mode → collect the answer →
 * show the truth → take a rating → schedule → repeat. Modes stay dumb about
 * scheduling; this file stays dumb about how any individual exercise works.
 *
 * The division of labour used to be drawn one step further along, and that one
 * step was the source of most of what was wrong here. Each mode graded the
 * answer, drew its own verdict, waited on its own hand-tuned timer — 260ms,
 * 950ms, 2200ms, all different — and only then handed the turn back. Two modes
 * skipped the answer panel altogether and advanced with no input at all.
 *
 * So the line moved. A mode's job now ends the instant it has graded the input.
 * It calls ctx.showResult() and stops. Everything after that — the verdict, the
 * answer, the rating, the keyboard, the advance — happens exactly once, here.
 * No mode sets a timer. No card moves on until you say so.
 */

import { esc, plural, fmtDuration } from '../lib/ui.js'
import { icon } from '../lib/icons.js'
import { renderAnswer, renderBrief, renderVerdict, bindAnswerAudio } from '../lib/wordcard.js'
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

/**
 * How long after the screen changes a rating keystroke is ignored.
 *
 * A key pressed before the eye can register that the screen means something new
 * is the previous screen's keystroke arriving late. In multiple choice, "3"
 * picked an option and then — 260ms later — rated the card and advanced past
 * the answer. Two meanings for one key, a quarter of a second apart.
 */
const PHASE_GUARD_MS = 350

let queue = []
let index = 0
let phase = 'question'        // question | answer | done
let phaseAt = 0
let current = null
let lastAnswer = null
let cardStart = 0
let sessionStart = 0
let counters = { answered: 0, correct: 0, newSeen: 0 }
let opts = {}
let advanceTimer = null

// Handlers the active mode installs, reset for every card.
let keyFn = null
let focusTarget = null
let primary = null            // { label, run } — the visible button AND the key
let suggested = GOOD
let quickRating = false       // true = the two-button drill row

const root = () => document.getElementById('view-study')

const setPhase = (p) => { phase = p; phaseAt = performance.now() }
const settled = () => performance.now() - phaseAt >= PHASE_GUARD_MS

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
  setPhase('question')
  render()
}

export function refresh() {
  if (phase === 'done' || !queue.length) start()
  else render()
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function render() {
  clearTimeout(advanceTimer)
  const el = root()
  if (!queue.length) return renderEmpty(el)
  if (index >= queue.length) return renderDone(el)

  current = queue[index]
  const impl = MODE_IMPL[current.mode] || MODE_IMPL.flashcard

  // #task and #controls live OUTSIDE #stage. #stage is the only thing that
  // scrolls, and the instruction and the buttons are the two things you must
  // always be able to see — so they must not be scrollable away.
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
      <div class="task-line" id="task"></div>
      <div class="card-stage" id="stage" tabindex="-1"></div>
      <div id="controls"></div>
    </div>
  `

  el.querySelector('#endBtn').addEventListener('click', finish)

  keyFn = null
  focusTarget = null
  primary = null
  quickRating = false
  lastAnswer = null
  cardStart = Date.now()
  setPhase('question')

  const stage = el.querySelector('#stage')
  const task = el.querySelector('#task')

  impl.render(stage, {
    word: current.word,
    card: state.progress.cards[current.word.id],
    direction: state.settings.direction,
    drill: isDrill(),
    showResult: handleResult,
    unavailable: fallBack,
    setTask: (html) => { task.innerHTML = html },
    setPrimary: (p) => { primary = p },
    setKeyHandler: (fn) => { keyFn = fn },
    setFocusTarget: (t) => { focusTarget = t },
  })

  renderQuestionControls(el.querySelector('#controls'))
}

/** Gender and conjugation cards, whether injected into a session or drilled. */
const isDrill = () => Boolean(current?.genderOnly || current?.verbOnly)

function renderQuestionControls(controls) {
  // Modes that answer with their own grid of large buttons (multiple choice,
  // der/die/das) already satisfy "there is something visible to press", so
  // they set no primary and get no extra button. Note the guard: templating
  // an absent primary would print `undefined` into the label.
  controls.innerHTML = `
    ${primary ? `
      <div class="card-actions">
        <button class="btn primary big" id="primaryBtn">${esc(primary.label)}</button>
      </div>` : ''}
    ${primary
      ? `<div class="hint-line"><kbd>Enter</kbd> to ${esc(primary.label.toLowerCase())}</div>`
      : ''}
  `
  controls.querySelector('#primaryBtn')?.addEventListener('click', () => primary?.run())
}

// ─── ANSWER ───────────────────────────────────────────────────────────────────

/** A mode has graded the response. Everything from here is ours. */
function handleResult(result) {
  if (phase !== 'question') return
  setPhase('answer')
  lastAnswer = result
  keyFn = null

  const el = root()
  const stage = el.querySelector('#stage')
  const drill = isDrill()

  const mistake = result.correct === false && result.answer
    ? { given: result.answer, expected: result.expected || current.word.word }
    : null

  stage.insertAdjacentHTML('beforeend',
    renderVerdict(result) +
    (drill
      ? renderBrief(current.word, { mistake, detail: result.detail })
      : renderAnswer(current.word, { mistake, detail: result.detail })))
  bindAnswerAudio(stage)

  // Bring the TOP of what just appeared into view. This used to be
  // `stage.scrollTop = stage.scrollHeight` — a jump to the very bottom of the
  // panel, so on a verb (conjugation table, two examples, notes, mnemonic,
  // context, synonyms, twelve lookup links) you landed on the link chips and
  // the word itself was somewhere above you.
  const panel = stage.querySelector('.verdict, .answer')
  if (panel) {
    stage.scrollTop += panel.getBoundingClientRect().top - stage.getBoundingClientRect().top - 8
  }
  stage.focus({ preventScroll: true })

  suggested = result.suggestedRating || GOOD
  quickRating = drill
  renderRating(el.querySelector('#controls'), result)

  if (state.settings.autoAdvance) {
    advanceTimer = setTimeout(() => advance(suggested, result),
      state.settings.autoAdvanceMs ?? 1200)
  }
}

function renderRating(controls, result) {
  // Drill cards are graded objectively — a der/die/das button is right or it
  // isn't. Hard and Easy have nowhere to go: scheduleQuick() only ever asks
  // "was this at least Good?". Four buttons would be theatre, and the interval
  // preview on them would be a schedule that never gets honoured, so it isn't
  // computed at all for drills.
  const rows = quickRating
    ? [[AGAIN, 'rate-again', 'Missed it', '1'], [GOOD, 'rate-good', 'Got it', '3']]
    : [[AGAIN, 'rate-again', 'Again', '1'], [HARD, 'rate-hard', 'Hard', '2'],
       [GOOD, 'rate-good', 'Good', '3'], [EASY, 'rate-easy', 'Easy', '4']]

  const iv = quickRating
    ? null
    : previewIntervals(state.progress.cards[current.word.id] || {},
        { targetRetention: state.settings.targetRetention })

  controls.innerHTML = `
    <div class="rating-row${quickRating ? ' rating-quick' : ''}">
      ${rows.map(([r, cls, label, key]) => `
        <button class="rate-btn ${cls}${suggested === r ? ' suggested' : ''}" data-r="${r}">
          <span class="rate-label">${label}</span>
          ${iv ? `<span class="rate-when">${formatInterval(iv[r])}</span>` : ''}
          <span class="rate-key">${key}</span>
        </button>`).join('')}
    </div>
    <div class="hint-line">
      <kbd>Space</kbd> takes <b>${esc(rows.find(([r]) => r === suggested)?.[2] || 'Good')}</b>
    </div>
  `

  controls.querySelectorAll('.rate-btn').forEach((b) => {
    // Clicks are exempt from the phase guard on purpose: a tap lands on a
    // button that did not exist a moment ago, so it cannot be a stale press.
    b.addEventListener('click', () => advance(Number(b.dataset.r), result))
  })
}

/**
 * The mode cannot run on this word — a hand-added word with no cloze sentence,
 * a verb with no conjugation table.
 *
 * This used to call next() synchronously from inside impl.render(), i.e.
 * re-entering render() during render(). The card flashed and vanished, the
 * review was silently lost, and several in a row looked exactly like the app
 * skipping ahead by itself. Fall back to the mode that needs no data instead.
 */
function fallBack(reason) {
  const at = index
  queueMicrotask(() => {
    if (index !== at) return
    console.warn(`${current.mode} unusable for "${current.word.id}": ${reason}`)
    if (current.fellBack) { advance(AGAIN, { correct: null }); return }
    queue[at] = { ...current, mode: 'flashcard', fellBack: true }
    render()
  })
}

function advance(rating, result = {}) {
  clearTimeout(advanceTimer)
  stopSpeaking()
  const ms = Date.now() - cardStart
  commit(current, rating, { ...result, ms })

  counters.answered++
  if (rating >= GOOD) counters.correct++
  if (current.isNew) counters.newSeen++

  // Failed cards come back before the session ends — that's what makes a
  // session actually teach rather than just measure.
  if (rating === AGAIN && !current.requeued) requeue(queue, index, current)

  index++
  if (index >= queue.length) { finish(); return }
  render()
}

async function finish() {
  clearTimeout(advanceTimer)
  stopSpeaking()
  setPhase('done')
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
  let name, title, body
  if (counts.total === 0) {
    name = 'browse'
    title = 'Your filters exclude every word'
    body = `The level and category filters in Settings currently match nothing.
            Switch a level back on to keep studying.`
  } else if (counts.newAvailable === 0 && counts.due + counts.learning === 0) {
    name = 'award'
    title = 'You have studied every word in the deck'
    body = `Nothing is due and there are no unseen words left. Add your own in
            Browse, or keep everything warm with free practice.`
  } else {
    name = 'coffee'
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
      <div class="empty-icon">${icon(name)}</div>
      <h3>${title}</h3>
      <p>${body}</p>
      <div class="done-actions" style="margin-top:var(--s2)">
        ${counts.total === 0
          ? `<button class="btn primary" data-nav="settings">Open Settings</button>`
          : `<button class="btn primary" data-nav="drills">Free practice</button>
             <button class="btn" data-nav="settings">Change daily limit</button>`}
      </div>
    </div>
  `
}

// ─── KEYBOARD ─────────────────────────────────────────────────────────────────

/**
 * One contract, both phases:
 *
 *   Enter   submits          — and is INERT once there is nothing left to submit
 *   Space   continues        — runs the primary button, then takes the rating
 *   1-4     rate             — only in the answer phase, never while asking
 *   Esc     ends the session — never guarded, you can always get out
 *
 * Enter used to do both jobs. Every typed mode submitted on Enter and then
 * disabled its input, which dropped focus to <body> — so the auto-repeats of a
 * held Enter reached this handler, which read Enter as "accept and advance".
 * Hold the key half a second and you never saw what you got wrong.
 */
export function handleKey(e) {
  // An auto-repeat is the operating system talking, never the user. Swallowed
  // outright so no held key can ever ride across a phase boundary.
  if (e.repeat) { e.preventDefault(); return true }

  if (phase === 'done') {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); start(); return true }
    return false
  }

  if (e.key === 'Escape') { e.preventDefault(); finish(); return true }

  if (phase === 'question') {
    // The mode owns 1-4 (multiple choice, der/die/das) and Space (listening
    // replays the audio) while it is still asking.
    if (keyFn?.(e)) { e.preventDefault(); return true }
    if (!primary) return false
    const inInput = document.activeElement === focusTarget
    if (e.key === 'Enter' || (e.key === ' ' && !inInput)) {
      e.preventDefault()
      if (settled()) primary.run()
      return true
    }
    return false
  }

  // ── answer phase ──
  // Enter is deliberately dead here. This is the exact key that used to skip
  // the feedback you had just earned.
  if (e.key === 'Enter') { e.preventDefault(); return true }

  if (e.key === ' ') {
    e.preventDefault()
    if (settled()) advance(suggested, lastAnswer || {})
    return true
  }

  if (e.key >= '1' && e.key <= '4') {
    e.preventDefault()
    if (!settled()) return true
    const r = Number(e.key)
    // The quick row only has two buttons; 2 and 4 are not on screen.
    if (quickRating && r !== AGAIN && r !== GOOD) return true
    advance(r, lastAnswer || {})
    return true
  }
  return false
}

export const activeWord = () => (phase !== 'done' ? current?.word : null)
