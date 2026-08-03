#!/usr/bin/env node
/**
 * Validates every file in data/vocab/ against data/SCHEMA.md.
 *
 *   node tools/validate.js            # report
 *   node tools/validate.js --quiet    # only errors + summary
 *   node tools/validate.js --json     # machine-readable, for repair tooling
 *
 * Exit code 1 if any ERROR is found. Warnings never fail the build.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VOCAB = join(ROOT, 'data', 'vocab')

const LEVELS = new Set(['A0', 'A1', 'A2'])
const POS = new Set([
  'noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction',
  'pronoun', 'article', 'numeral', 'interjection', 'phrase',
])
const GENDER_ARTICLE = { m: 'der', f: 'die', n: 'das' }
const PERSONS = ['ich', 'du', 'er', 'wir', 'ihr', 'sie']

const REQUIRED_KEYS = [
  'id', 'word', 'lemma', 'translation', 'translations', 'level', 'category',
  'partOfSpeech', 'frequency', 'gender', 'article', 'plural', 'separable',
  'auxiliary', 'reflexive', 'cases', 'forms', 'example_sentences', 'cloze',
  'notes', 'mnemonic', 'germany_context', 'emoji', 'imageable', 'tags',
  'synonyms', 'antonyms', 'related',
]

const errors = []
const warnings = []
const seenIds = new Map()
const seenWords = new Map()

const err = (file, id, msg) => errors.push({ file, id, msg })
const warn = (file, id, msg) => warnings.push({ file, id, msg })

/** Strip a leading article so "die Häuser" and "Häuser" compare equal. */
const stripArticle = (s) => String(s || '').replace(/^(der|die|das)\s+/i, '').trim()

/** Loose containment check: does `sentence` contain `lemma` or an inflection of it? */
function containsLemma(sentence, lemma, opts = {}) {
  if (!sentence || !lemma) return true
  const s = sentence.toLowerCase()
  const l = stripArticle(lemma).toLowerCase()
  if (!l) return true

  // Short function words decline too heavily for a stem check to mean anything
  // (euer→eure, jener→jenes, der→dem), and multi-word entries split across the
  // sentence (um … zu). Checking them produces only false alarms.
  if (l.length < 5 || l.includes(' ')) return true
  // Strong verbs change their stem beyond recognition — haben→hat, werden→wird,
  // sein→ist, nehmen→nimmt, gehen→ging, vergessen→vergiss. There is no stem
  // heuristic that survives that, so verbs are checked by the linguistic review
  // pass rather than here.
  if (opts.pos === 'verb') return true

  if (s.includes(l)) return true
  // Separable verbs: "aufstehen" appears as "stehe ... auf"
  const sep = l.match(/^(auf|an|aus|ein|mit|ab|zu|vor|nach|um|über|unter|zurück|weg|hin|her|fern|teil|statt)(.+)$/)
  if (sep && s.includes(sep[1]) && s.includes(sep[2].slice(0, Math.max(3, sep[2].length - 2)))) return true
  // Inflected forms: match on a generous stem (drop typical endings)
  const stem = l.replace(/(en|st|et|te|er|es|em|en|e|n)$/u, '')
  if (stem.length >= 4 && s.includes(stem)) return true
  // Umlaut alternation in plurals/comparatives: Haus -> Häuser, lang -> länger
  const deUmlaut = stem.replace(/[äöü]/g, (c) => ({ ä: 'a', ö: 'o', ü: 'u' })[c])
  const sDeUmlaut = s.replace(/[äöü]/g, (c) => ({ ä: 'a', ö: 'o', ü: 'u' })[c])
  if (deUmlaut.length >= 4 && sDeUmlaut.includes(deUmlaut)) return true
  return false
}

