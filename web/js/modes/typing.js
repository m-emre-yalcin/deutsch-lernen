/**
 * Typing recall — produce the German from the meaning.
 *
 * This is the mode that actually makes you able to *speak*. Recognition is
 * cheap; retrieving a word cold and spelling it correctly is the real thing.
 *
 * Grading is deliberately fair-but-strict:
 *   - `ue` counts as `ü`, `ss` as `ß` (a US keyboard shouldn't cost you marks)
 *   - a one-character typo is "almost", not "wrong"
 *   - the article is graded *separately*, because "der Haus" is a gender
 *     mistake, not a vocabulary mistake, and should read that way
 */

import { esc } from '../lib/ui.js'
import { bindTextSubmit } from '../lib/keys.js'
import { checkGerman, normalize, stripArticle, diffChars } from '../lib/normalize.js'
import { imageHtml } from '../lib/wordcard.js'
import { state } from '../store.js'

/**
 * Other German words in the deck that mean exactly the same thing.
 *
 * "floor" is die Etage, das Stockwerk AND der Stock. Prompting with the English
 * and accepting only one of them marks a correct German word wrong, which is
 * both unfair and actively confusing. Typing one of the alternatives counts —
 * the card still shows which word it was asking about.
 */
function sameMeaningWords(word) {
  const senses = new Set(
    [word.translation, ...(word.translations || [])]
      .filter(Boolean).map((t) => normalize(t))
  )
  return state.words.filter((w) =>
    w.id !== word.id &&
    w.partOfSpeech === word.partOfSpeech &&
    [w.translation, ...(w.translations || [])].filter(Boolean)
      .some((t) => senses.has(normalize(t)))
  )
}

export const meta = {
  id: 'typing',
  name: 'Typing recall',
  icon: 'keyboard',
  desc: 'Type the German from memory. The strongest mode for producing the language.',
}

const UMLAUTS = ['ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü']

export function render(el, ctx) {
  const { word } = ctx
  const isNoun = word.partOfSpeech === 'noun'

  el.innerHTML = `
    <div class="prompt">
      <div class="prompt-meta">
        <span class="level-badge level-${esc(word.level)}">${esc(word.level)}</span>
        <span class="prompt-cat">${esc(word.category)}</span>
        <span class="pos-tag">${esc(word.partOfSpeech)}</span>
      </div>
      ${imageHtml(word)}
      <div class="prompt-word en">${esc(word.translations?.[0] || word.translation)}</div>
    </div>

    <div style="width:100%;max-width:440px;margin:0 auto">
      <input class="type-input" id="typeIn" autocomplete="off" autocorrect="off"
             autocapitalize="off" spellcheck="false"
             placeholder="${isNoun ? 'der / die / das …' : '…'}" />
      <div class="umlaut-bar">
        ${UMLAUTS.map((u) => `<button class="umlaut-key" data-u="${u}">${u}</button>`).join('')}
      </div>
    </div>
  `

  // The instruction moved out of .prompt-sub and into the task line, which
  // lives outside the scroll area and — unlike .hint-line — is not hidden on
  // touch. On a phone this mode used to be a bare box with a placeholder.
  ctx.setTask(isNoun
    ? 'Type this in German, <b>with</b> its der/die/das.'
    : 'Type this in German. You can type <b>ue</b> for <b>ü</b>.')

  const input = el.querySelector('#typeIn')
  setTimeout(() => input.focus(), 30)

  // Umlaut buttons insert at the caret rather than appending — otherwise fixing
  // a missing umlaut mid-word means retyping the whole thing.
  el.querySelectorAll('.umlaut-key').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.preventDefault()
      const s = input.selectionStart ?? input.value.length
      const t = input.selectionEnd ?? s
      input.value = input.value.slice(0, s) + b.dataset.u + input.value.slice(t)
      input.selectionStart = input.selectionEnd = s + 1
      input.focus()
    })
  })

  let submitted = false

  const submit = () => {
    if (submitted) return
    const given = input.value.trim()
    if (!given) { input.focus(); return false }
    submitted = true

    let result = checkGerman(given, word.word, { strict: state.settings.typingStrict })

    // Not the card's word, but a genuine synonym? Count it.
    let synonymOf = null
    if (!result.correct) {
      const alt = sameMeaningWords(word).find((w) =>
        checkGerman(given, w.word, { strict: state.settings.typingStrict }).correct)
      if (alt) {
        synonymOf = alt
        result = { ...result, correct: true, close: false, message: null }
      }
    }

    input.disabled = true
    input.classList.add(result.correct ? 'correct' : result.close ? 'close' : 'wrong')

    // Which letters went wrong — the one thing this mode knows that the shared
    // answer panel cannot work out for itself. Everything else about the
    // verdict is now drawn once, by study.js, in the same shape for every mode.
    const diff = result.correct ? [] : diffChars(stripArticle(given), stripArticle(word.word))

    ctx.showResult({
      correct: result.correct,
      close: result.close,
      answer: given,
      expected: word.word,
      message: synonymOf
        ? `Also correct — this card was asking for "${word.word}".`
        : result.message,
      detail: diff.length
        ? `<div class="answer-label">Letter by letter</div>
           <div class="char-diff">${diff
             .map((c) => `<span class="${c.ok ? 'ok' : 'bad'}">${esc(c.ch)}</span>`).join('')}</div>`
        : null,
      // A near-miss shouldn't reset a word you basically know — it lands on Hard.
      suggestedRating: result.correct ? 3 : result.close ? 2 : 1,
    })
  }

  bindTextSubmit(input, submit)
  ctx.setPrimary({ label: 'Check', run: submit })
  ctx.setFocusTarget(input)
}
