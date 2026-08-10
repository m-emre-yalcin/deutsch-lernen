/**
 * Drills — free practice, no scheduling consequences.
 *
 * The daily session is governed by FSRS and deliberately limited. This is the
 * escape hatch: pick a mode and a topic and grind as long as you like. Answers
 * still count towards your stats, but they don't reschedule your cards — so an
 * hour of extra practice can't wreck tomorrow's review load.
 */

import { esc } from '../lib/ui.js'
import { icon } from '../lib/icons.js'
import { state, deckLevels as levels } from '../store.js'
import { eligibleWords } from '../session.js'
import * as study from './study.js'

import * as flashcard from '../modes/flashcard.js'
import * as mc from '../modes/mc.js'
import * as typing from '../modes/typing.js'
import * as gender from '../modes/gender.js'
import * as listening from '../modes/listening.js'
import * as cloze from '../modes/cloze.js'
import * as conjugation from '../modes/conjugation.js'

const MODES = [flashcard, mc, typing, gender, listening, cloze, conjugation]

let picked = { mode: null, category: null, level: null, limit: 25 }

const root = () => document.getElementById('view-drills')

export function open() { render() }

function countFor(modeId, category, level) {
  let words = eligibleWords()
  if (category) words = words.filter((w) => w.category === category)
  if (level) words = words.filter((w) => w.level === level)
  if (modeId === 'gender') words = words.filter((w) => w.partOfSpeech === 'noun' && w.article)
  if (modeId === 'conjugation') words = words.filter((w) => w.partOfSpeech === 'verb' && w.forms?.du)
  if (modeId === 'cloze') words = words.filter((w) => w.cloze?.[0]?.de)
  return words.length
}

