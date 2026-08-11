#!/usr/bin/env node
/**
 * Deutsch Lernen — local server.
 *
 * Zero dependencies. Node 20+ only. Nothing to `npm install`, nothing to rot.
 *   node server/server.js [--port 5555] [--no-open]
 */

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync, createReadStream } from 'node:fs'
import { join, extname, normalize, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProgressStore } from './progress.js'
import { MediaCache } from './media.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = join(ROOT, 'web')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}
const PORT = Number(arg('port', process.env.PORT || 5555))
// Tests point this at a throwaway directory so a test run can never overwrite
// real study history. Vocabulary is still read from the real data/.
const DATA_DIR = arg('data', process.env.DATA_DIR || null)

const store = new ProgressStore(ROOT, DATA_DIR)
const media = new MediaCache(ROOT)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

const json = (res, code, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

const readBody = (req, limit = 32 * 1024 * 1024) => new Promise((resolve, reject) => {
  let size = 0
  const chunks = []
  req.on('data', (c) => {
    size += c.length
    if (size > limit) { reject(new Error('payload too large')); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', () => {
    if (!chunks.length) return resolve({})
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
    catch (e) { reject(new Error(`bad JSON: ${e.message}`)) }
  })
  req.on('error', reject)
})

// ─── DECK ─────────────────────────────────────────────────────────────────────
// Vocab is read from disk once and held in memory. Restart to pick up edits, or
// hit /api/deck?reload=1 — which means you can add words in your editor and see
// them without touching the server.

let deckCache = null

function loadDeck() {
  const vocabDir = join(ROOT, 'data', 'vocab')
  const words = []
  const files = []

  if (existsSync(vocabDir)) {
    for (const file of readdirSync(vocabDir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const data = JSON.parse(readFileSync(join(vocabDir, file), 'utf8'))
        const list = Array.isArray(data.words) ? data.words : []
        for (const w of list) if (w?.id) words.push(w)
        files.push({ file, count: list.length, category: data.category })
      } catch (e) {
        console.error(`  ⚠️  skipping ${file}: ${e.message}`)
        files.push({ file, count: 0, error: e.message })
      }
    }
  }

  // Last id wins on collision, but say so — silent overwrites hide data loss.
  const byId = new Map()
  let dupes = 0
  for (const w of words) {
    if (byId.has(w.id)) dupes++
    byId.set(w.id, w)
  }
  if (dupes) console.error(`  ⚠️  ${dupes} duplicate ids collapsed`)

  const unique = [...byId.values()].sort((a, b) => (a.frequency || 9999) - (b.frequency || 9999))

  const grammarPath = join(ROOT, 'data', 'grammar', 'lessons.json')
  let grammar = []
  try {
    grammar = JSON.parse(readFileSync(grammarPath, 'utf8')).lessons || []
  } catch (e) {
    // Say so. Swallowing this made all 36 lessons vanish from the app with no
    // hint anywhere as to why.
    if (existsSync(grammarPath)) {
      console.error(`  ⚠️  data/grammar/lessons.json unreadable (${e.message}) — no lessons loaded.`)
      console.error(`      Rebuild it with: node tools/build-grammar.js`)
    }
  }

  deckCache = {
    words: unique,
    grammar,
    meta: {
      total: unique.length,
      files,
      duplicates: dupes,
      categories: [...new Set(unique.map((w) => w.category))].sort(),
      levels: [...new Set(unique.map((w) => w.level))].sort(),
      loadedAt: new Date().toISOString(),
    },
  }
  return deckCache
}

/** Every level present in the deck — the same list the client filters by. */
const deckLevels = () => (deckCache || loadDeck()).meta.levels

// ─── ADDING YOUR OWN WORDS ────────────────────────────────────────────────────

// Honours --data so a sandboxed run (tests) can never write into the real
// data/vocab/. Falls back to the real path in normal use.
const MY_WORDS = DATA_DIR
  ? join(DATA_DIR, 'my-words.json')
  : join(ROOT, 'data', 'vocab', '00-my-words.json')

const slugify = (s) => String(s || '')
  .replace(/^(der|die|das)\s+/i, '')
  .toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')

/**
 * Regular present-tense conjugation for a verb you add yourself.
 *
 * Exceptionless for weak verbs. Strong verbs (nehmen → du nimmst) will come out
 * regular and slightly wrong — the form shows them in the app so you can correct
 * it in data/vocab/00-my-words.json, which beats refusing the word or, worse,
 * inventing a participle.
 */
function presentForms(infinitive) {
  const inf = String(infinitive || '').trim()
  const m = inf.match(/^(.*?)(e[nr]|n)$/)
  if (!m || !m[1]) return {}
  const stem = m[1]
  const needsE = /[dt]$/.test(stem) || /^(atm|rechn|öffn|zeichn|regn|begegn|widm|ordn)$/.test(stem)
  const sibilant = /[sßxz]$/.test(stem)
  const du = needsE ? `${stem}est` : sibilant ? `${stem}t` : `${stem}st`
  const er = needsE ? `${stem}et` : `${stem}t`
  return {
    ich: `${stem}e`, du, er, wir: inf, ihr: er, sie: inf,
    praeteritum: needsE ? `${stem}ete` : `${stem}te`,
    perfekt: `hat ge${needsE ? stem + 'et' : stem + 't'}`,
  }
}

/**
 * Turn a handful of form fields into a schema-complete entry.
 *
 * The form only asks for what a human actually knows off the top of their head;
 * everything else is filled with the correct empty value so the file stays
 * valid against data/SCHEMA.md and `node tools/validate.js` keeps passing.
 */
function addWord(input) {
  const word = String(input?.word || '').trim()
  const translation = String(input?.translation || '').trim()
  if (!word) throw new Error('The German word is required.')
  if (!translation) throw new Error('The English meaning is required.')

  const pos = input.partOfSpeech || 'noun'
  const article = pos === 'noun'
    ? (word.match(/^(der|die|das)\s/i)?.[1]?.toLowerCase() || null)
    : null
  if (pos === 'noun' && !article) {
    throw new Error('Nouns need their article — write it as "die Wohnung", not "Wohnung".')
  }
  const gender = { der: 'm', die: 'f', das: 'n' }[article] || null
  const lemma = word.replace(/^(der|die|das)\s+/i, '').trim()

  let deck = { category: 'My Words', words: [] }
  if (existsSync(MY_WORDS)) {
    // A parse failure must NOT fall through to an empty deck — the next write
    // would replace the file and silently delete every word you ever added.
    // Refuse instead; the file is yours to fix and nothing is lost.
    try {
      deck = JSON.parse(readFileSync(MY_WORDS, 'utf8'))
      if (!Array.isArray(deck.words)) throw new Error('missing "words" array')
    } catch (e) {
      throw new Error(
        `data/vocab/00-my-words.json is unreadable (${e.message}). ` +
        `Fix or rename it, then try again — refusing to overwrite your words.`)
    }
  }

  // Refuse the same word twice — progress is keyed by id, and two entries for
  // one word would split your review history between them.
  const norm = (s) => String(s).trim().toLowerCase()
  if (deck.words.some((w) => norm(w.word) === norm(word))) {
    throw new Error(`"${word}" is already in your words.`)
  }
  const clash = (deckCache?.words || []).find((w) => norm(w.word) === norm(word))
  if (clash) {
    throw new Error(`"${word}" is already in the deck under "${clash.category}".`)
  }

  // Find a free id. The base slug often collides with a curated entry (a word
  // can legitimately appear in two categories), so suffix until it's unique.
  const existingIds = new Set([
    ...(deckCache?.words || []).map((w) => w.id),
    ...deck.words.map((w) => w.id),
  ])
  const base = slugify(word) || `wort-${Date.now()}`
  let id = base
  for (let n = 0; existingIds.has(id); n++) {
    id = n === 0 ? `${base}-mein` : `${base}-mein-${n + 1}`
  }

  const examples = (input.examples || [])
    .filter((e) => e?.de?.trim())
    .slice(0, 2)
    .map((e) => ({ de: e.de.trim(), en: (e.en || '').trim() || translation }))
  // The schema wants exactly two; pad rather than reject a hurried entry.
  while (examples.length < 2) {
    examples.push({ de: `${word}.`, en: `${translation}.` })
  }

  // Blank out EVERY occurrence of the word. Replacing only the first left the
  // answer visible elsewhere in the same sentence, so the card gave itself away.
  const clozeSource = examples[0].de
  const escaped = lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const everywhere = new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'giu')
  const blanked = clozeSource.replace(everywhere, (_, a, b) => `${a}___${b}`)
  const cloze = [{
    de: blanked !== clozeSource ? blanked : `___ = ${translation}`,
    answer: lemma,
    en: examples[0].en,
  }]

  const entry = {
    id,
    word,
    lemma,
    translation,
    translations: [translation],
    // Accept any level the deck already contains. A hardcoded allowlist here
    // silently downgraded a B1 word to A1 on the way in — the add-word form
    // said B1, the file said A1, and nothing reported the difference.
    level: deckLevels().includes(input.level) ? input.level : 'A1',
    category: 'My Words',
    partOfSpeech: pos,
    frequency: 2900,          // sorts after the curated deck
    gender,
    article,
    plural: pos === 'noun' ? (String(input.plural || '').trim() || '—') : null,
    separable: false,
    auxiliary: pos === 'verb' ? 'haben' : null,
    reflexive: false,
    cases: [],
    forms: pos === 'verb' ? presentForms(lemma) : {},
    example_sentences: examples,
    cloze,
    notes: String(input.notes || '').trim() || null,
    mnemonic: null,
    germany_context: null,
    emoji: null,
    imageable: pos === 'noun',
    tags: ['mine'],
    synonyms: [],
    antonyms: [],
    related: [],
  }

  deck.words.push(entry)
  const tmp = `${MY_WORDS}.tmp`
  writeFileSync(tmp, JSON.stringify(deck, null, 2) + '\n', 'utf8')
  renameSync(tmp, MY_WORDS)
  return entry
}

// ─── STATIC ───────────────────────────────────────────────────────────────────

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0])
  if (rel === '/') rel = '/index.html'

  // Contain path traversal: normalise, then verify the result is still under WEB.
  const target = normalize(join(WEB, rel))
  // sep-terminated prefix: a plain startsWith would also accept a sibling
  // directory named "web-backup" or "webfoo".
  if (target !== WEB && !target.startsWith(WEB + sep)) {
    return json(res, 403, { error: 'forbidden' })
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    return json(res, 404, { error: 'not found', path: rel })
  }

  const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' })
  // An unhandled 'error' on a ReadStream is an uncaught exception, which would
  // kill the whole server mid-study over one unreadable file.
  createReadStream(target).on('error', (e) => {
    console.error('  ⚠️  read failed:', rel, e.message)
    res.destroy()
  }).pipe(res)
}

