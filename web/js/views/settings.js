/**
 * Settings — study pace, voice, modes, and your data.
 */

import { esc, toast, plural } from '../lib/ui.js'
import {
  state, updateSettings, exportProgress, importProgress, resetProgress, saveNow, DEFAULT_SETTINGS,
} from '../store.js'
import { germanVoices, speak } from '../lib/tts.js'
import { MODE_IMPL } from './study.js'

const root = () => document.getElementById('view-settings')

export function open() { render() }

function render() {
  const s = state.settings
  const voices = germanVoices()
  const cats = [...new Set(state.words.map((w) => w.category))].sort()

  root().innerHTML = `
    <div class="view-pad">
      <div class="view-head">
        <div>
          <h1>Settings</h1>
          <div class="sub">${state.words.length} words · ${state.grammar.length} grammar lessons ·
            saved to <code>data/progress.json</code></div>
        </div>
      </div>

      <div class="section-title">Daily pace</div>
      <div class="panel">
        <label class="field" style="margin-bottom:1rem">
          <span>New words per day — <b id="npdVal">${s.newPerDay}</b></span>
          <input type="range" id="npd" min="0" max="60" step="5" value="${s.newPerDay}">
          <span class="muted">Every new word today becomes several reviews over the coming weeks.
            15–20 is sustainable; 40 feels great for three days and then buries you.</span>
        </label>

        <label class="field" style="margin-bottom:1rem">
          <span>Maximum reviews per session — <b id="mrVal">${s.maxReviews}</b></span>
          <input type="range" id="mr" min="20" max="400" step="20" value="${s.maxReviews}">
        </label>

        <label class="field">
          <span>Target retention — <b id="trVal">${Math.round(s.targetRetention * 100)}%</b></span>
          <input type="range" id="tr" min="0.75" max="0.97" step="0.01" value="${s.targetRetention}">
          <span class="muted">How much you want to remember. Higher means more frequent reviews.
            90% is the sweet spot — chasing 97% roughly doubles your workload for very little gain.</span>
        </label>
      </div>

      <div class="section-title">Practice modes</div>
      <div class="panel">
        <p class="muted" style="margin-bottom:.7rem">
          Modes get harder as a word gets stronger: recognise it → recall it → type it →
          understand it by ear → use it in a sentence. Switching one off drops that rung.</p>
        ${Object.values(MODE_IMPL).map((m) => `
          <label class="field inline" style="padding:.3rem 0">
            <input type="checkbox" data-mode="${m.meta.id}" ${s.modes[m.meta.id] !== false ? 'checked' : ''}>
            <span><b>${m.meta.icon} ${esc(m.meta.name)}</b> — ${esc(m.meta.desc)}</span>
          </label>`).join('')}

        <label class="field" style="margin-top:1rem">
          <span>Gender drills mixed into each session — <b id="gdVal">${Math.round(s.genderDrillRatio * 100)}%</b></span>
          <input type="range" id="gd" min="0" max="0.5" step="0.05" value="${s.genderDrillRatio}">
          <span class="muted">Quick der/die/das cards, about two seconds each.</span>
        </label>

        <label class="field" style="margin-top:1rem">
          <span>Conjugation drills mixed in — <b id="vdVal">${Math.round((s.verbDrillRatio ?? 0.15) * 100)}%</b></span>
          <input type="range" id="vd" min="0" max="0.5" step="0.05" value="${s.verbDrillRatio ?? 0.15}">
          <span class="muted">Quick "du + fahren → ?" cards. Keeps the stem changes and haben/sein warm.</span>
        </label>

        <label class="field inline" style="margin-top:.8rem">
          <input type="checkbox" id="strict" ${s.typingStrict ? 'checked' : ''}>
          <span>Strict typing — require real umlauts (reject <code>ue</code> for <code>ü</code>)</span>
        </label>
      </div>

      <div class="section-title">Sound</div>
      <div class="panel">
        ${voices.length ? `
          <label class="field" style="margin-bottom:.9rem">
            <span>German voice</span>
            <select class="ctrl" id="voice">
              ${voices.map((v) => `<option value="${esc(v.name)}" ${s.voice === v.name ? 'selected' : ''}>
                ${esc(v.name)} (${esc(v.lang)})${v.localService ? ' — offline' : ''}</option>`).join('')}
            </select>
            <span class="muted">${plural(voices.length, 'German voice')} installed on this Mac.</span>
          </label>
          <button class="btn sm" id="testVoice">🔊 Test it</button>
        ` : `
          <p class="muted">No German voice installed. The app will use the server's speech instead,
            which needs internet the first time it says each word.<br><br>
            To add real offline voices: <b>System Settings → Accessibility → Spoken Content →
            System Voice → Manage Voices</b>, then download a German one.</p>
        `}

        <label class="field" style="margin-top:1rem">
          <span>Speaking speed — <b id="srVal">${s.speechRate.toFixed(2)}×</b></span>
          <input type="range" id="sr" min="0.5" max="1.3" step="0.05" value="${s.speechRate}">
        </label>

        <label class="field inline" style="margin-top:.7rem">
          <input type="checkbox" id="autoplay" ${s.autoPlayAudio ? 'checked' : ''}>
          <span>Say each word automatically when the card appears</span>
        </label>
      </div>

      <div class="section-title">Appearance & content</div>
      <div class="panel">
        <label class="field" style="margin-bottom:.9rem">
          <span>Theme</span>
          <select class="ctrl" id="theme">
            ${['auto', 'light', 'dark'].map((t) =>
              `<option value="${t}" ${s.theme === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>

        <label class="field" style="margin-bottom:.9rem">
          <span>Card direction</span>
          <select class="ctrl" id="dir">
            <option value="de-en" ${s.direction === 'de-en' ? 'selected' : ''}>German → English (easier)</option>
            <option value="en-de" ${s.direction === 'en-de' ? 'selected' : ''}>English → German (harder, better)</option>
            <option value="mixed" ${s.direction === 'mixed' ? 'selected' : ''}>Mixed</option>
          </select>
        </label>

        <label class="field inline">
          <input type="checkbox" id="images" ${s.showImages ? 'checked' : ''}>
          <span>Show pictures for concrete nouns (fetched once, then cached offline)</span>
        </label>
      </div>

      <div class="section-title">What to study</div>
      <div class="panel">
        <div class="field" style="margin-bottom:.9rem">
          <span>Levels</span>
          <div class="chips">
            ${['A0', 'A1', 'A2'].map((l) => `
              <button class="chip ${s.levels.includes(l) ? 'active' : ''}" data-level="${l}">${l}
                (${state.words.filter((w) => w.level === l).length})</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <span>Categories — none selected means everything</span>
          <div class="chips" style="max-height:190px;overflow-y:auto">
            ${cats.map((c) => `
              <button class="chip ${s.categories.includes(c) ? 'active' : ''}" data-cat="${esc(c)}">
                ${esc(c)}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="section-title">Your data</div>
      <div class="panel">
        <p class="muted" style="margin-bottom:.8rem">
          Progress is written to <code>data/progress.json</code> after every answer, with a snapshot
          in <code>data/backups/</code> once a day and every single review appended to
          <code>data/reviews.jsonl</code>. Your browser holds a copy too, so a stopped server
          never costs you a session.</p>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          <button class="btn" id="exportBtn">Export progress</button>
          <button class="btn" id="importBtn">Import progress</button>
          <input type="file" id="importFile" accept="application/json" hidden>
          <button class="btn" id="cacheBtn">Cache size</button>
          <button class="btn danger" id="resetBtn">Reset everything</button>
        </div>
        <div id="cacheInfo" class="muted" style="margin-top:.6rem"></div>
      </div>

      <div class="section-title">Adding your own words</div>
      <div class="panel">
        <p class="muted">
          Drop a new <code>.json</code> file into <code>data/vocab/</code> following the shape in
          <code>data/SCHEMA.md</code>, then run <code>node tools/validate.js</code> to check it and
          restart the app. Existing files can be edited freely — your progress is keyed by word
          <code>id</code>, so fixing a translation or adding an example never loses your history.</p>
      </div>
    </div>
  `

  wire()
}

function wire() {
  const el = root()
  const on = (sel, evt, fn) => el.querySelector(sel)?.addEventListener(evt, fn)

  const slider = (sel, key, label, fmt = (v) => v) => {
    const input = el.querySelector(sel)
    if (!input) return
    input.addEventListener('input', () => {
      const v = Number(input.value)
      el.querySelector(label).textContent = fmt(v)
      updateSettings({ [key]: v })
    })
  }

  slider('#npd', 'newPerDay', '#npdVal')
  slider('#mr', 'maxReviews', '#mrVal')
  slider('#tr', 'targetRetention', '#trVal', (v) => Math.round(v * 100) + '%')
  slider('#gd', 'genderDrillRatio', '#gdVal', (v) => Math.round(v * 100) + '%')
  slider('#vd', 'verbDrillRatio', '#vdVal', (v) => Math.round(v * 100) + '%')
  slider('#sr', 'speechRate', '#srVal', (v) => v.toFixed(2) + '×')

  el.querySelectorAll('[data-mode]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const modes = { ...state.settings.modes, [cb.dataset.mode]: cb.checked }
      // Leaving zero modes on would make the study view unable to show anything.
      if (!Object.values(modes).some(Boolean)) {
        cb.checked = true
        toast('At least one mode has to stay on', { error: true })
        return
      }
      updateSettings({ modes })
    })
  })

  on('#strict', 'change', (e) => updateSettings({ typingStrict: e.target.checked }))
  on('#autoplay', 'change', (e) => updateSettings({ autoPlayAudio: e.target.checked }))
  on('#images', 'change', (e) => updateSettings({ showImages: e.target.checked }))
  on('#voice', 'change', (e) => updateSettings({ voice: e.target.value }))
  on('#theme', 'change', (e) => updateSettings({ theme: e.target.value }))
  on('#dir', 'change', (e) => updateSettings({ direction: e.target.value }))
  on('#testVoice', 'click', () => speak('Guten Tag! Ich lerne Deutsch und ziehe bald nach Deutschland.'))

  el.querySelectorAll('[data-level]').forEach((b) => {
    b.addEventListener('click', () => {
      const l = b.dataset.level
      const levels = state.settings.levels.includes(l)
        ? state.settings.levels.filter((x) => x !== l)
        : [...state.settings.levels, l]
      if (!levels.length) { toast('Keep at least one level on', { error: true }); return }
      updateSettings({ levels })
      b.classList.toggle('active')
    })
  })

  el.querySelectorAll('[data-cat]').forEach((b) => {
    b.addEventListener('click', () => {
      const c = b.dataset.cat
      const categories = state.settings.categories.includes(c)
        ? state.settings.categories.filter((x) => x !== c)
        : [...state.settings.categories, c]
      updateSettings({ categories })
      b.classList.toggle('active')
    })
  })

  on('#exportBtn', 'click', () => { exportProgress(); toast('Progress exported') })
  on('#importBtn', 'click', () => el.querySelector('#importFile').click())
  on('#importFile', 'change', async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!confirm('Import will REPLACE all current progress. Continue?')) { e.target.value = ''; return }
    try {
      await importProgress(file)
      toast('Progress imported')
      render()
    } catch (err) {
      toast(err.message, { error: true, ms: 5000 })
    }
    e.target.value = ''
  })

  on('#cacheBtn', 'click', async () => {
    try {
      const s = await fetch('/api/cache-stats').then((r) => r.json())
      el.querySelector('#cacheInfo').textContent =
        `${s.audio.count} audio clips (${s.audio.mb} MB) · ${s.images.count} images (${s.images.mb} MB) cached for offline use.`
    } catch {
      el.querySelector('#cacheInfo').textContent = 'Could not reach the server.'
    }
  })

  on('#resetBtn', 'click', async () => {
    if (!confirm('This erases every review, streak and setting. Your word files are untouched.\n\nExport first if you might want it back. Continue?')) return
    if (!confirm('Really reset? This cannot be undone.')) return
    await resetProgress()
    toast('Everything reset')
    render()
  })
}