function render() {
  const cats = [...new Set(state.words.map((w) => w.category))].sort()

  root().innerHTML = `
    <div class="view-pad">
      <div class="view-head">
        <div>
          <h1>Free practice</h1>
          <div class="sub">Practise anything, as much as you like — this never changes your review schedule.</div>
        </div>
      </div>

      <div class="section-title">Pick a mode</div>
      <div class="drill-grid">
        ${MODES.map((m) => `
          <button class="drill-card" data-mode="${m.meta.id}">
            <div class="drill-icon">${icon(m.meta.icon)}</div>
            <div class="drill-name">${esc(m.meta.name)}</div>
            <div class="drill-desc">${esc(m.meta.desc)}</div>
            <div class="drill-desc" style="margin-top:var(--s2)">
              ${countFor(m.meta.id, picked.category, picked.level)} words available
            </div>
          </button>`).join('')}
      </div>

      <div class="section-title">Narrow it down (optional)</div>
      <div style="display:flex;gap:var(--s3);flex-wrap:wrap;align-items:center">
        <label class="field">
          <span>Category</span>
          <select class="ctrl" id="dCat">
            <option value="">Everything</option>
            ${cats.map((c) => `<option value="${esc(c)}" ${picked.category === c ? 'selected' : ''}>${esc(c)} (${
              state.words.filter((w) => w.category === c).length})</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Level</span>
          <select class="ctrl" id="dLevel">
            <option value="">All</option>
            ${levels().map((l) => `<option value="${l}" ${picked.level === l ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>How many cards</span>
          <select class="ctrl" id="dLimit">
            ${[10, 25, 50, 100, 250].map((n) => `<option value="${n}" ${picked.limit === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="section-title">Or target a weak spot</div>
      <div class="drill-grid">
        <button class="drill-card" id="weakBtn">
          <div class="drill-icon">${icon('bandage')}</div>
          <div class="drill-name">Trouble words</div>
          <div class="drill-desc">The words you keep forgetting, worst first.</div>
        </button>
        <button class="drill-card" id="genderWeakBtn">
          <div class="drill-icon">${icon('palette')}</div>
          <div class="drill-name">Shaky genders</div>
          <div class="drill-desc">Nouns whose der/die/das you've got wrong before.</div>
        </button>
        <button class="drill-card" id="verbWeakBtn">
          <div class="drill-icon">${icon('shuffle')}</div>
          <div class="drill-name">Shaky conjugations</div>
          <div class="drill-desc">Verbs whose forms you've got wrong before.</div>
        </button>
        <button class="drill-card" id="newestBtn">
          <div class="drill-icon">${icon('sprout')}</div>
          <div class="drill-name">Today's new words</div>
          <div class="drill-desc">Everything you met for the first time today.</div>
        </button>
      </div>
    </div>
  `

  const el = root()
  el.querySelector('#dCat').addEventListener('change', (e) => { picked.category = e.target.value || null; render() })
  el.querySelector('#dLevel').addEventListener('change', (e) => { picked.level = e.target.value || null; render() })
  el.querySelector('#dLimit').addEventListener('change', (e) => { picked.limit = Number(e.target.value) })

  el.querySelectorAll('[data-mode]').forEach((b) => {
    b.addEventListener('click', () => startDrill(b.dataset.mode))
  })

  el.querySelector('#weakBtn').addEventListener('click', () => startSpecial('weak'))
  el.querySelector('#genderWeakBtn').addEventListener('click', () => startSpecial('genderWeak'))
  el.querySelector('#verbWeakBtn').addEventListener('click', () => startSpecial('verbWeak'))
  el.querySelector('#newestBtn').addEventListener('click', () => startSpecial('newToday'))
}

export function startDrill(modeId) {
  const count = countFor(modeId, picked.category, picked.level)
  if (count === 0) {
    root().insertAdjacentHTML('afterbegin',
      `<div class="toast err" style="position:static;margin:1rem auto;width:fit-content">
        No words match those filters for this mode.</div>`)
    return
  }
  import('../main.js').then(({ navigate }) => {
    navigate('study')
    study.open({
      mode: modeId,
      category: picked.category,
      level: picked.level,
      limit: picked.limit,
      ignoreSchedule: true,
    })
  })
}

function startSpecial(kind) {
  let ids = []
  const now = Date.now()

  if (kind === 'weak') {
    ids = Object.entries(state.progress.cards)
      .filter(([, c]) => (c.lapses || 0) > 0)
      .sort((a, b) => (b[1].lapses - a[1].lapses) || (a[1].stability || 0) - (b[1].stability || 0))
      .slice(0, picked.limit)
      .map(([id]) => id)
  } else if (kind === 'genderWeak') {
    ids = Object.entries(state.progress.gender || {})
      .filter(([, g]) => (g.wrong || 0) > 0)
      .sort((a, b) => (b[1].wrong - a[1].wrong))
      .slice(0, picked.limit)
      .map(([id]) => id)
  } else if (kind === 'verbWeak') {
    ids = Object.entries(state.progress.verbs || {})
      .filter(([, v]) => (v.wrong || 0) > 0)
      .sort((a, b) => (b[1].wrong - a[1].wrong))
      .slice(0, picked.limit)
      .map(([id]) => id)
  } else {
    const cutoff = now - 24 * 3600 * 1000
    ids = Object.entries(state.progress.cards)
      .filter(([, c]) => c.reps === 1 && (c.lastReview || 0) > cutoff)
      .slice(0, picked.limit)
      .map(([id]) => id)
  }

  if (!ids.length) {
    root().insertAdjacentHTML('afterbegin',
      `<div class="toast" style="position:static;margin:1rem auto;width:fit-content">
        ${kind === 'weak' ? "You haven't forgotten anything yet — nothing to fix."
          : kind === 'genderWeak' ? 'No gender mistakes on record yet.'
          : kind === 'verbWeak' ? 'No conjugation mistakes on record yet.'
          : 'No new words today yet.'}</div>`)
    return
  }

  import('../main.js').then(({ navigate }) => {
    navigate('study')
    study.open({
      ids,
      mode: kind === 'genderWeak' ? 'gender' : kind === 'verbWeak' ? 'conjugation' : null,
      limit: picked.limit,
      ignoreSchedule: true,
    })
  })
}
