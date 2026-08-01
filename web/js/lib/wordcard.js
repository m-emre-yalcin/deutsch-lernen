/**
 * The answer panel — everything known about a word, rendered once and reused by
 * every mode. When you get something wrong, this is what you read, so it has to
 * carry the actual teaching: forms, examples, the gender trick, the note about
 * how it works in Germany, and a way out to a better explanation.
 */

import { esc } from './ui.js'
import { buildLinks, explainMistakeLink, sentenceAiLink } from './links.js'
import { stripArticle } from './normalize.js'
import { speak, speakSentence } from './tts.js'
import { state } from '../store.js'

const FORM_LABELS = {
  ich: 'ich', du: 'du', er: 'er/sie/es', wir: 'wir', ihr: 'ihr', sie: 'sie/Sie',
  praeteritum: 'Präteritum', perfekt: 'Perfekt', imperativ: 'Imperativ',
  komparativ: 'comparative', superlativ: 'superlative',
  genitiv: 'Genitiv', dativPlural: 'Dativ pl.',
}

/**
 * Full answer panel.
 * @param {object} word
 * @param {object} opts  { mistake: {given, expected}, compact: bool }
 */
export function renderAnswer(word, opts = {}) {
  const isNoun = word.partOfSpeech === 'noun'
  const parts = []

  // ── headword ──
  parts.push(`
    <div class="answer-main">
      ${isNoun && word.article ? `<span class="art-pill art-${word.article}">${esc(word.article)}</span>` : ''}
      <span>${esc(isNoun ? stripArticle(word.word) : word.word)}</span>
      <button class="btn ghost sm" data-speak="${esc(word.word)}" title="Listen (L)">🔊</button>
    </div>
    <div class="answer-trans">${esc(word.translations?.join(' · ') || word.translation)}</div>
  `)

  // ── mistake feedback, when we came here from a wrong answer ──
  if (opts.mistake) {
    parts.push(`
      <div class="answer-section">
        <div class="mistake-box">
          You wrote <span class="bad">${esc(opts.mistake.given || '—')}</span>
          → <span class="good">${esc(opts.mistake.expected)}</span>
          <a class="link-chip" style="margin-left:.5rem"
             href="${explainMistakeLink(word, opts.mistake.given, opts.mistake.expected)}"
             target="_blank" rel="noopener">✨ Why?</a>
        </div>
      </div>
    `)
  }

  // ── noun facts ──
  if (isNoun && (word.plural || word.forms?.genitiv)) {
    const bits = []
    if (word.plural) bits.push(`<div class="form-item"><span class="form-key">plural</span><span class="form-val">${esc(word.plural)}</span></div>`)
    for (const [k, v] of Object.entries(word.forms || {})) {
      bits.push(`<div class="form-item"><span class="form-key">${esc(FORM_LABELS[k] || k)}</span><span class="form-val">${esc(v)}</span></div>`)
    }
    parts.push(`<div class="answer-section"><div class="answer-label">Forms</div><div class="forms-grid">${bits.join('')}</div></div>`)
  }

  // ── verb conjugation ──
  if (word.partOfSpeech === 'verb' && word.forms && Object.keys(word.forms).length) {
    const order = ['ich', 'du', 'er', 'wir', 'ihr', 'sie', 'praeteritum', 'perfekt', 'imperativ']
    const keys = [...order.filter((k) => word.forms[k]), ...Object.keys(word.forms).filter((k) => !order.includes(k))]
    const cells = keys.map((k) =>
      `<div class="form-item"><span class="form-key">${esc(FORM_LABELS[k] || k)}</span><span class="form-val">${esc(word.forms[k])}</span></div>`
    ).join('')

    const flags = []
    if (word.separable) flags.push('<span class="chip active">separable</span>')
    if (word.reflexive) flags.push('<span class="chip active">reflexive</span>')
    if (word.auxiliary) flags.push(`<span class="chip">Perfekt with <b>${esc(word.auxiliary)}</b></span>`)
    for (const c of word.cases || []) flags.push(`<span class="chip">+ ${esc(c.toUpperCase())}</span>`)

    parts.push(`
      <div class="answer-section">
        <div class="answer-label">Conjugation</div>
        <div class="forms-grid">${cells}</div>
        ${flags.length ? `<div class="chips" style="margin-top:.45rem">${flags.join('')}</div>` : ''}
      </div>
    `)
  }

  // ── adjective forms ──
  if (word.partOfSpeech === 'adjective' && (word.forms?.komparativ || word.forms?.superlativ)) {
    const cells = Object.entries(word.forms).map(([k, v]) =>
      `<div class="form-item"><span class="form-key">${esc(FORM_LABELS[k] || k)}</span><span class="form-val">${esc(v)}</span></div>`
    ).join('')
    parts.push(`<div class="answer-section"><div class="answer-label">Comparison</div><div class="forms-grid">${cells}</div></div>`)
  }

  // ── examples ──
  if (word.example_sentences?.length) {
    const items = word.example_sentences.map((ex) => `
      <div class="example">
        <div class="example-de">${esc(ex.de)}
          <button class="example-play" data-speak="${esc(ex.de)}" title="Listen">🔊</button>
          <a class="example-play" href="${sentenceAiLink(ex.de)}" target="_blank" rel="noopener" title="Break this sentence down">✨</a>
        </div>
        <div class="example-en">${esc(ex.en)}</div>
      </div>
    `).join('')
    parts.push(`<div class="answer-section"><div class="answer-label">In use</div>${items}</div>`)
  }

  // ── the teaching bits ──
  const boxes = []
  if (word.notes) boxes.push(`<div class="note-box">${esc(word.notes)}</div>`)
  if (word.mnemonic) boxes.push(`<div class="mnemonic-box">💡 ${esc(word.mnemonic)}</div>`)
  if (word.germany_context) boxes.push(`<div class="context-box"><strong>In Germany:</strong> ${esc(word.germany_context)}</div>`)
  if (boxes.length) parts.push(`<div class="answer-section">${boxes.join('')}</div>`)

  // ── synonyms / antonyms ──
  if (word.synonyms?.length || word.antonyms?.length) {
    const bits = []
    if (word.synonyms?.length) {
      bits.push(`<div class="tag-row"><span class="answer-label" style="margin:0 .3rem 0 0">same</span>${
        word.synonyms.map((s) => `<span class="syn-tag">${esc(s)}</span>`).join('')}</div>`)
    }
    if (word.antonyms?.length) {
      bits.push(`<div class="tag-row" style="margin-top:.25rem"><span class="answer-label" style="margin:0 .3rem 0 0">opposite</span>${
        word.antonyms.map((s) => `<span class="ant-tag">${esc(s)}</span>`).join('')}</div>`)
    }
    parts.push(`<div class="answer-section">${bits.join('')}</div>`)
  }

  // ── external lookups ──
  if (!opts.compact) {
    const links = buildLinks(word).map((l) =>
      `<a class="link-chip" href="${l.url}" target="_blank" rel="noopener" title="${esc(l.title)}">${l.icon} ${esc(l.label)}</a>`
    ).join('')
    parts.push(`<div class="answer-section"><div class="answer-label">Look it up</div><div class="link-row">${links}</div></div>`)
  }

  return `<div class="answer">${parts.join('')}</div>`
}

/** Wire the 🔊 buttons inside a rendered answer panel. */
export function bindAnswerAudio(root) {
  root.querySelectorAll('[data-speak]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const text = btn.dataset.speak
      ;(text.includes(' ') && text.split(' ').length > 3 ? speakSentence : speak)(text)
    })
  })
}

/**
 * A picture for the card front.
 *
 * The emoji shows *immediately* and the image swaps in only once it has actually
 * loaded — the first fetch for a word goes out to Openverse and can take a second
 * or two, and a card that sits blank while it waits is worse than no picture.
 * If the fetch fails the image simply removes itself and the emoji stays.
 */
export function imageHtml(word) {
  const emoji = word.emoji ? `<div class="prompt-emoji">${word.emoji}</div>` : ''
  if (!state.settings.showImages || !word.imageable) return emoji

  const q = encodeURIComponent(word.translations?.[0] || word.translation)
  const src = `/api/image?id=${encodeURIComponent(word.id)}&q=${q}`

  return `${emoji}<img class="prompt-image" src="${src}" alt="" loading="lazy" hidden
    onload="this.hidden=false; if (this.previousElementSibling?.classList.contains('prompt-emoji')) this.previousElementSibling.hidden = true"
    onerror="this.remove()">`
}
