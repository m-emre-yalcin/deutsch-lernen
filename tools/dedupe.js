#!/usr/bin/env node
/**
 * Resolves duplicate ids across data/vocab/.
 *
 * The vocabulary files are written independently, so a word that genuinely
 * belongs to two domains (während is both a preposition and a conjunction;
 * wer/was are both pronouns and question words) legitimately gets written twice.
 * Neither copy is wrong — but the deck needs one entry per id.
 *
 * Rule: keep the RICHER entry. More teaching content wins, because that's the
 * copy that will actually help when the word won't stick. Ties go to the
 * lower-numbered file.
 *
 *   node tools/dedupe.js            # show what would change
 *   node tools/dedupe.js --apply    # write it
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VOCAB = join(ROOT, 'data', 'vocab')
const APPLY = process.argv.includes('--apply')

/** How much teaching value does this entry carry? */
function richness(w) {
  let score = 0
  score += (w.notes || '').length * 1.0
  score += (w.germany_context || '').length * 1.5   // the rarest, most useful field
  score += (w.mnemonic || '').length * 0.8
  score += (w.example_sentences || []).reduce((s, e) => s + (e.de || '').length + (e.en || '').length, 0) * 0.3
  score += (w.cloze || []).length * 20
  score += Object.keys(w.forms || {}).length * 15
  score += (w.synonyms || []).length * 5
  score += (w.antonyms || []).length * 5
  score += (w.translations || []).length * 3
  if (w.emoji) score += 5
  return score
}

const files = readdirSync(VOCAB).filter((f) => f.endsWith('.json')).sort()
const decks = new Map()
const occurrences = new Map()   // key -> [{file, index, word}]

/**
 * Two things count as the same entry:
 *   - the same id (progress is keyed by id, so a clash splits your history)
 *   - the same WORD and part of speech (two "kalt" adjectives are one word,
 *     however they're spelled internally — and having both makes typing mode
 *     unanswerable, since only one of them is ever the "right" answer)
 */
const keysFor = (w) => [
  `id:${w.id}`,
  `word:${String(w.word).trim().toLowerCase()}|${w.partOfSpeech}`,
]

for (const file of files) {
  let data
  try { data = JSON.parse(readFileSync(join(VOCAB, file), 'utf8')) } catch (e) {
    console.error(`  ✗ ${file}: ${e.message}`)
    continue
  }
  decks.set(file, data)
  ;(data.words || []).forEach((w, index) => {
    if (!w?.id) return
    for (const key of keysFor(w)) {
      if (!occurrences.has(key)) occurrences.set(key, [])
      occurrences.get(key).push({ file, index, word: w })
    }
  })
}

// One occurrence can match on both id and word; only report each pair once.
const dupes = [...occurrences.entries()]
  .filter(([, list]) => list.length > 1)
  .filter(([, list]) => new Set(list.map((o) => `${o.file}#${o.index}`)).size > 1)

if (dupes.length === 0) {
  console.log('✓ No duplicate ids or repeated words.')
  process.exit(0)
}

console.log(`\nFound ${dupes.length} duplicate group${dupes.length === 1 ? '' : 's'} (same id, or same word twice):\n`)

const toDrop = new Map()   // file -> Set(index)

for (const [key, list] of dupes) {
  // A drop decided by an earlier key must not be re-evaluated under another.
  const live = list.filter((o) => !toDrop.get(o.file)?.has(o.index))
  if (live.length < 2) continue
  const scored = live
    .map((o) => ({ ...o, score: richness(o.word) }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))

  const keep = scored[0]
  const drop = scored.slice(1)

  console.log(`  ${key}`)
  console.log(`    keep  ${keep.file}  (richness ${Math.round(keep.score)})`)
  for (const d of drop) {
    console.log(`    drop  ${d.file}  (richness ${Math.round(d.score)})`)
    if (!toDrop.has(d.file)) toDrop.set(d.file, new Set())
    toDrop.get(d.file).add(d.index)
  }
}

if (!APPLY) {
  console.log(`\n${dupes.length} duplicates would be resolved. Re-run with --apply to write.\n`)
  process.exit(0)
}

let removed = 0
for (const [file, indices] of toDrop) {
  const data = decks.get(file)
  data.words = data.words.filter((_, i) => !indices.has(i))
  writeFileSync(join(VOCAB, file), JSON.stringify(data, null, 2) + '\n', 'utf8')
  removed += indices.size
  console.log(`  → ${file}: removed ${indices.size}, ${data.words.length} remain`)
}

console.log(`\n✓ Removed ${removed} duplicate entries.\n`)
