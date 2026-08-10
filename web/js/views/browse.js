/**
 * Browse — search the whole deck, inspect any word.
 *
 * With ~2600 words this is also where you go to answer "do I even have a word
 * for X?", so search covers German, English, category, notes and tags at once.
 */

import { esc, debounce, plural, toast } from '../lib/ui.js'
import { icon } from '../lib/icons.js'
import { renderAnswer, bindAnswerAudio } from '../lib/wordcard.js'
import { state, getCard, addWord, deckLevels } from '../store.js'
import { stripArticle } from '../lib/normalize.js'
import { speakWord } from '../lib/tts.js'

let query = ''
let filterLevel = 'all'
let filterCat = 'all'
let filterStatus = 'all'
let sortBy = 'frequency'
let shown = []
let detailWord = null

const root = () => document.getElementById('view-browse')

export function open() { render() }

function status(card) {
  if (!card || !card.reps) return 'new'
  if ((card.lapses || 0) >= 5) return 'leech'
  if (card.state === 'learning' || card.state === 'relearning') return 'learning'
  if ((card.stability || 0) >= 21) return 'mature'
  return 'young'
}

const STATUS_LABEL = { new: 'not started', learning: 'learning', young: 'young', mature: 'known', leech: 'trouble' }

function filtered() {
  const q = query.trim().toLowerCase()
  let out = state.words.filter((w) => {
    if (filterLevel !== 'all' && w.level !== filterLevel) return false
    if (filterCat !== 'all' && w.category !== filterCat) return false
    if (filterStatus !== 'all' && status(state.progress.cards[w.id]) !== filterStatus) return false
    if (!q) return true
    return w.word.toLowerCase().includes(q)
      || w.translation.toLowerCase().includes(q)
      || (w.translations || []).some((t) => t.toLowerCase().includes(q))
      || w.category.toLowerCase().includes(q)
      || (w.notes || '').toLowerCase().includes(q)
      || (w.germany_context || '').toLowerCase().includes(q)
      || (w.tags || []).some((t) => t.includes(q))
      || (w.example_sentences || []).some((e) => e.de.toLowerCase().includes(q))
  })

  const sorters = {
    frequency: (a, b) => (a.frequency || 9999) - (b.frequency || 9999),
    alpha: (a, b) => stripArticle(a.word).localeCompare(stripArticle(b.word), 'de'),
    level: (a, b) => a.level.localeCompare(b.level) || (a.frequency || 9999) - (b.frequency || 9999),
    strength: (a, b) => (getCard(a.id).stability || 0) - (getCard(b.id).stability || 0),
  }
  return out.sort(sorters[sortBy] || sorters.frequency)
}

