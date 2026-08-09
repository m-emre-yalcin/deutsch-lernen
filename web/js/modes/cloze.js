/**
 * Cloze — fill the gap in a real sentence.
 *
 * The top of the ladder. Knowing "Haus = house" is not the same as producing
 * "Ich wohne in einem Haus" — this mode forces the word out in context, with
 * whatever inflection the sentence demands, which is what actually happens when
 * you speak.
 *
 * The English translation sits underneath as a clue, so this stays a retrieval
 * exercise rather than a comprehension puzzle.
 */

import { esc } from '../lib/ui.js'
import { bindTextSubmit } from '../lib/keys.js'
import { checkGerman, splitCloze } from '../lib/normalize.js'
import { speak } from '../lib/tts.js'
import { state } from '../store.js'

export const meta = {
  id: 'cloze',
  name: 'Sentence gap',
  icon: 'blank',
  desc: 'Fill the missing word in a real sentence. Meaning in context.',
}

export function render(el, ctx) {
  const { word } = ctx
  const item = word.cloze?.[0]

  // The session shouldn't route here without cloze data, but a hand-added word
  // might lack it. This used to call back synchronously mid-render and skip the
  // card outright — it flashed past and the review was lost. Now the card falls
  // back to a mode that needs no data.
  if (!item?.de || !item?.answer) {
    ctx.unavailable('no cloze sentence for this word')
    return
  }

  const { before, after } = splitCloze(item.de)

  el.innerHTML = `
    <div class="prompt">
      <div class="prompt-meta">
        <span class="level-badge level-${esc(word.level)}">${esc(word.level)}</span>
        <span class="prompt-cat">${esc(word.category)}</span>
      </div>
      <div class="cloze-sentence de">
        <span>${esc(before)}</span><input class="cloze-input" id="clozeIn" autocomplete="off"
          autocorrect="off" autocapitalize="off" spellcheck="false" /><span>${esc(after)}</span>
      </div>
      <div class="cloze-en">${esc(item.en)}</div>
      <div class="cloze-clue">
        the word means <b>${esc(word.translation)}</b>
        ${word.partOfSpeech === 'noun' ? '· watch the ending' : ''}
      </div>
    </div>
  `

  // This mode shipped with no instruction of any kind — no hint line, no
  // button, nothing saying which language, and nothing saying that what is
  // graded is the INFLECTED form the sentence needs rather than the headword.
  // "Haus" in a gap that wants "Häuser" was marked wrong with no explanation.
  ctx.setTask(`Type the missing German word in the form this sentence needs${
    word.partOfSpeech === 'noun' ? ' — watch the ending' : ''}.`)

  const input = el.querySelector('#clozeIn')
  setTimeout(() => input.focus(), 30)

  // Grow the input to fit what's being typed, so the sentence stays readable.
  const resize = () => {
    input.style.width = Math.max(130, input.value.length * 15 + 40) + 'px'
  }
  input.addEventListener('input', resize)

  let submitted = false

  const submit = () => {
    if (submitted) return
    const given = input.value.trim()
    if (!given) { input.focus(); return false }
    submitted = true

    // Compare against the inflected answer the sentence needs, not the lemma —
    // "Häuser" is right here even though the headword is "das Haus".
    const result = checkGerman(given, item.answer, { strict: state.settings.typingStrict })
    input.disabled = true
    input.classList.add(result.correct ? 'correct' : 'wrong')
    resize()

    // What you typed stays in the box. It used to be overwritten with the right
    // answer the instant you submitted — so the sentence quietly corrected
    // itself in front of you and you never saw what you had actually written.

    // Hearing the completed sentence is the reward and the reinforcement.
    speak(item.de.replace('___', item.answer))

    ctx.showResult({
      correct: result.correct,
      close: result.close,
      answer: given,
      expected: item.answer,
      message: result.message,
      // The completed sentence — the thing this mode is actually teaching.
      detail: `<div class="answer-label">The full sentence</div>
        <div class="example-de">${esc(item.de.replace('___', item.answer))}</div>
        <div class="example-en">${esc(item.en)}</div>`,
      suggestedRating: result.correct ? 3 : result.close ? 2 : 1,
    })
  }

  bindTextSubmit(input, submit)
  ctx.setPrimary({ label: 'Check', run: submit })
  ctx.setFocusTarget(input)
}