function validateEntry(file, w, index) {
  const id = w?.id || `#${index}`

  if (!w || typeof w !== 'object') return err(file, id, 'entry is not an object')

  // --- required keys present ---
  for (const k of REQUIRED_KEYS) {
    if (!(k in w)) err(file, id, `missing key "${k}"`)
  }

  // --- identity ---
  if (!w.id || !/^[a-z0-9][a-z0-9-]*$/.test(w.id)) {
    err(file, id, `id "${w.id}" must be a lowercase ascii slug (a-z 0-9 -)`)
  }
  if (seenIds.has(w.id)) err(file, id, `duplicate id — also in ${seenIds.get(w.id)}`)
  else seenIds.set(w.id, file)

  const wordKey = String(w.word || '').toLowerCase()
  if (seenWords.has(wordKey)) warn(file, id, `duplicate word "${w.word}" — also in ${seenWords.get(wordKey)}`)
  else seenWords.set(wordKey, file)

  if (!w.word) err(file, id, 'empty word')
  if (!w.lemma) err(file, id, 'empty lemma')
  if (!w.translation) err(file, id, 'empty translation')

  if (!Array.isArray(w.translations) || w.translations.length === 0) {
    err(file, id, 'translations must be a non-empty array')
  } else if (w.translations[0] !== w.translation) {
    warn(file, id, 'translations[0] should equal translation')
  }

  // --- enums ---
  if (!LEVELS.has(w.level)) err(file, id, `bad level "${w.level}" (A0|A1|A2)`)
  if (!POS.has(w.partOfSpeech)) err(file, id, `bad partOfSpeech "${w.partOfSpeech}"`)
  if (typeof w.frequency !== 'number' || w.frequency < 1 || w.frequency > 3000) {
    err(file, id, `frequency must be a number 1-3000, got ${w.frequency}`)
  }

  // --- nouns ---
  if (w.partOfSpeech === 'noun') {
    // Plurale tantum — die Eltern, die Geschwister, die Leute, die Ferien.
    // These exist only in the plural, so they genuinely have no singular gender.
    // gender: null with article "die" is the correct encoding, not an error.
    const pluraleTantum = w.gender === null && w.article === 'die'

    if (pluraleTantum) {
      if (!/^die\s+/i.test(w.word)) {
        err(file, id, `plural-only noun "${w.word}" must start with "die"`)
      }
    } else if (!GENDER_ARTICLE[w.gender]) {
      err(file, id, `noun needs gender m|f|n (or gender:null + article:"die" for plural-only nouns), got "${w.gender}"`)
    } else if (w.article !== GENDER_ARTICLE[w.gender]) {
      err(file, id, `gender "${w.gender}" requires article "${GENDER_ARTICLE[w.gender]}", got "${w.article}"`)
    }
    if (!/^(der|die|das)\s+/i.test(w.word)) {
      err(file, id, `noun "word" must start with its article, got "${w.word}"`)
    } else if (w.article && !new RegExp(`^${w.article}\\s+`, 'i').test(w.word)) {
      err(file, id, `"word" starts with a different article than the "article" field ("${w.word}" vs "${w.article}")`)
    }
    if (!w.plural) err(file, id, 'noun missing plural (use "—" if it has none)')
    else if (w.plural !== '—' && !/^die\s+/i.test(w.plural)) {
      warn(file, id, `plural "${w.plural}" should start with "die"`)
    }
    // Multi-word nouns carry a declined adjective, so the citation form legitimately
    // differs from the word minus its article ("der Gelbe Sack" → "Gelber Sack").
    if (!/\s/.test(stripArticle(w.word)) && stripArticle(w.word) !== w.lemma) {
      warn(file, id, `lemma "${w.lemma}" should be "${stripArticle(w.word)}"`)
    }
  } else {
    if (w.gender !== null) warn(file, id, `non-noun should have gender: null, got "${w.gender}"`)
    if (w.article !== null) warn(file, id, `non-noun should have article: null`)
    if (w.plural !== null) warn(file, id, `non-noun should have plural: null`)
  }

  // --- verbs ---
  if (w.partOfSpeech === 'verb') {
    const f = w.forms || {}
    const missing = PERSONS.filter((p) => !f[p])
    if (missing.length) err(file, id, `verb missing present forms: ${missing.join(', ')}`)
    if (!f.perfekt) warn(file, id, 'verb missing forms.perfekt')
    if (!f.praeteritum) warn(file, id, 'verb missing forms.praeteritum')
    if (w.auxiliary !== 'haben' && w.auxiliary !== 'sein') {
      err(file, id, `verb auxiliary must be haben|sein, got "${w.auxiliary}"`)
    }
    if (f.perfekt && w.auxiliary && !String(f.perfekt).toLowerCase().includes(w.auxiliary === 'sein' ? 'ist' : 'hat')) {
      warn(file, id, `forms.perfekt "${f.perfekt}" disagrees with auxiliary "${w.auxiliary}"`)
    }
    if (typeof w.separable !== 'boolean') err(file, id, 'verb separable must be boolean')
    if (!Array.isArray(w.cases)) err(file, id, 'cases must be an array')
  } else {
    if (w.auxiliary !== null) warn(file, id, 'non-verb should have auxiliary: null')
  }

  // --- adjectives ---
  // Only gradable adjectives have comparatives. Past participles used as
  // adjectives (gekocht, gebraten), ordinals (letzte, erste) and absolutes
  // (tot, schwanger) genuinely have none — "more cooked" is no more a thing in
  // German than in English, so warning about them is pure noise.
  if (w.partOfSpeech === 'adjective') {
    const f = w.forms || {}
    const bare = String(w.lemma || '').replace(/^un/i, '')   // unbefristet → befristet

    // Past participles used as adjectives: bewölkt, verletzt, ausverkauft, befristet.
    const participle =
      /^(ge|be|ver|ent|er|zer|emp|miss)\w+(t|en)$/i.test(bare) ||
      /^(aus|ein|ab|an|auf|um|vor|nach|mit|zu|weg)(ge)?\w+(t|en)$/i.test(bare) ||
      /iert(e)?$/i.test(bare)

    // Binary properties — you either are or you aren't.
    const binary = /(frei|los)$/i.test(bare)

    const ABSOLUTE = new RegExp('^(' + [
      'tot', 'schwanger', 'ledig', 'verheiratet', 'geschieden', 'fertig', 'kaputt',
      'erste', 'zweite', 'dritte', 'letzte', 'nächste', 'vorige', 'einzige', 'ganz', 'halb',
      'deutsch', 'türkisch', 'englisch', 'vegetarisch', 'vegan', 'allergisch', 'schwindelig',
      'nördlich', 'südlich', 'östlich', 'westlich', 'täglich', 'wöchentlich', 'monatlich', 'jährlich',
      // colours: "röter" exists but nobody says it
      'rot', 'blau', 'gelb', 'grün', 'schwarz', 'weiß', 'grau', 'braun', 'orange',
      'rosa', 'lila', 'violett', 'türkis', 'beige', 'bunt', 'hell', 'dunkel',
    ].join('|') + ')$', 'i')

    const gradable = !ABSOLUTE.test(bare) && !participle && !binary

    if (gradable) {
      if (!f.komparativ) warn(file, id, 'gradable adjective missing forms.komparativ')
      if (!f.superlativ) warn(file, id, 'gradable adjective missing forms.superlativ')
    }
  }

  // --- examples ---
  if (!Array.isArray(w.example_sentences)) {
    err(file, id, 'example_sentences must be an array')
  } else {
    if (w.example_sentences.length !== 2) {
      err(file, id, `needs exactly 2 example_sentences, has ${w.example_sentences.length}`)
    }
    w.example_sentences.forEach((ex, i) => {
      if (!ex?.de || !ex?.en) return err(file, id, `example ${i} missing de or en`)
      if (!containsLemma(ex.de, w.lemma, { pos: w.partOfSpeech })) {
        warn(file, id, `example ${i} may not contain the word: "${ex.de}"`)
      }
      if (/[a-z]/.test(ex.de) && /\b(the|and|is|are|you|with)\b/i.test(ex.de)) {
        err(file, id, `example ${i} "de" looks like English: "${ex.de}"`)
      }
      // Text hygiene — catches the typos that slip past every other check.
      for (const [field, text] of [['de', ex.de], ['en', ex.en]]) {
        if (/\s{2,}/.test(text)) warn(file, id, `example ${i} "${field}" has a double space`)
        if (/\s+[.,!?]/.test(text)) warn(file, id, `example ${i} "${field}" has a space before punctuation`)
        if (!/[.!?…"»)]$/.test(text.trim())) warn(file, id, `example ${i} "${field}" doesn't end with punctuation: "${text}"`)
      }
      // A run of 28+ letters is almost always two words that lost their space.
      // Real German compounds do get long, but rarely past this.
      const runaway = String(ex.de).match(/[A-Za-zÄÖÜäöüß]{28,}/)
      if (runaway) warn(file, id, `example ${i} has a suspiciously long word — missing space? "${runaway[0]}"`)
    })
  }

  // --- cloze ---
  if (!Array.isArray(w.cloze)) {
    err(file, id, 'cloze must be an array')
  } else {
    if (w.cloze.length !== 1) err(file, id, `needs exactly 1 cloze, has ${w.cloze.length}`)
    w.cloze.forEach((c, i) => {
      if (!c?.de || !c?.answer || !c?.en) return err(file, id, `cloze ${i} missing de, answer or en`)
      if (!c.de.includes('___')) err(file, id, `cloze ${i} has no "___" gap: "${c.de}"`)
      // Whole-word match only. A plain substring check fires on "in" inside
      // "einem" and "um" inside "anzumelden", which are not giveaways at all.
      const escaped = c.answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'iu').test(c.de)) {
        err(file, id, `cloze ${i} gives the answer away — "${c.answer}" already appears in "${c.de}"`)
      }
      const exTexts = (w.example_sentences || []).map((e) => e?.de)
      if (exTexts.includes(c.de.replace('___', c.answer))) {
        warn(file, id, `cloze ${i} duplicates an example sentence`)
      }
    })
  }

  // --- misc ---
  if (typeof w.imageable !== 'boolean') err(file, id, 'imageable must be boolean')
  if (w.imageable && w.partOfSpeech !== 'noun') {
    warn(file, id, 'imageable: true on a non-noun')
  }
  for (const k of ['tags', 'synonyms', 'antonyms', 'related']) {
    if (!Array.isArray(w[k])) err(file, id, `${k} must be an array`)
  }
  // Count grapheme clusters, not code points. A single emoji like 👨‍⚕️ or 👨‍👩‍👧‍👦 is a
  // ZWJ sequence of 3-7 code points but renders as one character — counting
  // code points flags perfectly valid emoji.
  if (w.emoji) {
    const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(w.emoji)].length
    if (graphemes > 2) warn(file, id, `emoji "${w.emoji}" is ${graphemes} characters, expected 1`)
  }
}

