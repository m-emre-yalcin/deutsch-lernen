/**
 * Conjugation drill — produce the right verb form.
 *
 * Knowing that "fahren" means "to drive" is not the same as being able to say
 * "du fährst" without stopping to think. German verbs change their stem in the
 * du/er forms (fahren→fährst, nehmen→nimmt, lesen→liest), split their prefix
 * off (aufstehen → "stehe … auf"), and pick haben or sein for the Perfekt on a
 * rule English gives you no intuition for.
 *
 * So verbs get their own fast track, the way nouns get the gender drill: show a
 * verb and a person, you type the form. Two seconds each.
 */

import { esc } from '../lib/ui.js'
import { bindTextSubmit } from '../lib/keys.js'
import { checkGerman } from '../lib/normalize.js'
import { speak } from '../lib/tts.js'
import { state } from '../store.js'

export const meta = {
  id: 'conjugation',
  name: 'Conjugation',
  icon: 'shuffle',
  desc: 'Produce the right verb form. Drills the stem changes and Perfekt that catch everyone.',
}

/** The slots we can quiz, with how to phrase the prompt. */
const SLOTS = [
  { key: 'ich', label: 'ich', hint: 'I' },
  { key: 'du', label: 'du', hint: 'you (informal)' },
  { key: 'er', label: 'er / sie / es', hint: 'he / she / it' },
  { key: 'wir', label: 'wir', hint: 'we' },
  { key: 'ihr', label: 'ihr', hint: 'you (plural)' },
  { key: 'sie', label: 'sie / Sie', hint: 'they / you (formal)' },
  { key: 'praeteritum', label: 'Präteritum', hint: 'simple past, 3rd person' },
  { key: 'perfekt', label: 'Perfekt', hint: 'hat/ist + participle' },
]

/**
 * Which slot to ask about.
 *
 * Weighted, not uniform: du and er are where the irregularity lives, and the
 * Perfekt is where the haben/sein choice lives. wir and sie are just the
 * infinitive, so they're barely worth asking.
 */
function pickSlot(word) {
  const forms = word.forms || {}
  const available = SLOTS.filter((s) => forms[s.key])
  if (!available.length) return null

  const weight = (k) => {
    if (k === 'du' || k === 'er') return 4          // stem changes live here
    if (k === 'perfekt') return 3                   // haben/sein + participle
    if (k === 'praeteritum') return 2
    if (k === 'ihr' || k === 'ich') return 2
    return 1                                        // wir/sie == infinitive
  }
  const pool = available.flatMap((s) => Array(weight(s.key)).fill(s))
  return pool[Math.floor(Math.random() * pool.length)]
}

