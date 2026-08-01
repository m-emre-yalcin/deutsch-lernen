/**
 * Multiple choice — the gentlest rung of the ladder.
 *
 * Used only for words you've never seen. Recognition among four options is
 * almost free cognitively, which is exactly what you want on first contact:
 * it plants the meaning without the frustration of failing to recall something
 * you were never taught.
 *
 * Distractors are drawn from the same category and part of speech, so the
 * choice is actually about meaning rather than "which one looks like a verb".
 */

import { esc, shuffle, sample } from '../lib/ui.js'
import { imageHtml } from '../lib/wordcard.js'
import { speakWord } from '../lib/tts.js'
import { state } from '../store.js'

export const meta = {
  id: 'mc',
  name: 'Multiple choice',
  icon: '📋',
  desc: 'Pick the right meaning from four. Used for brand-new words.',
}

/**
 * The core meaning of a gloss, with grammar labels and infinitive markers gone.
 *
 *   "the (masculine, nominative)"  → "the"
 *   "the (feminine or plural)"     → "the"
 *   "to go"                        → "go"
 *
 * Function words gloss almost identically, differing only in the parenthetical.
 * Offering four of those turns the question into "read the grammar label"
 * rather than "do you know this word", so options whose core matches the
 * answer's core are rejected as distractors.
 */
function coreGloss(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')       // drop "(masculine, nominative)"
    .replace(/[/,;].*$/, '')         // keep only the first sense
    .replace(/^\s*(to|the|a|an)\s+/, '')
    .trim()
}

function distractors(word, n = 3) {
  // Compare against ALL the word's accepted meanings, case-insensitively.
  // Filtering on the primary translation alone let a distractor equal one of
  // the word's other senses — the card then showed the right answer twice and
  // graded one of them wrong.
  const answers = new Set(
    [word.translation, ...(word.translations || [])]
      .filter(Boolean)
      .map((t) => t.toLowerCase().trim())
  )
  const pool = state.words.filter((w) =>
    w.id !== word.id &&
    w.translation &&
    !answers.has(w.translation.toLowerCase().trim()) &&
    !(w.translations || []).some((t) => answers.has(t.toLowerCase().trim()))
  )
  // Same category + same part of speech makes for a genuinely hard choice.
  const tight = pool.filter((w) => w.category === word.category && w.partOfSpeech === word.partOfSpeech)
  const loose = pool.filter((w) => w.partOfSpeech === word.partOfSpeech)

  const picked = []
  const seen = new Set([word.translation])
  const answerCore = coreGloss(word.translation)

  // Two passes: first insist the core meanings differ, then relax if the deck
  // genuinely cannot supply three (a very small category, say) — a weaker
  // question still beats a broken one with fewer than four options.
  for (const strict of [true, false]) {
    for (const source of [tight, loose, pool]) {
      for (const w of shuffle(source)) {
        if (picked.length >= n) break
        if (seen.has(w.translation)) continue
        const core = coreGloss(w.translation)
        if (strict && (core === answerCore || seen.has(core))) continue
        seen.add(w.translation)
        seen.add(core)
        picked.push(w)
      }
      if (picked.length >= n) break
    }
    if (picked.length >= n) break
  }
  return picked.slice(0, n)
}

export function render(el, ctx) {
  const { word } = ctx
  const options = shuffle([
    { text: word.translations?.[0] || word.translation, correct: true },
    ...distractors(word, 3).map((w) => ({ text: w.translation, correct: false })),
  ])

  el.innerHTML = `
    <div class="prompt">
      <div class="prompt-meta">
        <span class="level-badge level-${esc(word.level)}">${esc(word.level)}</span>
        <span class="prompt-cat">${esc(word.category)}</span>
        <span class="chip active chip-mini">new word</span>
      </div>
      ${imageHtml(word)}
      <div class="prompt-word de">${esc(word.word)}</div>
      <button class="btn ghost sm" id="mcPlay" style="margin-top:.5rem">🔊 Listen</button>
    </div>
    <div class="mc-options">
      ${options.map((o, i) => `
        <button class="mc-opt" data-i="${i}" data-correct="${o.correct}">
          <span class="mc-key">${i + 1}</span>
          <span>${esc(o.text)}</span>
        </button>`).join('')}
    </div>
    <div class="hint-line">Press <kbd>1</kbd>–<kbd>4</kbd> or click</div>
  `

  el.querySelector('#mcPlay').addEventListener('click', (e) => { e.stopPropagation(); speakWord(word) })
  if (state.settings.autoPlayAudio) speakWord(word)

  let answered = false
  const buttons = [...el.querySelectorAll('.mc-opt')]

  const choose = (i) => {
    if (answered || !buttons[i]) return
    answered = true
    const chosen = buttons[i]
    const correct = chosen.dataset.correct === 'true'

    buttons.forEach((b) => {
      b.disabled = true
      if (b.dataset.correct === 'true') b.classList.add('correct')
    })
    if (!correct) chosen.classList.add('wrong')

    // A beat to actually see which one was right before the answer panel lands.
    // The answer recorded is the option text alone — textContent of the button
    // would include the "1"/"2" key badge and its whitespace.
    setTimeout(() => ctx.onAnswer({
      correct,
      answer: options[i].text,
      expected: word.translation,
    }), correct ? 260 : 750)
  }

  buttons.forEach((b, i) => b.addEventListener('click', () => choose(i)))

  ctx.setKeyHandler((e) => {
    const n = Number(e.key)
    if (n >= 1 && n <= options.length) { choose(n - 1); return true }
    return false
  })

  // Space shouldn't skip past an unanswered question.
  ctx.setSubmit(() => { if (!answered) return false })
}
