#!/usr/bin/env node
/**
 * Warms the offline cache: TTS audio for every word, images for concrete nouns.
 *
 * Run it once and the app works on a plane, on the U-Bahn, or anywhere the wifi
 * is bad — which, on Deutsche Bahn, is everywhere.
 *
 *   node tools/prefetch.js                 # audio for all words
 *   node tools/prefetch.js --images        # + images for concrete nouns
 *   node tools/prefetch.js --sentences     # + the first example sentence of each word
 *   node tools/prefetch.js --limit 500     # just the 500 most useful
 *
 * Safe to re-run: anything already cached is skipped instantly.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VOCAB = join(ROOT, 'data', 'vocab')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}
const PORT = Number(arg('port', 5555))
const LIMIT = Number(arg('limit', 0))
const WANT_IMAGES = argv.includes('--images')
const WANT_SENTENCES = argv.includes('--sentences')
const BASE = `http://localhost:${PORT}`

const stripArticle = (s) => String(s || '').replace(/^(der|die|das)\s+/i, '').trim()

// ── wait for the server ──
async function waitForServer(seconds = 30) {
  for (let i = 0; i < seconds * 4; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

// ── load words ──
function loadWords() {
  if (!existsSync(VOCAB)) return []
  const words = []
  for (const f of readdirSync(VOCAB).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const data = JSON.parse(readFileSync(join(VOCAB, f), 'utf8'))
      words.push(...(data.words || []))
    } catch {}
  }
  const byId = new Map(words.filter((w) => w?.id).map((w) => [w.id, w]))
  return [...byId.values()].sort((a, b) => (a.frequency || 9999) - (b.frequency || 9999))
}

const bar = (done, total, label) => {
  const pct = total ? done / total : 0
  const filled = Math.round(pct * 28)
  process.stdout.write(
    `\r  ${label.padEnd(10)} [${'█'.repeat(filled)}${'░'.repeat(28 - filled)}] ` +
    `${String(done).padStart(5)}/${total}  ${Math.round(pct * 100)}%   `
  )
}

async function main() {
  console.log('\n  Warming the offline cache…\n')

  if (!(await waitForServer())) {
    console.error('  ✗ Server is not responding. Start it first with ./start.sh\n')
    process.exit(1)
  }

  let words = loadWords()
  if (!words.length) {
    console.error('  ✗ No words found in data/vocab/\n')
    process.exit(1)
  }
  if (LIMIT) words = words.slice(0, LIMIT)

  // ── audio ──
  let done = 0, failed = 0
  for (const w of words) {
    const text = w.partOfSpeech === 'noun' ? w.word : stripArticle(w.word)
    try {
      const r = await fetch(`${BASE}/api/audio?text=${encodeURIComponent(text)}&lang=de&speed=1`)
      if (!r.ok) failed++
      await r.arrayBuffer()
    } catch { failed++ }
    bar(++done, words.length, 'audio')
  }
  console.log(failed ? `\n  ⚠️  ${failed} clips failed (they'll fetch on demand later)` : '')

  // ── sentences ──
  if (WANT_SENTENCES) {
    const sentences = words.flatMap((w) => (w.example_sentences || []).slice(0, 1).map((e) => e.de)).filter(Boolean)
    done = 0; failed = 0
    for (const s of sentences) {
      try {
        const r = await fetch(`${BASE}/api/audio?text=${encodeURIComponent(s)}&lang=de&speed=1`)
        if (!r.ok) failed++
        await r.arrayBuffer()
      } catch { failed++ }
      bar(++done, sentences.length, 'sentences')
    }
    console.log('')
  }

  // ── images ──
  if (WANT_IMAGES) {
    const picturable = words.filter((w) => w.imageable && w.partOfSpeech === 'noun')
    done = 0; failed = 0
    for (const w of picturable) {
      const q = w.translations?.[0] || w.translation
      try {
        const r = await fetch(`${BASE}/api/image?id=${encodeURIComponent(w.id)}&q=${encodeURIComponent(q)}`)
        if (!r.ok) failed++
        await r.arrayBuffer()
      } catch { failed++ }
      bar(++done, picturable.length, 'images')
    }
    console.log(failed ? `\n  ⚠️  ${failed} images not found (those cards fall back to their emoji)` : '')
  }

  try {
    const s = await fetch(`${BASE}/api/cache-stats`).then((r) => r.json())
    console.log(`\n  ✓ Cached: ${s.audio.count} audio clips (${s.audio.mb} MB), ${s.images.count} images (${s.images.mb} MB)`)
    console.log('    The app now works with no internet connection.\n')
  } catch {
    console.log('\n  ✓ Done.\n')
  }
}

main().catch((e) => { console.error('\n  ✗', e.message, '\n'); process.exit(1) })