export function render(el, ctx) {
  const { word } = ctx
  const slot = pickSlot(word)

  // A verb with no forms shouldn't reach here, but a hand-added one might.
  // This used to skip the card synchronously mid-render, which flashed it past
  // and lost the review.
  if (!slot) {
    ctx.unavailable('no conjugation forms for this verb')
    return
  }

  const expected = word.forms[slot.key]
  const isCompound = slot.key === 'perfekt' || word.separable

  el.innerHTML = `
    <div class="prompt">
      <div class="prompt-meta">
        <span class="level-badge level-${esc(word.level)}">${esc(word.level)}</span>
        <span class="prompt-cat">conjugation</span>
        ${word.separable ? '<span class="chip active chip-mini">separable</span>' : ''}
        ${word.auxiliary ? `<span class="chip chip-mini">${esc(word.auxiliary)}</span>` : ''}
      </div>
      <div class="prompt-word de">${esc(word.lemma)}</div>
      <div class="prompt-sub">${esc(word.translation)}</div>

      <div class="conj-slot">
        <span class="conj-person de">${esc(slot.label)}</span>
        <span class="conj-hint">${esc(slot.hint)}</span>
      </div>
    </div>

    <div style="width:100%;max-width:430px;margin:0 auto">
      <input class="type-input" id="conjIn" autocomplete="off" autocorrect="off"
             autocapitalize="off" spellcheck="false"
             placeholder="${isCompound ? 'two words' : '…'}" />
    </div>
  `

  // This was the most under-specified card in the app. It shows you a verb and
  // the word "du" and an empty box — and never said whether it wanted the
  // pronoun, whether a separable prefix comes along, or whether the Perfekt
  // includes its auxiliary. That matters: normalize() does not strip a leading
  // pronoun, so typing the obvious "du fährst" against an expected "fährst"
  // was graded wrong, with nothing on screen to explain why.
  ctx.setTask(
    slot.key === 'perfekt'
      ? `Type the Perfekt: <b>${esc(word.auxiliary || 'hat')}</b> + the participle. Two words, no pronoun.`
      : slot.key === 'praeteritum'
        ? 'Type the Präteritum (simple past), 3rd person. One word, no pronoun.'
        : word.separable
          ? `Type the <b>${esc(slot.label)}</b> form: verb first, then the prefix, as two words. No pronoun.`
          : `Type the <b>${esc(slot.label)}</b> form of this verb. No pronoun.`
  )

  const input = el.querySelector('#conjIn')
  setTimeout(() => input.focus(), 30)

  let submitted = false

  const submit = () => {
    if (submitted) return
    let given = input.value.trim()
    if (!given) { input.focus(); return false }
    submitted = true

    // Belt and braces to the task line above: if you typed the pronoun anyway,
    // drop it rather than mark a correct conjugation wrong over a word we
    // ourselves put on the screen. Done here, not in normalize.js — that file's
    // behaviour is pinned by answers.test.mjs and shared with every other mode.
    const pronouns = slot.label.toLowerCase().split(' / ')
    const firstWord = given.split(/\s+/)[0]?.toLowerCase()
    if (pronouns.includes(firstWord) && given.split(/\s+/).length > 1) {
      given = given.slice(firstWord.length).trim()
    }

    const result = checkGerman(given, expected, { strict: state.settings.typingStrict })
    input.disabled = true
    input.classList.add(result.correct ? 'correct' : result.close ? 'close' : 'wrong')

    // Show the whole table on a miss — the point is to see the pattern, not
    // just the one form you got wrong.
    const table = SLOTS.filter((s) => word.forms[s.key]).map((s) => `
      <div class="form-item ${s.key === slot.key ? 'form-asked' : ''}">
        <span class="form-key">${esc(s.label)}</span>
        <span class="form-val">${esc(word.forms[s.key])}</span>
      </div>`).join('')

    speak(`${slot.key === 'perfekt' || slot.key === 'praeteritum' ? '' : slot.label.split(' ')[0] + ' '}${expected}`)

    // The table used to be rendered here and then wiped 700ms later — a full
    // conjugation, shown for two thirds of a second, on the mode whose entire
    // purpose is seeing the pattern rather than the single form you missed.
    ctx.showResult({
      correct: result.correct,
      close: result.close,
      answer: given,
      expected,
      verbOnly: true,
      message: result.message,
      detail: `
        <div class="answer-label">Full conjugation</div>
        <div class="forms-grid">${table}</div>
        ${word.notes ? `<div class="note-box" style="margin-top:var(--s3)">${esc(word.notes)}</div>` : ''}`,
      suggestedRating: result.correct ? 3 : result.close ? 2 : 1,
    })
  }

  bindTextSubmit(input, submit)
  ctx.setPrimary({ label: 'Check', run: submit })
  ctx.setFocusTarget(input)
}

/** Verbs whose conjugation is still shaky, for the standalone drill. */
export function conjugationQueue(limit = 30) {
  const now = Date.now()
  return state.words
    .filter((w) => w.partOfSpeech === 'verb' && w.forms && w.forms.du)
    .map((w) => ({ word: w, v: state.progress.verbs?.[w.id] }))
    .filter(({ v }) => !v || !v.due || v.due <= now)
    .sort((a, b) => {
      // Irregular verbs first — they're the ones worth drilling.
      const irregular = (w) => (w.forms.du !== w.lemma.replace(/e[nr]$/, '') + 'st' ? 1 : 0)
      const ai = irregular(a.word), bi = irregular(b.word)
      if (ai !== bi) return bi - ai
      return (a.word.frequency || 9999) - (b.word.frequency || 9999)
    })
    .slice(0, limit)
    .map(({ word }) => word)
}
