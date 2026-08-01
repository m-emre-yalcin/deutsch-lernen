/**
 * Grammar — lessons and their drills.
 *
 * Vocabulary without grammar gets you a pile of words you can't put in order.
 * Each lesson is short: the rule, a table, real examples, the mistakes you'll
 * actually make, then eight drills that make you use it.
 */

import { esc, shuffle } from '../lib/ui.js'
import { state, save } from '../store.js'
import { grammarAiLink } from '../lib/links.js'
import { speak } from '../lib/tts.js'
import { normalize } from '../lib/normalize.js'

let mode = 'list'        // list | lesson | drill
let lesson = null
let drills = []
let dIndex = 0
let dScore = { correct: 0, total: 0 }
let answered = false

const root = () => document.getElementById('view-grammar')

export function open() { mode = 'list'; render() }

function progressFor(id) {
  return state.progress.grammar[id] || { seen: false, drills: { correct: 0, total: 0 }, lastSeen: null }
}

// ─── LIST ─────────────────────────────────────────────────────────────────────

function renderList() {
  const lessons = [...state.grammar].sort((a, b) => (a.number || 0) - (b.number || 0))

  if (!lessons.length) {
    root().innerHTML = `
      <div class="view-pad">
        <div class="empty">
          <div class="empty-icon">📐</div>
          <h3>No grammar lessons loaded</h3>
          <p>Lessons live in <code>data/grammar/lessons.json</code>.
             Run <code>node tools/build-grammar.js</code> to build them from
             <code>data/grammar/parts/</code>.</p>
        </div>
      </div>`
    return
  }

  const groups = {}
  for (const l of lessons) (groups[l.group || 'Other'] ||= []).push(l)

  const doneCount = lessons.filter((l) => progressFor(l.id).seen).length

  root().innerHTML = `
    <div class="view-pad">
      <div class="view-head">
        <div>
          <h1>Grammar</h1>
          <div class="sub">${doneCount} of ${lessons.length} lessons read · A0 → A2</div>
        </div>
      </div>
      ${Object.entries(groups).map(([group, list]) => `
        <div class="section-title">${esc(group)}</div>
        <div class="lesson-grid">
          ${list.map((l) => {
            const p = progressFor(l.id)
            const pct = p.drills.total ? Math.round((p.drills.correct / p.drills.total) * 100) : null
            return `
            <button class="lesson-card" data-lesson="${esc(l.id)}">
              ${p.seen ? '<span class="lesson-done">✓</span>' : ''}
              <div class="lesson-num">
                ${String(l.number).padStart(2, '0')} ·
                <span class="level-badge level-${esc(l.level)}">${esc(l.level)}</span>
              </div>
              <div class="lesson-title">${esc(l.title)}</div>
              <div class="lesson-desc">${esc(l.summary || '')}</div>
              ${pct !== null ? `<div class="lesson-score">drills: ${pct}% (${p.drills.correct}/${p.drills.total})</div>` : ''}
            </button>`
          }).join('')}
        </div>
      `).join('')}
    </div>
  `

  root().querySelectorAll('[data-lesson]').forEach((b) => {
    b.addEventListener('click', () => openLesson(b.dataset.lesson))
  })
}

// ─── LESSON ───────────────────────────────────────────────────────────────────

function openLesson(id) {
  lesson = state.grammar.find((l) => l.id === id)
  if (!lesson) return
  mode = 'lesson'

  const p = progressFor(id)
  state.progress.grammar[id] = { ...p, seen: true, lastSeen: Date.now() }
  save()

  render()
}