// ─── run ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const quiet = args.includes('--quiet')
const asJson = args.includes('--json')

let files
try {
  files = readdirSync(VOCAB).filter((f) => f.endsWith('.json')).sort()
} catch {
  console.error(`No ${VOCAB} directory yet.`)
  process.exit(1)
}

if (files.length === 0) {
  console.error('No vocab files found in data/vocab/')
  process.exit(1)
}

const byLevel = {}
const byPos = {}
const byCategory = {}
const perFile = []
let total = 0

for (const file of files) {
  let data
  try {
    data = JSON.parse(readFileSync(join(VOCAB, file), 'utf8'))
  } catch (e) {
    err(file, '-', `INVALID JSON: ${e.message}`)
    perFile.push({ file, count: 0, broken: true })
    continue
  }
  const words = data.words
  if (!Array.isArray(words)) {
    err(file, '-', 'top-level "words" array missing')
    perFile.push({ file, count: 0, broken: true })
    continue
  }
  words.forEach((w, i) => validateEntry(file, w, i))
  words.forEach((w) => {
    byLevel[w?.level] = (byLevel[w?.level] || 0) + 1
    byPos[w?.partOfSpeech] = (byPos[w?.partOfSpeech] || 0) + 1
    byCategory[w?.category] = (byCategory[w?.category] || 0) + 1
  })
  total += words.length
  perFile.push({ file, count: words.length, category: data.category })
}

