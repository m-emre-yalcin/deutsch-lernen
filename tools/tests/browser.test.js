#!/usr/bin/env node
/**
 * Runs browser.test.html in headless Chrome against a real server instance.
 *
 *   node tools/tests/browser.test.js
 *
 * Starts its own server on a spare port with a throwaway data directory, so it
 * can never touch your real progress.
 */

import { spawn, execFileSync } from 'node:child_process'
import { copyFileSync, unlinkSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const PORT = 5697
const TEST_HTML = join(HERE, 'browser.test.html')
const SERVED = join(ROOT, 'web', '_test.html')

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]
const chrome = CHROME_PATHS.find(existsSync)

if (!chrome) {
  console.log('  – No Chrome/Chromium found; skipping browser tests.')
  process.exit(0)
}

const sandbox = mkdtempSync(join(tmpdir(), 'dl-test-'))
mkdirSync(join(sandbox, 'backups'), { recursive: true })

let server
const cleanup = () => {
  try { server?.kill() } catch {}
  try { if (existsSync(SERVED)) unlinkSync(SERVED) } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(1) })

// Serve the test page from the web root so it can import /js/* and call /api/*.
copyFileSync(TEST_HTML, SERVED)

server = spawn('node', [join(ROOT, 'server', 'server.js'), '--port', String(PORT), '--data', sandbox],
  { cwd: ROOT, stdio: 'ignore' })

const waitFor = async () => {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return true } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

if (!(await waitFor())) {
  console.error('  ✗ test server did not start')
  process.exit(1)
}

let dom
try {
  dom = execFileSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--virtual-time-budget=25000',
    '--dump-dom', `http://localhost:${PORT}/_test.html`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 })
} catch (e) {
  console.error('  ✗ chrome failed:', e.message)
  process.exit(1)
}

// Pull the assertion lines back out of the rendered DOM.
const lines = [...dom.matchAll(/<div class="(ok|no)">([^<]*)<\/div>/g)].map((m) => ({
  ok: m[1] === 'ok',
  text: m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'),
}))

for (const l of lines) {
  console.log(l.ok ? `\x1b[32m${l.text}\x1b[0m` : `\x1b[31m${l.text}\x1b[0m`)
}

const summary = dom.match(/RESULT (\d+) passed, (\d+) failed/)
if (!summary) {
  console.error('\n  ✗ test page did not finish — no summary found.')
  console.error('    (open http://localhost:5555/_test.html in a browser to debug)')
  process.exit(1)
}

const [, passed, failed] = summary
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(Number(failed) ? 1 : 0)