function renderLesson() {
  const l = lesson

  root().innerHTML = `
    <div class="view-pad">
      <button class="btn ghost sm" id="backBtn" style="margin-bottom:.8rem">← All lessons</button>

      <div class="view-head">
        <div>
          <div class="lesson-num">Lesson ${String(l.number).padStart(2, '0')} ·
            <span class="level-badge level-${esc(l.level)}">${esc(l.level)}</span></div>
          <h1>${esc(l.title)}</h1>
          <div class="sub">${esc(l.summary || '')}</div>
        </div>
        <a class="link-chip" href="${grammarAiLink(l.title)}" target="_blank" rel="noopener">
          ✨ Ask Google AI about this</a>
      </div>

      <div class="panel">${sanitize(l.rule || '')}</div>

      ${(l.tables || []).map(renderTable).join('')}

      ${l.examples?.length ? `
        <div class="section-title">Examples</div>
        <div class="panel">
          ${l.examples.map((ex) => `
            <div class="example">
              <div class="example-de">${esc(ex.de)}
                <button class="example-play" data-say="${esc(ex.de)}">🔊</button></div>
              <div class="example-en">${esc(ex.en)}</div>
              ${ex.note ? `<div class="example-en" style="color:var(--accent);margin-top:.1rem">↳ ${esc(ex.note)}</div>` : ''}
            </div>`).join('')}
        </div>` : ''}

      ${l.mistakes?.length ? `
        <div class="section-title">Mistakes to avoid</div>
        ${l.mistakes.map((m) => `
          <div class="mistake-box">
            <span class="bad">${esc(m.wrong)}</span> → <span class="good">${esc(m.right)}</span>
            <div style="color:var(--text2);margin-top:.2rem">${esc(m.why)}</div>
          </div>`).join('')}` : ''}

      ${l.drills?.length ? `
        <div style="margin-top:1.6rem;text-align:center">
          <button class="btn primary big" id="drillBtn">Practise this — ${l.drills.length} exercises</button>
        </div>` : ''}
    </div>
  `

  const el = root()
  el.querySelector('#backBtn').addEventListener('click', () => { mode = 'list'; render() })
  el.querySelector('#drillBtn')?.addEventListener('click', startDrills)
  el.querySelectorAll('[data-say]').forEach((b) =>
    b.addEventListener('click', () => speak(b.dataset.say)))
}