if (asJson) {
  console.log(JSON.stringify({ total, files: perFile, errors, warnings, byLevel, byPos }, null, 2))
  process.exit(errors.length ? 1 : 0)
}

const fileErrors = {}
for (const e of errors) (fileErrors[e.file] ||= []).push(e)
const fileWarnings = {}
for (const w of warnings) (fileWarnings[w.file] ||= []).push(w)

console.log('\n\x1b[1mVOCAB VALIDATION\x1b[0m')
console.log('─'.repeat(64))
for (const { file, count, broken } of perFile) {
  const e = (fileErrors[file] || []).length
  const w = (fileWarnings[file] || []).length
  const mark = broken || e ? '\x1b[31m✗\x1b[0m' : w ? '\x1b[33m!\x1b[0m' : '\x1b[32m✓\x1b[0m'
  const detail = [e ? `\x1b[31m${e} errors\x1b[0m` : '', w ? `\x1b[33m${w} warnings\x1b[0m` : '']
    .filter(Boolean).join('  ')
  console.log(`${mark} ${file.padEnd(34)} ${String(count).padStart(4)}  ${detail}`)
}

if (errors.length && !quiet) {
  console.log('\n\x1b[1;31mERRORS\x1b[0m')
  console.log('─'.repeat(64))
  for (const [file, list] of Object.entries(fileErrors)) {
    console.log(`\n  ${file}`)
    for (const e of list.slice(0, 25)) console.log(`    [${e.id}] ${e.msg}`)
    if (list.length > 25) console.log(`    … and ${list.length - 25} more`)
  }
}

if (warnings.length && !quiet) {
  console.log(`\n\x1b[1;33mWARNINGS\x1b[0m (${warnings.length} total, showing up to 5 per file)`)
  console.log('─'.repeat(64))
  for (const [file, list] of Object.entries(fileWarnings)) {
    console.log(`\n  ${file}`)
    for (const w of list.slice(0, 5)) console.log(`    [${w.id}] ${w.msg}`)
    if (list.length > 5) console.log(`    … and ${list.length - 5} more`)
  }
}

console.log('\n' + '─'.repeat(64))
console.log(`\x1b[1mTOTAL: ${total} words\x1b[0m across ${files.length} files`)
console.log(`  by level:  ${Object.entries(byLevel).sort().map(([k, v]) => `${k}=${v}`).join('  ')}`)
console.log(`  by type:   ${Object.entries(byPos).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ')}`)
console.log(`  unique ids: ${seenIds.size}`)
console.log(`  \x1b[31m${errors.length} errors\x1b[0m · \x1b[33m${warnings.length} warnings\x1b[0m\n`)

process.exit(errors.length ? 1 : 0)
