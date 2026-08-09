/**
 * Der / die / das — the gender drill.
 *
 * Gender is the single biggest source of "sounding foreign" for a learner, and
 * it's the thing English and Turkish speakers have no intuition for at all
 * (neither language has grammatical gender). It also can't be reasoned out
 * mid-sentence — it has to be automatic.
 *
 * So it gets its own fast track: no meaning, no typing, three buttons, one
 * second per card. And crucially, after each answer we show the *rule* that
 * predicts it, because ~80% of German nouns are predictable from their ending
 * and learning 20 rules beats memorising 900 facts.
 */

import { esc } from '../lib/ui.js'
import { stripArticle } from '../lib/normalize.js'
import { speakWord } from '../lib/tts.js'
import { state } from '../store.js'

export const meta = {
  id: 'gender',
  name: 'Der / die / das',
  icon: 'palette',
  desc: 'Rapid-fire article drill. Learn the patterns, not 900 separate facts.',
}

/**
 * Ending-based gender rules, most specific first.
 * These cover the large majority of German nouns.
 */
const RULES = [
  { re: /chen$/, g: 'das', why: '<strong>-chen</strong> is always <strong>das</strong> (a diminutive — even das Mädchen)' },
  { re: /lein$/, g: 'das', why: '<strong>-lein</strong> is always <strong>das</strong> (diminutive)' },
  { re: /ung$/, g: 'die', why: '<strong>-ung</strong> is always <strong>die</strong>' },
  { re: /heit$/, g: 'die', why: '<strong>-heit</strong> is always <strong>die</strong>' },
  { re: /keit$/, g: 'die', why: '<strong>-keit</strong> is always <strong>die</strong>' },
  { re: /schaft$/, g: 'die', why: '<strong>-schaft</strong> is always <strong>die</strong>' },
  { re: /tion$/, g: 'die', why: '<strong>-tion</strong> is always <strong>die</strong>' },
  { re: /sion$/, g: 'die', why: '<strong>-sion</strong> is always <strong>die</strong>' },
  { re: /tät$/, g: 'die', why: '<strong>-tät</strong> is always <strong>die</strong>' },
  { re: /ik$/, g: 'die', why: '<strong>-ik</strong> is nearly always <strong>die</strong>' },
  { re: /enz$/, g: 'die', why: '<strong>-enz</strong> is always <strong>die</strong>' },
  { re: /anz$/, g: 'die', why: '<strong>-anz</strong> is always <strong>die</strong>' },
  { re: /ei$/, g: 'die', why: '<strong>-ei</strong> is nearly always <strong>die</strong> (die Bäckerei)' },
  { re: /ur$/, g: 'die', why: '<strong>-ur</strong> is usually <strong>die</strong>' },
  { re: /ie$/, g: 'die', why: '<strong>-ie</strong> is usually <strong>die</strong>' },
  { re: /in$/, g: 'die', why: '<strong>-in</strong> marks a female person — <strong>die</strong>' },
  { re: /ling$/, g: 'der', why: '<strong>-ling</strong> is always <strong>der</strong>' },
  { re: /ismus$/, g: 'der', why: '<strong>-ismus</strong> is always <strong>der</strong>' },
  { re: /ant$/, g: 'der', why: '<strong>-ant</strong> is usually <strong>der</strong>' },
  { re: /ent$/, g: 'der', why: '<strong>-ent</strong> is usually <strong>der</strong> (people)' },
  { re: /ist$/, g: 'der', why: '<strong>-ist</strong> is usually <strong>der</strong>' },
  { re: /or$/, g: 'der', why: '<strong>-or</strong> is usually <strong>der</strong>' },
  { re: /er$/, g: 'der', why: '<strong>-er</strong> is usually <strong>der</strong> (esp. people & tools)' },
  { re: /um$/, g: 'das', why: '<strong>-um</strong> is usually <strong>das</strong>' },
  { re: /ment$/, g: 'das', why: '<strong>-ment</strong> is usually <strong>das</strong>' },
  { re: /nis$/, g: 'das', why: '<strong>-nis</strong> is usually <strong>das</strong>' },
  { re: /tum$/, g: 'das', why: '<strong>-tum</strong> is usually <strong>das</strong>' },
  { re: /^Ge/, g: 'das', why: 'nouns starting <strong>Ge-</strong> are usually <strong>das</strong>' },
]