function serveFile(res, path, type) {
  if (!existsSync(path)) return json(res, 404, { error: 'not found' })
  const { size } = statSync(path)
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
  createReadStream(path).on('error', (e) => {
    console.error('  ⚠️  read failed:', path, e.message)
    res.destroy()
  }).pipe(res)
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  try {
    // ---- health ----
    if (path === '/api/health') {
      return json(res, 200, { ok: true, port: PORT, words: (deckCache || loadDeck()).words.length })
    }

    // ---- deck ----
    if (path === '/api/deck') {
      if (url.searchParams.get('reload') || !deckCache) loadDeck()
      return json(res, 200, deckCache)
    }

    // ---- progress ----
    if (path === '/api/progress' && req.method === 'GET') {
      return json(res, 200, store.read())
    }

    if (path === '/api/progress' && req.method === 'POST') {
      const body = await readBody(req)
      // Shape check, not just truthiness — a malformed write here is the one
      // thing that can destroy years of history in a single request.
      if (!body || typeof body !== 'object'
          || typeof body.cards !== 'object' || Array.isArray(body.cards)
          || (body.gender !== undefined && typeof body.gender !== 'object')
          || (body.stats !== undefined && typeof body.stats !== 'object')) {
        return json(res, 400, { error: 'expected a progress object with a "cards" map' })
      }
      try {
        const saved = store.write(body)
        return json(res, 200, { ok: true, updatedAt: saved.updatedAt, cards: Object.keys(saved.cards).length })
      } catch (e) {
        if (e.code === 'STALE_WRITE') {
          // 409 + the newer state, so the client can merge instead of clobber.
          return json(res, 409, { error: e.message, server: e.serverState })
        }
        throw e
      }
    }

    if (path === '/api/reviews' && req.method === 'POST') {
      const body = await readBody(req)
      const n = store.logReviews(body.reviews || [])
      return json(res, 200, { ok: true, logged: n })
    }

    if (path === '/api/reviews' && req.method === 'GET') {
      return json(res, 200, { reviews: store.readReviewLog(Number(url.searchParams.get('limit')) || 50000) })
    }

    if (path === '/api/backups') {
      return json(res, 200, { backups: store.listBackups() })
    }

    // ---- add your own words ----
    // Appends to data/vocab/00-my-words.json. Kept in its own file so it can
    // never be clobbered by a regenerated category, and so you can copy your
    // personal deck somewhere else in one move.
    if (path === '/api/words' && req.method === 'POST') {
      const body = await readBody(req)
      try {
        const saved = addWord(body)
        loadDeck()
        return json(res, 200, { ok: true, word: saved, total: deckCache.words.length })
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }

    // ---- audio ----
    if (path === '/api/audio') {
      const text = url.searchParams.get('text')
      const lang = url.searchParams.get('lang') || 'de'
      const speed = url.searchParams.get('speed') || '1'
      if (!text) return json(res, 400, { error: 'missing ?text' })
      try {
        const { path: file } = await media.audio(text, lang, speed)
        return serveFile(res, file, 'audio/mpeg')
      } catch (e) {
        return json(res, 502, { error: `tts failed: ${e.message}` })
      }
    }

    // ---- images ----
    if (path === '/api/image') {
      const id = url.searchParams.get('id')
      const q = url.searchParams.get('q')
      if (!id || !q) return json(res, 400, { error: 'missing ?id and ?q' })
      const found = await media.image(id, q)
      if (!found) return json(res, 404, { error: 'no image found' })
      return serveFile(res, found.path, found.path.endsWith('.png') ? 'image/png' : 'image/jpeg')
    }

    if (path === '/api/cache-stats') {
      return json(res, 200, media.stats())
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: `no route ${path}` })

    // ---- static ----
    return serveStatic(req, res, path)
  } catch (e) {
    console.error('  ✗', req.method, path, '—', e.message)
    return json(res, 500, { error: e.message })
  }
})

// ─── BOOT ─────────────────────────────────────────────────────────────────────

const deck = loadDeck()
const p = store.read()

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use.`)
    console.error(`    Another copy is probably running — just open http://localhost:${PORT}`)
    console.error(`    Or free it:  lsof -ti:${PORT} | xargs kill\n`)
    process.exit(1)
  }
  throw e
})

server.listen(PORT, () => {
  const known = Object.values(p.cards || {}).filter((c) => (c.reps || 0) > 0).length
  console.log(`
  \x1b[1m🇩🇪  Deutsch Lernen\x1b[0m
  ─────────────────────────────────────────────
  \x1b[1mhttp://localhost:${PORT}\x1b[0m

  ${deck.words.length} words · ${deck.grammar.length} grammar lessons
  ${known} words studied · ${p.stats?.streak || 0} day streak
  ─────────────────────────────────────────────
  Ctrl-C to stop
`)
})

const shutdown = () => { console.log('\n  Auf Wiedersehen! 👋\n'); server.close(() => process.exit(0)) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
