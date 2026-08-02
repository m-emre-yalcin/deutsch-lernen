#!/usr/bin/env node
/**
 * Merges data/grammar/parts/*.json into data/grammar/lessons.json, and checks
 * every lesson and drill is actually usable.
 *
 *   node tools/build-grammar.js
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS = join(ROOT, 'data', 'grammar', 'parts')
const OUT = join(ROOT, 'data', 'grammar', 'lessons.json')

const DRILL_TYPES = new Set(['choice', 'fill', 'order'])
const errors = []
const warnings = []

if (!existsSync(PARTS)) {
  console.error(`No ${PARTS} directory. Nothing to build.`)
  process.exit(1)
}

const lessons = []
const seenIds = new Set()

for (const file of readdirSync(PARTS).filter((f) => f.endsWith('.json')).sort()) {
  let data
  try {
    data = JSON.parse(readFileSync(join(PARTS, file), 'utf8'))
  } catch (e) {
    errors.push(`${file}: invalid JSON — ${e.message}`)
    continue
  }

  for (const l of data.lessons || []) {
    const where = `${file} [${l.id || '?'}]`

    if (!l.id) { errors.push(`${where}: missing id`); continue }
    if (seenIds.has(l.id)) { errors.push(`${where}: duplicate id`); continue }
    seenIds.add(l.id)

    if (!l.title) errors.push(`${where}: missing title`)
    if (!l.rule) errors.push(`${where}: missing rule`)
    if (typeof l.number !== 'number') warnings.push(`${where}: missing number`)
    if (!['A0', 'A1', 'A2'].includes(l.level)) warnings.push(`${where}: odd level "${l.level}"`)

    // Drills are the part that silently breaks — a choice whose answer isn't in
    // its options is unanswerable, and you'd only find out mid-session.
    const drills = l.drills || []
    if (drills.length !== 8) warnings.push(`${where}: ${drills.length} drills, expected 8`)

    l.drills = drills.filter((d, i) => {
      const at = `${where} drill ${i}`
      if (!DRILL_TYPES.has(d.type)) { errors.push(`${at}: bad type "${d.type}"`); return false }
      if (!d.explain) warnings.push(`${at}: no explanation`)

      if (d.type === 'choice') {
        if (!Array.isArray(d.options) || d.options.length < 2) { errors.push(`${at}: needs 2+ options`); return false }
        if (!d.options.includes(d.answer)) {
          errors.push(`${at}: answer "${d.answer}" is not among its options [${d.options.join(', ')}]`)
          return false
        }
      }

      if (d.type === 'order') {
        if (!Array.isArray(d.words) || d.words.length < 2) { errors.push(`${at}: needs 2+ words`); return false }
        const expected = d.words.join(' ')
        const sorted = (s) => s.split(/\s+/).sort().join(' ')
        if (sorted(expected) !== sorted(d.answer)) {
          errors.push(`${at}: answer "${d.answer}" doesn't use exactly the given words`)
          return false
        }
      }

      if (d.type === 'fill') {
        if (!d.answer) { errors.push(`${at}: no answer`); return false }
        if (!d.question) { errors.push(`${at}: no question`); return false }
      }

      return true
    })

    // Normalise the optional shapes so the UI never has to guard.
    l.tables = (l.tables || []).filter((t) => Array.isArray(t.rows) && t.rows.length)
    l.examples = l.examples || []
    l.mistakes = l.mistakes || []
    l.keyWords = l.keyWords || []
    l.group = l.group || 'Other'

    lessons.push(l)
  }
}

lessons.sort((a, b) => (a.number || 999) - (b.number || 999))

// ── report ──
console.log('\n\x1b[1mGRAMMAR BUILD\x1b[0m')
console.log('─'.repeat(60))
for (const l of lessons) {
  const mark = l.drills.length === 8 ? '\x1b[32m✓\x1b[0m' : '\x1b[33m!\x1b[0m'
  console.log(`${mark} ${String(l.number).padStart(2, '0')} ${l.level}  ${l.title.slice(0, 46).padEnd(46)} ${l.drills.length} drills`)
}

if (errors.length) {
  console.log('\n\x1b[1;31mERRORS\x1b[0m')
  for (const e of errors) console.log(`  ${e}`)
}
if (warnings.length) {
  console.log(`\n\x1b[1;33mWARNINGS\x1b[0m (${warnings.length})`)
  for (const w of warnings.slice(0, 20)) console.log(`  ${w}`)
  if (warnings.length > 20) console.log(`  … and ${warnings.length - 20} more`)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  meta: { count: lessons.length, builtAt: new Date().toISOString() },
  lessons,
}, null, 2) + '\n', 'utf8')

const groups = {}
for (const l of lessons) groups[l.group] = (groups[l.group] || 0) + 1

console.log('\n' + '─'.repeat(60))
console.log(`\x1b[1m${lessons.length} lessons\x1b[0m · ${lessons.reduce((s, l) => s + l.drills.length, 0)} drills → data/grammar/lessons.json`)
console.log(`  ${Object.entries(groups).map(([k, v]) => `${k}=${v}`).join('  ')}`)
console.log(`  \x1b[31m${errors.length} errors\x1b[0m · \x1b[33m${warnings.length} warnings\x1b[0m\n`)

process.exit(errors.length ? 1 : 0)
