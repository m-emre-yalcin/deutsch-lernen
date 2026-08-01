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
import { checkGerman } from '../lib/normalize.js'
import { speakWord, speak, stopSpeaking } from '../lib/tts.js'
import { state } from '../store.js'

export const meta = {
  id: 'listening',
  name: 'Listening',
  icon: '🎧',
  desc: 'Hear it with no text on screen. Trains the ear, not the eye.',
}

export function render(el, ctx) {
  const { word } = ctx
  const sentence = word.example_sentences?.[0]?.de

  el.innerHTML = `
    <div class="listen-stage">
      <div class="prompt-meta">
        <span class="level-badge level-${esc(word.level)}">${esc(word.level)}</span>
        <span class="prompt-cat">listening</span>
      </div>

      <button class="listen-btn" id="playBtn" title="Play (Space)">🔊</button>

      <div class="listen-controls">
        <button class="btn ghost sm" id="slowBtn">🐢 Slower</button>
        ${sentence ? `<button class="btn ghost sm" id="sentBtn">💬 In a sentence</button>` : ''}
      </div>

      <div style="width:100%;max-width:420px">
        <input class="type-input" id="listenIn" autocomplete="off" autocorrect="off"
               autocapitalize="off" spellcheck="false" placeholder="what did you hear?" />
        <div class="listen-hint">
          Type what you heard, or press <kbd>Enter</kbd> empty to just reveal it
        </div>
      </div>
    </div>
  `

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
      ctx.onAnswer({ correct: false, answer: null, expected: word.word, suggestedRating: 1, revealed: true })
      return
    }

    const result = checkGerman(given, word.word, { strict: state.settings.typingStrict })
    input.disabled = true
    input.classList.add(result.correct ? 'correct' : result.close ? 'close' : 'wrong')

    setTimeout(() => ctx.onAnswer({
      correct: result.correct,
      close: result.close,
      answer: given,
      expected: word.word,
      suggestedRating: result.correct ? 3 : result.close ? 2 : 1,
    }), result.correct ? 300 : 700)
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    e.stopPropagation()
  })

  ctx.setKeyHandler((e) => {
    // Space replays rather than submits — you'll want to hear it more than once.
    if (e.key === ' ' && document.activeElement !== input) { play(); return true }
    return false
  })

  ctx.setSubmit(submit)
  ctx.setFocusTarget(input)
}
