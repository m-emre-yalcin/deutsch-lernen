/**
 * Progress — what you actually know, and what's coming.
 *
 * Deliberately not a vanity dashboard. The two most useful things here are the
 * forecast (so tomorrow's load is never a surprise) and the trouble list (the
 * words that need a different approach, not more repetitions).
 */

import { esc, plural } from '../lib/ui.js'
import { icon } from '../lib/icons.js'
import { state, weakWords, exportWeakCsv } from '../store.js'
import { dueCounts } from '../session.js'
import { showDetail } from './browse.js'

const DAY = 86400000
const root = () => document.getElementById('view-stats')

export function open() { render() }

/** Buckets by memory strength — the honest picture of where the deck stands. */
function buckets() {
  const b = { untouched: 0, learning: 0, young: 0, mature: 0, leech: 0 }
  for (const w of state.words) {
    const c = state.progress.cards[w.id]
    if (!c || !c.reps) { b.untouched++; continue }
    if ((c.lapses || 0) >= 5) { b.leech++; continue }
    if (c.state === 'learning' || c.state === 'relearning') { b.learning++; continue }
    if ((c.stability || 0) >= 21) b.mature++
    else b.young++
  }
  return b
}

function render() {
  const b = buckets()
  const counts = dueCounts()
  const st = state.progress.stats || {}
  const total = state.words.length
  const studied = total - b.untouched
  const masteryPct = total ? Math.round((b.mature / total) * 100) : 0

  const today = state.progress.daily[new Date().toLocaleDateString('sv')] || {}
  const accuracy = today.reviews ? Math.round((today.correct / today.reviews) * 100) : null

  root().innerHTML = `
    <div class="view-pad">
      <div class="view-head">
        <div>
          <h1>Progress</h1>
          <div class="sub">${studied} of ${total} words started · ${b.mature} in long-term memory</div>
        </div>
        <div style="display:flex;gap:.4rem">
          <button class="btn sm" id="csvBtn">Export weak words</button>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-num">${counts.due + counts.learning}</div>
          <div class="stat-label">due right now</div></div>
        <div class="stat-card"><div class="stat-num">${b.mature}</div>
          <div class="stat-label">known well</div></div>
        <div class="stat-card"><div class="stat-num">${st.streak || 0}</div>
          <div class="stat-label">${icon('flame')} day streak</div></div>
      </div>

      <div class="section-title">Overall mastery</div>
      <div class="panel">
        <div class="bar-track" style="height:10px">
          <div class="bar-fill" style="width:${masteryPct}%"></div>
        </div>
        <p class="muted" style="margin-top:var(--s3)">
          ${masteryPct}% of the deck is in long-term memory. ${b.young} more ${
            b.young === 1 ? 'word is' : 'words are'} still settling, and ${b.untouched} haven't
          been started.${accuracy !== null
            ? ` You're at <b${accuracy < 70 ? ' style="color:var(--red)"' : ''}>${accuracy}%</b> today across ${plural(today.reviews, 'answer')}.`
            : ''}
        </p>
      </div>

      <div class="section-title">Study history</div>
      <div class="panel">${renderHeatmap()}</div>

      <div class="section-title">Coming up</div>
      <div class="panel">${renderForecast()}</div>

      <div class="section-title">Words giving you trouble</div>
      <div class="panel">${renderWeak()}</div>

      <details class="panel" style="margin-top:var(--s6)">
        <summary>Grammar &amp; drills</summary>
        ${renderGrammarAndDrills()}
      </details>

      <details class="panel">
        <summary>Breakdown by level and category</summary>
        <div class="answer-label" style="margin-top:var(--s3)">By level</div>
        ${renderByKey('level')}
        <div class="answer-label" style="margin-top:var(--s5)">By category</div>
        ${renderByKey('category')}
      </details>
    </div>
  `

  root().querySelector('#csvBtn').addEventListener('click', exportWeakCsv)
  root().querySelectorAll('[data-word]').forEach((r) =>
    r.addEventListener('click', () => showDetail(r.dataset.word)))
}

/** A year of study, one square per day. */
function renderHeatmap() {
  const daily = state.progress.daily || {}
  const values = Object.values(daily).map((d) => d.reviews || 0)
  const max = Math.max(20, ...values)

  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end.getTime() - 363 * DAY)
  // Start on a Monday so the weeks line up as columns.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))

  const cols = []
  let cursor = new Date(start)
  while (cursor <= end) {
    const col = []
    for (let d = 0; d < 7; d++) {
      const key = cursor.toLocaleDateString('sv')
      const n = daily[key]?.reviews || 0
      const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4))
      col.push(cursor > end ? '<div class="heat-cell" style="visibility:hidden"></div>'
        : `<div class="heat-cell" data-l="${level}" title="${key}: ${plural(n, 'review')}"></div>`)
      // setDate, not +86400000: on the two DST changeover days a fixed 24-hour
      // step lands on the same calendar date twice (or skips one), so a studied
      // day silently vanishes from the grid every year.
      cursor = new Date(cursor)
      cursor.setDate(cursor.getDate() + 1)
    }
    cols.push(`<div class="heat-col">${col.join('')}</div>`)
  }

  const activeDays = Object.values(daily).filter((d) => d.reviews > 0).length
  return `
    <div class="heatmap">${cols.join('')}</div>
    <div style="display:flex;justify-content:space-between;margin-top:.5rem;font-size:.76rem;color:var(--text3)">
      <span>${plural(activeDays, 'day')} studied · longest streak ${state.progress.stats?.longestStreak || 0}</span>
      <span style="display:flex;align-items:center;gap:3px">less
        ${[0, 1, 2, 3, 4].map((l) => `<span class="heat-cell" data-l="${l}"></span>`).join('')} more</span>
    </div>
  `
}

/**
 * How many cards come due over the coming week.
 *
 * Fourteen bars, half of them labelled "+9d" and "+13d", was a fortnight of
 * numbers to answer a question you ask about tomorrow. Seven is the horizon
 * anyone actually plans against.
 */
const FORECAST_DAYS = 7

function renderForecast() {
  const days = Array.from({ length: FORECAST_DAYS }, () => 0)
  let overdue = 0

  // Bucket by CALENDAR day, not by rolling 24-hour windows. The labels say
  // "today" and "tomorrow", so a card due at 23:00 tonight belongs in today's
  // bar — with a rolling window at 09:00 it landed in "tomorrow" instead.
  const midnights = []
  const m = new Date()
  m.setHours(0, 0, 0, 0)
  for (let i = 0; i <= FORECAST_DAYS; i++) {
    midnights.push(m.getTime())
    m.setDate(m.getDate() + 1)
  }

  for (const w of state.words) {
    const c = state.progress.cards[w.id]
    if (!c?.due || !c.reps) continue
    if (c.due < midnights[0]) { overdue++; continue }
    for (let i = 0; i < FORECAST_DAYS; i++) {
      if (c.due < midnights[i + 1]) { days[i]++; break }
    }
  }

  const max = Math.max(1, ...days, overdue)
  const labels = ['today', 'tomorrow', ...Array.from({ length: FORECAST_DAYS - 2 }, (_, i) => `+${i + 2}d`)]

  return `
    ${overdue > 0 ? `<div class="row-bar">
      <span class="row-bar-name" style="color:var(--red)">overdue</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(overdue / max) * 100}%;background:var(--red)"></div></div>
      <span class="row-bar-val">${overdue}</span></div>` : ''}
    ${days.map((n, i) => `
      <div class="row-bar">
        <span class="row-bar-name">${labels[i]}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(n / max) * 100}%"></div></div>
        <span class="row-bar-val">${n || '—'}</span>
      </div>`).join('')}
    <p style="font-size:.78rem;color:var(--text3);margin-top:.6rem">
      This is your real workload. If a day looks heavy, lower the new-cards-per-day setting —
      today's new words become next week's reviews.</p>
  `
}

/**
 * Grammar lessons and the two quick tracks.
 *
 * All three are recorded but were invisible until now — which meant the
 * grammar course felt like it didn't count, and there was no way to see that
 * der/die/das was actually improving.
 */
function renderGrammarAndDrills() {
  const lessons = state.grammar || []
  const gp = state.progress.grammar || {}
  const read = lessons.filter((l) => gp[l.id]?.seen).length
  const drilled = Object.values(gp).reduce((s, g) => s + (g.drills?.total || 0), 0)
  const drillRight = Object.values(gp).reduce((s, g) => s + (g.drills?.correct || 0), 0)
  const drillPct = drilled ? Math.round((drillRight / drilled) * 100) : null

  // Gender track
  const nouns = state.words.filter((w) => w.partOfSpeech === 'noun' && w.article)
  const gender = Object.values(state.progress.gender || {})
  const genderSolid = gender.filter((g) => (g.streak || 0) >= 4).length
  const genderTried = gender.filter((g) => g.lastReview).length

  // Conjugation track
  const verbs = state.words.filter((w) => w.partOfSpeech === 'verb' && w.forms?.du)
  const vt = Object.values(state.progress.verbs || {})
  const verbSolid = vt.filter((v) => (v.streak || 0) >= 4).length
  const verbTried = vt.filter((v) => v.lastReview).length

  const bar = (name, done, total, extra = '') => `
    <div class="row-bar">
      <span class="row-bar-name">${esc(name)}</span>
      <div class="bar-track">
        <div class="bar-fill green" style="width:${total ? (done / total) * 100 : 0}%"></div>
      </div>
      <span class="row-bar-val">${done}/${total}${extra}</span>
    </div>`

  return `
    ${bar('Grammar lessons read', read, lessons.length)}
    ${bar('Genders solid', genderSolid, nouns.length)}
    ${bar('Conjugations solid', verbSolid, verbs.length)}
    <p style="font-size:.8rem;color:var(--text3);margin-top:.7rem">
      ${drilled
        ? `${drilled} grammar exercises answered, ${drillPct}% correct.`
        : 'No grammar exercises done yet — each lesson has eight.'}
      ${genderTried ? ` · ${genderTried} nouns tried in the der/die/das drill.` : ''}
      ${verbTried ? ` · ${verbTried} verbs tried in the conjugation drill.` : ''}
    </p>
    ${weakestLessons(lessons, gp)}
  `
}

/** The three lessons you're scoring worst on — the ones worth re-reading. */
function weakestLessons(lessons, gp) {
  const scored = lessons
    .map((l) => ({ l, p: gp[l.id] }))
    .filter(({ p }) => (p?.drills?.total || 0) >= 4)
    .map(({ l, p }) => ({ l, pct: Math.round((p.drills.correct / p.drills.total) * 100) }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3)
    .filter((x) => x.pct < 85)

  if (!scored.length) return ''
  return `
    <div style="margin-top:.8rem;padding-top:.7rem;border-top:1px solid var(--border)">
      <div class="answer-label">Worth re-reading</div>
      ${scored.map(({ l, pct }) => `
        <div class="row-bar">
          <span class="row-bar-name">${esc(l.title)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${
            pct < 60 ? 'var(--red)' : 'var(--amber)'}"></div></div>
          <span class="row-bar-val">${pct}%</span>
        </div>`).join('')}
    </div>`
}

function renderByKey(key) {
  const groups = {}
  for (const w of state.words) {
    const g = (groups[w[key]] ||= { total: 0, known: 0, started: 0 })
    g.total++
    const c = state.progress.cards[w.id]
    if (c?.reps) g.started++
    if ((c?.stability || 0) >= 21) g.known++
  }

  return Object.entries(groups)
    .sort((a, b) => key === 'level' ? a[0].localeCompare(b[0]) : b[1].total - a[1].total)
    .map(([name, g]) => `
      <div class="row-bar">
        <span class="row-bar-name">${esc(name)}</span>
        <div class="bar-track">
          <div class="bar-fill green" style="width:${(g.known / g.total) * 100}%"></div>
        </div>
        <span class="row-bar-val">${g.known}/${g.total}</span>
      </div>`).join('')
}

function renderWeak() {
  const weak = weakWords(20)
  if (!weak.length) {
    return `<p style="color:var(--text3)">Nothing here yet — you haven't forgotten a word twice.
      This list fills up as you study, and it's the most useful page in the app when it does.</p>`
  }
  // The fifth column used to be the raw FSRS stability in days, under no header
  // at all. Nobody could tell what "3d" next to a word was measuring.
  return `
    <p class="muted" style="margin-bottom:var(--s3)">
      These keep slipping. More repetitions won't fix them — click one and read the note or
      the memory hook, or follow a lookup link to have it explained a different way.</p>
    <div class="word-table">
      ${weak.map(({ word, card }) => `
        <div class="wt-row" data-word="${esc(word.id)}"
             style="grid-template-columns:15px 1.3fr 1.3fr 110px">
          <span class="dot leech"></span>
          <span class="wt-word de">${esc(word.word)}</span>
          <span class="wt-trans">${esc(word.translation)}</span>
          <span class="wt-strength">forgotten ${plural(card.lapses, 'time')}</span>
        </div>`).join('')}
    </div>
  `
}
