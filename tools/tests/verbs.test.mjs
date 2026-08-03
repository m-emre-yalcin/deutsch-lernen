#!/usr/bin/env node
/**
 * Verb ground truth.
 *
 * Irregular German verbs are the other place a silent error costs you dearly:
 * "du fahrst" instead of "du fährst" is well-formed data that no schema check
 * can catch, and you'd drill it hundreds of times before finding out.
 *
 * Checks stem changes, Perfekt participles, and the haben/sein choice — the
 * three things learners get wrong and generators get wrong with them.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const VOCAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'vocab')

// [du-form, er-form, perfekt, auxiliary]
const TRUTH = {
  sein:      ['bist', 'ist', 'ist gewesen', 'sein'],
  haben:     ['hast', 'hat', 'hat gehabt', 'haben'],
  werden:    ['wirst', 'wird', 'ist geworden', 'sein'],
  fahren:    ['fährst', 'fährt', 'ist gefahren', 'sein'],
  laufen:    ['läufst', 'läuft', 'ist gelaufen', 'sein'],
  schlafen:  ['schläfst', 'schläft', 'hat geschlafen', 'haben'],
  tragen:    ['trägst', 'trägt', 'hat getragen', 'haben'],
  halten:    ['hältst', 'hält', 'hat gehalten', 'haben'],
  nehmen:    ['nimmst', 'nimmt', 'hat genommen', 'haben'],
  geben:     ['gibst', 'gibt', 'hat gegeben', 'haben'],
  essen:     ['isst', 'isst', 'hat gegessen', 'haben'],
  sprechen:  ['sprichst', 'spricht', 'hat gesprochen', 'haben'],
  helfen:    ['hilfst', 'hilft', 'hat geholfen', 'haben'],
  treffen:   ['triffst', 'trifft', 'hat getroffen', 'haben'],
  vergessen: ['vergisst', 'vergisst', 'hat vergessen', 'haben'],
  lesen:     ['liest', 'liest', 'hat gelesen', 'haben'],
  sehen:     ['siehst', 'sieht', 'hat gesehen', 'haben'],
  gehen:     ['gehst', 'geht', 'ist gegangen', 'sein'],
  kommen:    ['kommst', 'kommt', 'ist gekommen', 'sein'],
  bleiben:   ['bleibst', 'bleibt', 'ist geblieben', 'sein'],
  fliegen:   ['fliegst', 'fliegt', 'ist geflogen', 'sein'],
  trinken:   ['trinkst', 'trinkt', 'hat getrunken', 'haben'],
  finden:    ['findest', 'findet', 'hat gefunden', 'haben'],
  schreiben: ['schreibst', 'schreibt', 'hat geschrieben', 'haben'],
  sprechen_: null,
  wissen:    ['weißt', 'weiß', 'hat gewusst', 'haben'],
  können:    ['kannst', 'kann', 'hat gekonnt', 'haben'],
  müssen:    ['musst', 'muss', 'hat gemusst', 'haben'],
  dürfen:    ['darfst', 'darf', 'hat gedurft', 'haben'],
  wollen:    ['willst', 'will', 'hat gewollt', 'haben'],
  sollen:    ['sollst', 'soll', 'hat gesollt', 'haben'],
  mögen:     ['magst', 'mag', 'hat gemocht', 'haben'],
  stehen:    ['stehst', 'steht', 'hat gestanden', 'haben'],
  liegen:    ['liegst', 'liegt', 'hat gelegen', 'haben'],
  sitzen:    ['sitzt', 'sitzt', 'hat gesessen', 'haben'],
  bringen:   ['bringst', 'bringt', 'hat gebracht', 'haben'],
  denken:    ['denkst', 'denkt', 'hat gedacht', 'haben'],
  kennen:    ['kennst', 'kennt', 'hat gekannt', 'haben'],
  aufstehen: ['stehst auf', 'steht auf', 'ist aufgestanden', 'sein'],
  anrufen:   ['rufst an', 'ruft an', 'hat angerufen', 'haben'],
  einkaufen: ['kaufst ein', 'kauft ein', 'hat eingekauft', 'haben'],
  ankommen:  ['kommst an', 'kommt an', 'ist angekommen', 'sein'],
  einsteigen:['steigst ein', 'steigt ein', 'ist eingestiegen', 'sein'],
  passieren: [null, 'passiert', 'ist passiert', 'sein'],
  studieren: ['studierst', 'studiert', 'hat studiert', 'haben'],
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

const deck = new Map()
for (const f of readdirSync(VOCAB).filter((f) => f.endsWith('.json')).sort()) {
  let data
  try { data = JSON.parse(readFileSync(join(VOCAB, f), 'utf8')) } catch { continue }
  for (const w of data.words || []) {
    if (w?.partOfSpeech === 'verb' && w.lemma && !deck.has(w.lemma)) deck.set(w.lemma, { ...w, file: f })
  }
}

let checked = 0
const fails = []

for (const [lemma, exp] of Object.entries(TRUTH)) {
  if (!exp) continue
  const w = deck.get(lemma)
  if (!w) continue
  checked++
  const [du, er, perfekt, aux] = exp
  const f = w.forms || {}

  // Separable verbs are stored either as "stehst auf" or just "stehst" —
  // accept both, since the split is a rendering choice not a correctness one.
  const matches = (got, want) => {
    if (!want) return true
    const g = norm(got), n = norm(want)
    return g === n || n.startsWith(g) || g === n.split(' ')[0]
  }

  if (!matches(f.du, du)) fails.push(`${lemma}: du "${f.du}" should be "${du}"  (${w.file})`)
  if (!matches(f.er, er)) fails.push(`${lemma}: er "${f.er}" should be "${er}"  (${w.file})`)
  if (norm(f.perfekt) !== norm(perfekt)) fails.push(`${lemma}: Perfekt "${f.perfekt}" should be "${perfekt}"  (${w.file})`)
  if (w.auxiliary !== aux) fails.push(`${lemma}: auxiliary "${w.auxiliary}" should be "${aux}"  (${w.file})`)
}

for (const f of fails) console.log(`\x1b[31m✗ ${f}\x1b[0m`)

if (!fails.length) {
  console.log(`\x1b[32m✓ all ${checked} irregular verbs conjugate correctly\x1b[0m (stem change, Perfekt, haben/sein)`)
}
console.log(`\n${checked * 4 - fails.length} passed, ${fails.length} failed`)
process.exit(fails.length ? 1 : 0)
