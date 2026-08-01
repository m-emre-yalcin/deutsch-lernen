/**
 * Flashcard — see it, recall it, grade yourself.
 * The classic. Fast, low-friction, good for the middle of the ladder.
 */

import { esc } from '../lib/ui.js'
import { imageHtml } from '../lib/wordcard.js'
import { stripArticle } from '../lib/normalize.js'
import { speakWord } from '../lib/tts.js'
import { state } from '../store.js'

export const meta = {
  id: 'flashcard',
  name: 'Flashcard',
  icon: '🃏',
  desc: 'See a word, recall the meaning, grade yourself honestly.',
  selfGraded: true,
}

export function render(el, ctx) {
  const { word } = ctx
  const dir = ctx.direction || state.settings.direction
  const showGerman = dir === 'de-en' || (dir === 'mixed' && Math.random() > 0.5)

  const front = showGerman
    ? (word.partOfSpeech === 'noun' ? word.word : word.word)
    : (word.translations?.[0] || word.translation)

  el.innerHTML = `
    <div class="prompt">
      <div class="prompt-meta">
        <span class="level-badge level-${esc(word.level)}">${esc(word.level)}</span>
        <span class="prompt-cat">${esc(word.category)}</span>
        ${word.partOfSpeech ? `<span class="pos-tag">${esc(word.partOfSpeech)}</span>` : ''}
      </div>
      ${!showGerman ? imageHtml(word) : ''}
      <div class="prompt-word ${showGerman ? 'de' : 'en'}">${esc(front)}</div>
      ${showGerman ? `<button class="btn ghost sm" id="fcPlay" style="margin-top:.6rem">🔊 Listen</button>` : ''}
      <div class="hint-line">Recall it, then press <kbd>Space</kbd> to check</div>
    </div>
  `

  el.querySelector('#fcPlay')?.addEventListener('click', (e) => {
    e.stopPropagation()
    speakWord(word)
  })

  if (showGerman && state.settings.autoPlayAudio) speakWord(word)

  ctx.setSubmit(() => {
    // Nothing to grade — the honest self-assessment happens on the rating row.
    ctx.onAnswer({ correct: null, answer: null, showGerman })
  })
}

export const label = (word, dir) =>
  dir === 'en-de' ? word.translation : stripArticle(word.word)