function render() {
  const cats = [...new Set(state.words.map((w) => w.category))].sort()
  shown = filtered()

  root().innerHTML = `
    <div class="view-pad wide">
      <div class="view-head">
        <div>
          <h1>Browse</h1>
          <div class="sub">${plural(shown.length, 'word')} of ${state.words.length}</div>
        </div>
        <button class="btn primary" id="addWordBtn">+ Add a word</button>
      </div>

      <input class="search-input browse-search" id="searchInput" type="search"
             placeholder="Search German, English, notes, examples…" value="${esc(query)}" />

      <div class="filter-row">
        <select class="ctrl" id="fLevel">
          <option value="all">All levels</option>
          ${deckLevels().map((l) => `<option value="${l}" ${filterLevel === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select class="ctrl" id="fCat">
          <option value="all">All categories</option>
          ${cats.map((c) => `<option value="${esc(c)}" ${filterCat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <select class="ctrl" id="fStatus">
          <option value="all">Any status</option>
          ${Object.entries(STATUS_LABEL).map(([k, v]) =>
            `<option value="${k}" ${filterStatus === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <select class="ctrl" id="fSort">
          <option value="frequency" ${sortBy === 'frequency' ? 'selected' : ''}>Most useful first</option>
          <option value="alpha" ${sortBy === 'alpha' ? 'selected' : ''}>A–Z</option>
          <option value="level" ${sortBy === 'level' ? 'selected' : ''}>By level</option>
          <option value="strength" ${sortBy === 'strength' ? 'selected' : ''}>Weakest first</option>
        </select>
      </div>

      ${shown.length === 0 ? `
        <div class="empty">
          <div class="empty-icon">${icon('browse')}</div>
          <h3>Nothing matches</h3>
          <p>Try a different search, or clear the filters.</p>
        </div>
      ` : `
        <div class="word-table">
          <div class="wt-head">
            <span></span><span>Word</span><span>Meaning</span>
            <span>Category</span><span>Level</span>
          </div>
          ${shown.slice(0, 400).map(renderRow).join('')}
        </div>
        ${shown.length > 400 ? `<p class="muted" style="text-align:center;padding:var(--s4);color:var(--text3)">
          Showing the first 400. Narrow the search to see more.</p>` : ''}
      `}
    </div>
  `

  const el = root()
  const search = el.querySelector('#searchInput')
  if (search) {
    search.addEventListener('input', debounce((e) => {
      query = e.target.value
      const pos = e.target.selectionStart
      render()
      const s = root().querySelector('#searchInput')
      s.focus()
      s.setSelectionRange(pos, pos)
    }, 200))
  }

  el.querySelector('#fLevel')?.addEventListener('change', (e) => { filterLevel = e.target.value; render() })
  el.querySelector('#fCat')?.addEventListener('change', (e) => { filterCat = e.target.value; render() })
  el.querySelector('#fStatus')?.addEventListener('change', (e) => { filterStatus = e.target.value; render() })
  el.querySelector('#fSort')?.addEventListener('change', (e) => { sortBy = e.target.value; render() })

  el.querySelectorAll('.wt-row').forEach((row) => {
    row.addEventListener('click', () => showDetail(row.dataset.id))
  })

  el.querySelector('#addWordBtn')?.addEventListener('click', openAddForm)
}

// ─── ADD YOUR OWN WORD ────────────────────────────────────────────────────────
/**
 * You will hear words in Germany that aren't in the deck. Editing JSON by hand
 * is enough friction that you won't bother, so this writes the entry for you —
 * schema-complete, straight into data/vocab/00-my-words.json, in the deck the
 * moment you hit save.
 */
function openAddForm() {
  const panel = document.getElementById('drawerPanel')
  panel.innerHTML = `
    <button class="drawer-close" data-close>${icon('x')}</button>
    <h2 style="margin-bottom:.2rem">Add a word</h2>
    <p class="muted" style="color:var(--text3);font-size:.85rem;margin-bottom:1rem">
      Goes into <code>data/vocab/00-my-words.json</code>. Only the first two fields are required.
    </p>

    <form id="addForm" class="stack-form">
      <label class="field">
        <span>German word *</span>
        <input class="search-input" name="word" required autocomplete="off"
               placeholder="die Steckdose  ·  basteln  ·  gemütlich">
        <span class="muted" style="font-size:.76rem;color:var(--text3)">
          Nouns need their article — write "die Steckdose", not "Steckdose".</span>
      </label>

      <label class="field">
        <span>English meaning *</span>
        <input class="search-input" name="translation" required autocomplete="off"
               placeholder="power socket">
      </label>

      <div class="filter-row" style="margin-bottom:0">
        <label class="field">
          <span>Type</span>
          <select class="ctrl" name="partOfSpeech">
            <option value="noun">noun</option>
            <option value="verb">verb</option>
            <option value="adjective">adjective</option>
            <option value="adverb">adverb</option>
            <option value="phrase">phrase</option>
            <option value="preposition">preposition</option>
            <option value="conjunction">conjunction</option>
          </select>
        </label>
        <label class="field">
          <span>Level</span>
          <select class="ctrl" name="level">
            ${deckLevels().map((l) => `<option value="${l}"${l === 'A1' ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>

      <label class="field" id="pluralField">
        <span>Plural</span>
        <input class="search-input" name="plural" autocomplete="off" placeholder="die Steckdosen">
      </label>

      <label class="field">
        <span>Example sentence (German)</span>
        <input class="search-input" name="exDe" autocomplete="off"
               placeholder="Wo ist die nächste Steckdose?">
      </label>
      <label class="field">
        <span>…and its English</span>
        <input class="search-input" name="exEn" autocomplete="off"
               placeholder="Where is the nearest socket?">
      </label>

      <label class="field">
        <span>Note to yourself</span>
        <input class="search-input" name="notes" autocomplete="off"
               placeholder="German sockets are Schuko type F">
      </label>

      <div id="addError" class="mistake-box" hidden></div>

      <div style="display:flex;gap:.5rem;margin-top:.3rem">
        <button type="submit" class="btn primary">Add to deck</button>
        <button type="button" class="btn ghost" data-close>Cancel</button>
      </div>
    </form>
  `

  const drawer = document.getElementById('drawer')
  drawer.hidden = false

  const form = panel.querySelector('#addForm')
  const errBox = panel.querySelector('#addError')
  const pluralField = panel.querySelector('#pluralField')

  // Plural only makes sense for nouns.
  const syncType = () => {
    pluralField.hidden = form.partOfSpeech.value !== 'noun'
  }
  form.partOfSpeech.addEventListener('change', syncType)
  syncType()

  setTimeout(() => form.word.focus(), 60)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    errBox.hidden = true
    const btn = form.querySelector('button[type="submit"]')
    btn.disabled = true
    btn.textContent = 'Adding…'

    try {
      const added = await addWord({
        word: form.word.value,
        translation: form.translation.value,
        partOfSpeech: form.partOfSpeech.value,
        level: form.level.value,
        plural: form.plural.value,
        notes: form.notes.value,
        examples: form.exDe.value.trim()
          ? [{ de: form.exDe.value, en: form.exEn.value }]
          : [],
      })
      drawer.hidden = true
      toast(`Added “${added.word}” — ${state.words.length} words in the deck`)
      render()
    } catch (err) {
      errBox.textContent = err.message
      errBox.hidden = false
    } finally {
      btn.disabled = false
      btn.textContent = 'Add to deck'
    }
  })
}

/**
 * One row. The "Next" column is gone: it printed the raw scheduling interval
 * ("12d", "3mo") on up to 400 rows at once — a number you can act on in no way
 * whatsoever, four hundred times over. The coloured status dot already says the
 * only thing about a word's schedule that is worth knowing at a glance.
 */
function renderRow(w) {
  const st = status(state.progress.cards[w.id])
  return `
    <div class="wt-row" data-id="${esc(w.id)}" title="${esc(STATUS_LABEL[st])}">
      <span class="dot ${st}"></span>
      <span class="wt-word de">
        ${w.article ? `<span class="art-pill art-${w.article}">${w.article}</span> ` : ''}${esc(stripArticle(w.word))}
      </span>
      <span class="wt-trans">${esc(w.translation)}</span>
      <span class="wt-cat">${esc(w.category)}</span>
      <span><span class="level-badge level-${esc(w.level)}">${esc(w.level)}</span></span>
    </div>
  `
}

export function showDetail(id) {
  const w = state.wordsById.get(id)
  if (!w) return
  detailWord = w

  const card = getCard(w.id)
  const st = status(state.progress.cards[w.id])
  const g = state.progress.gender[w.id]

  // "memory" was the FSRS stability parameter and "difficulty" was its D
  // coefficient — Anki's ease factor, a 1-to-10 model internal — presented as
  // headline statistics with no explanation and nothing you could do about
  // either. What is left is what you can actually read: how many times you have
  // seen this word, and how many times it got away from you.
  document.getElementById('drawerPanel').innerHTML = `
    <button class="drawer-close" data-close>${icon('x')}</button>
    <div class="prompt-meta" style="justify-content:flex-start">
      <span class="level-badge level-${esc(w.level)}">${esc(w.level)}</span>
      <span class="prompt-cat">${esc(w.category)}</span>
      <span class="dot ${st}"></span><span class="prompt-cat">${STATUS_LABEL[st]}</span>
    </div>
    ${renderAnswer(w)}
    ${card.reps ? `
      <div class="panel" style="margin-top:var(--s3)">
        <h3>Your history</h3>
        <p style="color:var(--text3);font-size:var(--t-sm)">
          Seen ${plural(card.reps, 'time')}${
            card.lapses ? `, forgotten ${plural(card.lapses, 'time')}` : ' — never forgotten'}.
          ${g ? `Gender drill: ${g.correct || 0} right, ${g.wrong || 0} wrong.` : ''}
        </p>
      </div>` : ''}
  `

  const drawer = document.getElementById('drawer')
  drawer.hidden = false
  bindAnswerAudio(drawer)
  speakWord(w)
}

export const activeWord = () => (!document.getElementById('drawer').hidden ? detailWord : null)

export function handleKey(e) {
  if (e.key === '/' ) {
    e.preventDefault()
    root().querySelector('#searchInput')?.focus()
    return true
  }
  return false
}
