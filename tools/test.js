#!/usr/bin/env node
/**
 * Runs every check: unit tests, vocabulary validation, grammar build.
 *
 *   node tools/test.js
 *
 * Worth running after you edit any data file or touch the scheduler.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const run = (label, file, args = []) => {
  process.stdout.write(`\n\x1b[1m▸ ${label}\x1b[0m\n`)
  try {
    const out = execFileSync('node', [file, ...args], { cwd: ROOT, encoding: 'utf8' })
    process.stdout.write(out)
    return true
  } catch (e) {
    process.stdout.write(e.stdout || '')
    process.stderr.write(e.stderr || '')
    return false
  }
}

let ok = true
for (const f of readdirSync(join(HERE, 'tests')).filter((f) => f.endsWith('.test.mjs')).sort()) {
  ok = run(`unit: ${f.replace('.test.mjs', '')}`, join(HERE, 'tests', f)) && ok
}
ok = run('vocabulary', join(HERE, 'validate.js'), ['--quiet']) && ok
ok = run('grammar', join(HERE, 'build-grammar.js')) && ok
// Drives the real app in headless Chrome. Skips itself if no browser is present.
ok = run('browser (end to end)', join(HERE, 'tests', 'browser.test.js')) && ok

console.log(ok
  ? '\n\x1b[1;32m✓ Everything passed\x1b[0m\n'
  : '\n\x1b[1;31m✗ Something failed — see above\x1b[0m\n')
process.exit(ok ? 0 : 1)
