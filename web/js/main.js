/**
 * Boot, routing, global keyboard.
 */

import { loadAll, state, subscribe, saveNow } from './store.js'
import { dueCounts } from './session.js'
import { $, toast } from './lib/ui.js'
import { speakWord, speakSlowly } from './lib/tts.js'

import * as studyView from './views/study.js'
import * as drillsView from './views/drills.js'
import * as grammarView from './views/grammar.js'
import * as browseView from './views/browse.js'
import * as statsView from './views/stats.js'
import * as settingsView from './views/settings.js'

const VIEWS = {
  study: studyView,
  drills: drillsView,
  grammar: grammarView,
  browse: browseView,
  stats: statsView,
  settings: settingsView,
}

let currentView = 'study'

// ─── THEME ────────────────────────────────────────────────────────────────────

export function applyTheme() {
  const t = state.settings?.theme || 'auto'
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)

// ─── ROUTING ──────────────────────────────────────────────────────────────────

export function navigate(name, opts) {
  if (!VIEWS[name]) return
  currentView = name

  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'))
  document.getElementById('view-' + name)?.classList.add('active')
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name))

  location.hash = name
  VIEWS[name].open?.(opts)
  refreshChrome()
}

// Any element with data-nav navigates — saves wiring every button by hand.
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]')
  if (nav) { navigate(nav.dataset.nav); return }
  if (e.target.closest('[data-close]')) {
    $('#drawer').hidden = true
    $('#shortcuts').hidden = true
  }
})

// ─── SIDEBAR CHROME ───────────────────────────────────────────────────────────

export function refreshChrome() {
  if (!state.loaded) return
  const counts = dueCounts()
  const pending = counts.due + counts.learning + counts.new
  $('#dueBadge').textContent = pending > 0 ? (pending > 999 ? '999+' : pending) : ''

  // Count only cards whose word is still IN the deck. Progress is keyed by id
  // and kept forever, so a renamed or removed word would otherwise keep
  // inflating "known" — and the bar could read 105 / 100.
  const known = state.words.reduce(
    (n, w) => n + ((state.progress.cards[w.id]?.stability || 0) >= 21 ? 1 : 0), 0)
  const total = state.words.length
  $('#masteryMini').style.width = total ? `${(known / total) * 100}%` : '0%'
  $('#masteryMiniText').textContent = `${known} / ${total}`
  $('#streakNum').textContent = state.progress.stats?.streak || 0

  const save = $('#saveState')
  save.textContent = state.online ? '✓ saved to disk' : '⚠ local only'
  save.className = 'save-state' + (state.online ? '' : ' offline')
}

// ─── KEYBOARD ─────────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return

  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)

  // Escape closes overlays before anything else gets a look in.
  if (e.key === 'Escape') {
    if (!$('#shortcuts').hidden) { $('#shortcuts').hidden = true; return }
    if (!$('#drawer').hidden) { $('#drawer').hidden = true; return }
  }

  // While an overlay is open, NOTHING falls through to the view underneath.
  // Previously pressing 1–4 with the help modal open would invisibly rate the
  // card behind it, and typing into the add-word drawer could trigger global
  // shortcuts like "/".
  if (!$('#shortcuts').hidden || !$('#drawer').hidden) return

  if (e.key === '?' && !typing) { e.preventDefault(); $('#shortcuts').hidden = false; return }

  // The active view gets priority — study owns the number keys mid-session,
  // and a grammar drill owns them mid-question.
  if (VIEWS[currentView].handleKey?.(e)) return

  if (typing) return

  switch (e.key) {
    case '\\':
      e.preventDefault()
      $('#app').classList.toggle('collapsed')
      break
    case '/':
      e.preventDefault()
      navigate('browse')
      setTimeout(() => $('#searchInput')?.focus(), 60)
      break
    case 'l': case 'L': {
      // The word you're LOOKING at wins: an open drawer beats a paused session.
      const w = browseView.activeWord?.() || studyView.activeWord()
      if (w) speakWord(w)
      break
    }
    case 's': case 'S': {
      const w = browseView.activeWord?.() || studyView.activeWord()
      if (w) speakSlowly(w.word)
      break
    }
    case 'd': case 'D':
      if (currentView !== 'study') { navigate('drills'); drillsView.startDrill?.('gender') }
      break
    default: {
      // 1-6 jump between sections — but never while a study session or a
      // grammar drill is using the digits for answers.
      const n = Number(e.key)
      if (n >= 1 && n <= 6 && currentView !== 'study' && !grammarView.usingDigits?.()) {
        navigate(Object.keys(VIEWS)[n - 1])
      }
    }
  }
})

// ─── BOOT ─────────────────────────────────────────────────────────────────────

async function boot() {
  const bootSub = $('#bootSub')
  try {
    await loadAll()
  } catch (e) {
    document.getElementById('boot').classList.add('error')
    bootSub.innerHTML = `Couldn't load the deck.<br><br>${e.message}<br><br>
      Make sure the server is running — start it with <code>./start.sh</code> from the
      study-german folder rather than opening index.html directly.`
    return
  }

  if (!state.words.length) {
    document.getElementById('boot').classList.add('error')
    bootSub.innerHTML = `No words found.<br><br>
      Add vocabulary files to <code>data/vocab/</code>, then run
      <code>node tools/validate.js</code> to check them.`
    return
  }

  applyTheme()

  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.addEventListener('click', () => navigate(b.dataset.view))
  })
  $('#sidebarToggle').addEventListener('click', () => $('#app').classList.toggle('collapsed'))

  subscribe((evt) => {
    if (evt === 'saved' || evt === 'loaded' || evt === 'settings') refreshChrome()
    if (evt === 'settings') applyTheme()
  })

  document.getElementById('boot').hidden = true
  document.getElementById('app').hidden = false

  const initial = location.hash.slice(1)
  navigate(VIEWS[initial] ? initial : 'study')

  // Anything unsaved goes up when you come back to the tab.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow()
  })

  console.log(
    `%c🇩🇪 Deutsch Lernen%c  ${state.words.length} words · ${state.grammar.length} grammar lessons`,
    'font-weight:bold;font-size:13px', 'color:#888'
  )
}

window.addEventListener('DOMContentLoaded', boot)
window.addEventListener('error', (e) => {
  console.error(e.error)
  toast(`Something broke: ${e.message}`, { error: true, ms: 5000 })
})
