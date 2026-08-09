/**
 * Flashcard — see it, recall it, grade yourself.
 * The classic. Fast, low-friction, good for the middle of the ladder.
 */

import { esc } from '../lib/ui.js'
import { icon } from '../lib/icons.js'
import { imageHtml } from '../lib/wordcard.js'
import { stripArticle } from '../lib/normalize.js'
import { speakWord } from '../lib/tts.js'
import { state } from '../store.js'

export const meta = {
  id: 'flashcard',
  name: 'Flashcard',
  icon: 'cards',
  desc: 'See a word, recall the meaning, grade yourself honestly.',
  selfGraded: true,
}

export function render(el, ctx) {
  const { word } = ctx
  const dir = ctx.direction || state.settings.direction
  const showGerman = dir === 'de-en' || (dir === 'mixed' && Math.random() > 0.5)

  // Nouns show with their article either way — the ternary that used to be here
  // had the same expression in both branches, so it had never done anything.
  const front = showGerman ? word.word : (word.translations?.[0] || word.translation)

  el.innerHTML = `
    <div class="prompt">
      <div class="prompt-meta">
        <span class="level-badge level-${esc(word.level)}">${esc(word.level)}</span>
        <span class="prompt-cat">${esc(word.category)}</span>
        ${word.partOfSpeech ? `<span class="pos-tag">${esc(word.partOfSpeech)}</span>` : ''}
      </div>
      ${!showGerman ? imageHtml(word) : ''}
      <div class="prompt-word ${showGerman ? 'de' : 'en'}">${esc(front)}</div>
      ${showGerman ? `<button class="btn ghost sm" id="fcPlay" style="margin-top:var(--s3)">${icon('volume')} Listen</button>` : ''}
    </div>
  `

  ctx.setTask(showGerman
    ? 'Recall what this means, then reveal it.'
    : 'Recall the German — <b>with</b> its der/die/das — then reveal it.')

  el.querySelector('#fcPlay')?.addEventListener('click', (e) => {
    e.stopPropagation()
    speakWord(word)
  })

  if (showGerman && state.settings.autoPlayAudio) speakWord(word)

  // A real button, in #controls, always visible. This mode's only affordance
  // used to be a line reading "press Space to check" — inside .hint-line, which
  // is display:none on touch. On a phone the card had no way to be answered at
  // all: no button, no hint, and Space is not a key a phone keyboard shows you.
  ctx.setPrimary({
    label: 'Show answer',
    // Nothing to grade — the honest self-assessment happens on the rating row.
    run: () => ctx.showResult({ correct: null, answer: null, showGerman, suggestedRating: null }),
  })
}

export const label = (word, dir) =>
  dir === 'en-de' ? word.translation : stripArticle(word.word)