function renderTable(t) {
  const hl = new Set((t.highlight || []).map(([r, c]) => `${r},${c}`))
  return `
    <div class="section-title">${esc(t.title || '')}</div>
    <div class="table-scroll">
      <table class="grammar-table">
        ${t.headers?.length ? `<thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}
        <tbody>
          ${(t.rows || []).map((row, ri) => `<tr>${row.map((cell, ci) =>
            ci === 0
              ? `<th>${esc(cell)}</th>`
              : `<td class="${hl.has(`${ri},${ci}`) ? 'hl' : ''}">${esc(cell)}</td>`
          ).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `
}

/**
 * The `rule` field is authored HTML from our own data files, but it still gets
 * filtered down to a known-safe tag set — a typo in a data file shouldn't be
 * able to inject markup into the page.
 */
function sanitize(html) {
  const allowed = /^(P|STRONG|EM|CODE|UL|OL|LI|BR|B|I)$/
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  // Fixed-point: unwrapping a disallowed tag promotes its children into the
  // CURRENT level, and a single pass never re-examined them — markup nested
  // one level under a stripped tag survived. Repeat until nothing changes.
  const root = doc.body.firstChild
  let changed = true
  while (changed) {
    changed = false
    for (const el of [...root.querySelectorAll('*')]) {
      if (!allowed.test(el.tagName)) {
        el.replaceWith(...el.childNodes)
        changed = true
      } else {
        for (const attr of [...el.attributes]) el.removeAttribute(attr.name)
      }
    }
  }
  return root.innerHTML
}

// ─── DRILLS ───────────────────────────────────────────────────────────────────

function startDrills() {
  drills = lesson.drills || []
  dIndex = 0
  dScore = { correct: 0, total: 0 }
  mode = 'drill'
  render()
}

function renderDrill() {
  if (dIndex >= drills.length) return renderDrillDone()

  const d = drills[dIndex]
  answered = false

  root().innerHTML = `
    <div class="session">
      <div class="session-top">
        <div class="session-counts">
          <span class="count-pill count-due">${dIndex + 1} / ${drills.length}</span>
          <span class="session-mode-tag">${esc(lesson.title)}</span>
        </div>
        <div class="bar-track" style="flex:1">
          <div class="bar-fill" style="width:${(dIndex / drills.length) * 100}%"></div>
        </div>
        <button class="btn ghost sm" id="quitBtn">End</button>
      </div>
      <div class="card-stage" id="stage">${renderDrillBody(d)}</div>
      <div id="dFeedback"></div>
    </div>
  `

  root().querySelector('#quitBtn').addEventListener('click', () => { mode = 'lesson'; render() })
  wireDrill(d)
}

function renderDrillBody(d) {
  if (d.type === 'choice') {
    return `
      <div class="prompt">
        <div class="cloze-sentence de">${esc(d.question).replace(/___/g, '<b style="color:var(--accent)">___</b>')}</div>
      </div>
      <div class="mc-options">
        ${d.options.map((o, i) => `
          <button class="mc-opt" data-opt="${esc(o)}">
            <span class="mc-key">${i + 1}</span><span class="de">${esc(o)}</span>
          </button>`).join('')}
      </div>`
  }

  if (d.type === 'order') {
    return `
      <div class="prompt">
        <div class="prompt-sub">Put these in the right order</div>
        <div id="orderTarget" class="cloze-sentence de"
             style="min-height:2.4rem;border-bottom:2px dashed var(--border2);padding-bottom:.4rem"></div>
      </div>
      <div class="chips" id="orderPool" style="justify-content:center;margin-top:1rem">
        ${shuffle(d.words).map((w) => `<button class="chip de" data-w="${esc(w)}"
            style="font-size:1rem;padding:.35rem .8rem">${esc(w)}</button>`).join('')}
      </div>
      <button class="btn" id="orderCheck" style="margin-top:1rem">Check</button>
      <button class="btn ghost sm" id="orderClear">Clear</button>`
  }

  // fill
  return `
    <div class="prompt">
      <div class="cloze-sentence de">${esc(d.question).replace(/___/g,
        '<input class="cloze-input" id="fillIn" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">')}</div>
      ${!d.question.includes('___') ? '<input class="type-input" id="fillIn" style="margin-top:1rem">' : ''}
    </div>
    <div class="hint-line"><kbd>Enter</kbd> to check</div>`
}

function wireDrill(d) {
  const el = root()

  if (d.type === 'choice') {
    el.querySelectorAll('.mc-opt').forEach((b) =>
      b.addEventListener('click', () => gradeDrill(d, b.dataset.opt)))
    return
  }

  if (d.type === 'order') {
    const target = el.querySelector('#orderTarget')
    const chosen = []
    el.querySelectorAll('#orderPool .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (chip.disabled) return
        chip.disabled = true
        chip.style.opacity = '.35'
        chosen.push(chip.dataset.w)
        target.textContent = chosen.join(' ')
      })
    })
    el.querySelector('#orderClear').addEventListener('click', () => {
      chosen.length = 0
      target.textContent = ''
      el.querySelectorAll('#orderPool .chip').forEach((c) => { c.disabled = false; c.style.opacity = '' })
    })
    el.querySelector('#orderCheck').addEventListener('click', () => gradeDrill(d, chosen.join(' ')))
    return
  }

  const input = el.querySelector('#fillIn')
  if (input) {
    setTimeout(() => input.focus(), 30)
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); gradeDrill(d, input.value) }
    })
  }
}