/** The rule that explains this noun's gender, if there is one. */
export function genderRule(word) {
  const bare = stripArticle(word.word)
  for (const r of RULES) {
    if (r.re.test(bare) && r.g === word.article) return r.why
  }
  return null
}

export function render(el, ctx) {
  const { word } = ctx
  const bare = stripArticle(word.word)

  el.innerHTML = `
    <div class="prompt">
      <div class="prompt-meta">
        <span class="level-badge level-${esc(word.level)}">${esc(word.level)}</span>
        <span class="prompt-cat">${esc(word.category)}</span>
      </div>
      ${word.emoji ? `<div class="prompt-emoji">${word.emoji}</div>` : ''}
      <div class="prompt-word de">${esc(bare)}</div>
      <div class="prompt-sub">${esc(word.translation)}</div>
    </div>
    <div class="gender-row">
      <button class="gender-btn" data-a="der">der<span class="g-key">1</span></button>
      <button class="gender-btn" data-a="die">die<span class="g-key">2</span></button>
      <button class="gender-btn" data-a="das">das<span class="g-key">3</span></button>
    </div>
  `

  ctx.setTask('Which article — <b>der</b>, <b>die</b> or <b>das</b>?')

  let answered = false
  const buttons = [...el.querySelectorAll('.gender-btn')]

  const choose = (article) => {
    if (answered || !article) return
    answered = true
    const correct = article === word.article

    buttons.forEach((b) => {
      b.disabled = true
      if (b.dataset.a === word.article) b.classList.add('right')
      else if (b.dataset.a === article) b.classList.add('wrong')
    })

    // Hearing the correct article with the word is half the learning. It always
    // finishes now: the card no longer advances out from under it.
    speakWord(word)

    // The rule is the entire point of this drill — 20 endings beat 900 facts.
    // It used to be rendered here and then wiped 950ms later along with the
    // card, so the one thing worth reading got under a second on screen. It now
    // goes into the answer panel and stays until you move on.
    const rule = genderRule(word)
    const detail = rule
      ? `<div class="gender-rule">${rule}</div>`
      : word.mnemonic
        ? `<div class="gender-rule"><span class="box-label">Memory hook</span>${esc(word.mnemonic)}</div>`
        : null

    ctx.showResult({
      correct,
      answer: article,
      expected: word.article,
      genderOnly: true,
      detail,
      suggestedRating: correct ? 3 : 1,
    })
  }

  buttons.forEach((b) => b.addEventListener('click', () => choose(b.dataset.a)))

  ctx.setKeyHandler((e) => {
    // Arrow keys are gone: they were undocumented, and left/down/right mapping
    // to der/die/das is not something anyone would guess or remember.
    const map = { 1: 'der', 2: 'die', 3: 'das' }
    if (map[e.key]) { choose(map[e.key]); return true }
    return false
  })
}

/** Nouns whose gender is still shaky, for the standalone drill. */
export function genderQueue(limit = 30) {
  const now = Date.now()
  return state.words
    .filter((w) => w.partOfSpeech === 'noun' && w.article)
    .map((w) => ({ word: w, g: state.progress.gender[w.id] }))
    .filter(({ g }) => !g || !g.due || g.due <= now)
    .sort((a, b) => {
      // Never-tried first, then the ones you keep missing, then by usefulness.
      const aTried = a.g ? 1 : 0, bTried = b.g ? 1 : 0
      if (aTried !== bTried) return aTried - bTried
      const aBad = (a.g?.wrong || 0) - (a.g?.correct || 0)
      const bBad = (b.g?.wrong || 0) - (b.g?.correct || 0)
      if (aBad !== bBad) return bBad - aBad
      return (a.word.frequency || 9999) - (b.word.frequency || 9999)
    })
    .slice(0, limit)
    .map(({ word }) => word)
}
