/**
 * Listening — audio only, no text.
 *
 * Reading German and understanding spoken German are close to separate skills.
 * Germans speak fast, swallow endings, and won't slow down for you. This mode
 * removes the text entirely: you hear the word, and you have to know it.
 *
 * There's a deliberate "slower" button rather than a permanently slow voice —
 * you should be training on normal speed and only dropping down when stuck.
 */

import { esc } from '../lib/ui.js'
import { icon } from '../lib/icons.js'
import { bindTextSubmit } from '../lib/keys.js'
import { checkGerman } from '../lib/normalize.js'
import { speakWord, speak, stopSpeaking } from '../lib/tts.js'
import { state } from '../store.js'

export const meta = {
  id: 'listening',
  name: 'Listening',
  icon: 'headphones',
  desc: 'Hear it with no text on screen. Trains the ear, not the eye.',
}

export function render(el, ctx) {
  const { word } = ctx
  const isNoun = word.partOfSpeech === 'noun'
  const sentence = word.example_sentences?.[0]?.de

  el.innerHTML = `
    <div class="listen-stage">
      <div class="prompt-meta">
        <span class="level-badge level-${esc(word.level)}">${esc(word.level)}</span>
        <span class="prompt-cat">listening</span>
      </div>

      <button class="listen-btn" id="playBtn" title="Play again (Space)">${icon('volume')}</button>

      <div class="listen-controls">
        <button class="btn ghost sm" id="slowBtn">${icon('slower')} Slower</button>
        ${sentence ? `<button class="btn ghost sm" id="sentBtn">${icon('chat')} In a sentence</button>` : ''}
        <button class="btn ghost sm" id="revealBtn">${icon('eye')} Reveal it</button>
      </div>

      <div style="width:100%;max-width:420px">
        <input class="type-input" id="listenIn" autocomplete="off" autocorrect="off"
               autocapitalize="off" spellcheck="false" placeholder="what did you hear?" />
      </div>
    </div>
  `

  // The screen is a play button and an empty box. Nothing on it said which
  // language to answer in, and for a noun it silently wanted the article too.
  ctx.setTask(isNoun
    ? 'Type the German word you hear, <b>with</b> its der/die/das.'
    : 'Type the German word you hear.')

  const playBtn = el.querySelector('#playBtn')
  const input = el.querySelector('#listenIn')

  const play = async (rate) => {
    playBtn.classList.add('playing')
    try { await speakWord(word, rate ? { rate } : undefined) } catch {}
    playBtn.classList.remove('playing')
  }

  playBtn.addEventListener('click', () => play())
  el.querySelector('#slowBtn').addEventListener('click', () => play(0.55))
  el.querySelector('#sentBtn')?.addEventListener('click', () => {
    stopSpeaking()
    speak(sentence)
  })

  play()
  setTimeout(() => input.focus(), 40)

  let submitted = false

  const submit = () => {
    if (submitted) return
    submitted = true
    const given = input.value.trim()

    // Empty means "I want to see it" — an honest "I didn't catch that", not a
    // wrong answer worth the same penalty as a mis-hearing.
    if (!given) {
      ctx.showResult({
        correct: false, answer: null, expected: word.word,
        message: 'Revealed — no penalty for asking.',
        suggestedRating: 1, revealed: true,
      })
      return
    }

    const result = checkGerman(given, word.word, { strict: state.settings.typingStrict })
    input.disabled = true
    input.classList.add(result.correct ? 'correct' : result.close ? 'close' : 'wrong')

    ctx.showResult({
      correct: result.correct,
      close: result.close,
      answer: given,
      expected: word.word,
      // checkGerman explains article misses in words ("Right — but the article
      // is die"). This mode computed that string and threw it away.
      message: result.message,
      suggestedRating: result.correct ? 3 : result.close ? 2 : 1,
    })
  }

  // The reveal used to be Enter-on-an-empty-box, mentioned only in a hint line
  // that touch devices hide — so on a phone it did not exist.
  el.querySelector('#revealBtn').addEventListener('click', () => { input.value = ''; submit() })

  bindTextSubmit(input, submit)

  ctx.setKeyHandler((e) => {
    // Space replays rather than submits — you'll want to hear it more than once.
    if (e.key === ' ' && document.activeElement !== input) { play(); return true }
    return false
  })

  ctx.setPrimary({ label: 'Check', run: submit })
  ctx.setFocusTarget(input)
}