function gradeDrill(d, given) {
  if (answered) return
  answered = true

  const accepted = [d.answer, ...(d.accept || [])].map((a) => normalize(a))
  const correct = accepted.includes(normalize(given))

  dScore.total++
  if (correct) dScore.correct++

  const el = root()
  if (d.type === 'choice') {
    el.querySelectorAll('.mc-opt').forEach((b) => {
      b.disabled = true
      if (b.dataset.opt === d.answer) b.classList.add('correct')
      else if (b.dataset.opt === given && !correct) b.classList.add('wrong')
    })
  } else {
    const input = el.querySelector('#fillIn')
    if (input) { input.disabled = true; input.classList.add(correct ? 'correct' : 'wrong') }
    const target = el.querySelector('#orderTarget')
    if (target) target.style.borderColor = correct ? 'var(--green)' : 'var(--red)'
  }

  // Say the correct sentence — hearing the right shape is the reinforcement.
  const spoken = d.type === 'order' ? d.answer : String(d.question || '').replace('___', d.answer)
  if (spoken && !spoken.includes('___')) speak(spoken)

  el.querySelector('#dFeedback').innerHTML = `
    <div class="verdict ${correct ? 'ok' : 'no'}">
      <div class="verdict-icon">${correct ? '✓' : '✗'}</div>
      ${!correct ? `<div class="verdict-correct de">${esc(d.answer)}</div>` : ''}
      <div class="verdict-text">${esc(d.explain || '')}</div>
    </div>
    <div style="text-align:center;margin-top:.8rem">
      <button class="btn primary" id="nextDrill">${dIndex + 1 >= drills.length ? 'Finish' : 'Next'} →</button>
    </div>
  `
  el.querySelector('#nextDrill').addEventListener('click', () => { dIndex++; render() })
}

function renderDrillDone() {
  const pct = dScore.total ? Math.round((dScore.correct / dScore.total) * 100) : 0
  const p = progressFor(lesson.id)
  state.progress.grammar[lesson.id] = {
    ...p,
    seen: true,
    lastSeen: Date.now(),
    drills: {
      correct: (p.drills.correct || 0) + dScore.correct,
      total: (p.drills.total || 0) + dScore.total,
    },
  }
  save()

  root().innerHTML = `
    <div class="done">
      <div class="done-icon">${pct >= 85 ? '🎉' : pct >= 60 ? '👏' : '📚'}</div>
      <h2>${esc(lesson.title)}</h2>
      <div class="done-stats">
        <div class="done-stat">
          <span class="done-stat-num">${dScore.correct}/${dScore.total}</span>
          <span class="done-stat-label">correct</span>
        </div>
        <div class="done-stat">
          <span class="done-stat-num">${pct}%</span>
          <span class="done-stat-label">score</span>
        </div>
      </div>
      <p style="color:var(--text3);max-width:400px">
        ${pct >= 85 ? 'You have this one. Move on to the next lesson.'
          : pct >= 60 ? 'Nearly there — read the rule once more and run it again.'
          : 'Worth re-reading the lesson before trying again. That is normal for this topic.'}
      </p>
      <div class="done-actions">
        <button class="btn primary big" id="retryBtn">Try again</button>
        <button class="btn big" id="readBtn">Re-read the lesson</button>
        <button class="btn big" id="allBtn">All lessons</button>
      </div>
    </div>
  `
  const el = root()
  el.querySelector('#retryBtn').addEventListener('click', startDrills)
  el.querySelector('#readBtn').addEventListener('click', () => { mode = 'lesson'; render() })
  el.querySelector('#allBtn').addEventListener('click', () => { mode = 'list'; render() })
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

function render() {
  if (mode === 'lesson') renderLesson()
  else if (mode === 'drill') renderDrill()
  else renderList()
}

export function handleKey(e) {
  if (mode !== 'drill' || answered) return false
  const d = drills[dIndex]
  if (d?.type === 'choice') {
    const n = Number(e.key)
    if (n >= 1 && n <= d.options.length) { e.preventDefault(); gradeDrill(d, d.options[n - 1]); return true }
  }
  return false
}

/**
 * True while a drill question is on screen. main.js checks this before letting
 * the digit keys navigate between sections — otherwise pressing "3" to answer
 * a fill-in drill would yank you to the Grammar tab and throw the score away.
 */
export const usingDigits = () => mode === 'drill'
