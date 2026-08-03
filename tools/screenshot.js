#!/usr/bin/env node
/**
 * Screenshots the running app via the Chrome DevTools Protocol.
 *
 *   node --experimental-websocket tools/screenshot.js [--port 5555] [--out ./shots]
 *
 * Chrome's plain `--screenshot` flag fires before the deck has finished loading,
 * so this drives a real browser instead: navigate, wait until the app has
 * actually rendered, click through each view, capture.
 *
 * Useful for eyeballing a change without leaving the terminal.
 */

import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] ? argv[i + 1] : d }
const PORT = arg('port', '5555')
const OUT = arg('out', '/tmp/deutsch-shots')
const THEME = arg('theme', 'dark')

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(existsSync)

if (!CHROME) { console.error('No Chrome found.'); process.exit(1) }
mkdirSync(OUT, { recursive: true })

const DEBUG_PORT = 9333
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=1440,950',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cleanup = () => { try { chrome.kill() } catch {} }
process.on('exit', cleanup)

// ── connect ──
let target
for (let i = 0; i < 40; i++) {
  try {
    const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json())
    target = list.find((t) => t.type === 'page')
    if (target) break
  } catch {}
  await sleep(250)
}
if (!target) { console.error('Chrome did not expose a debug target'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  }
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.value
}

/** Poll a JS predicate until it goes true. */
const waitFor = async (expr, label, timeout = 30000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await evaluate(expr)) return true
    await sleep(200)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const shoot = async (name) => {
  await sleep(700)   // let transitions settle
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const file = join(OUT, `${name}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`  ✓ ${file}`)
}

await send('Page.enable')
await send('Runtime.enable')

console.log(`\n  Capturing http://localhost:${PORT} (${THEME})\n`)

await send('Page.navigate', { url: `http://localhost:${PORT}/` })
await waitFor('!!document.querySelector("#app") && !document.querySelector("#boot").hidden === false', 'boot')
await waitFor('document.getElementById("boot").hidden === true', 'app to finish loading')
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('deutsch_lernen_v3') || '{}')
  s.settings = { ...(s.settings || {}), theme: '${THEME}' }
  localStorage.setItem('deutsch_lernen_v3', JSON.stringify(s))
  document.documentElement.dataset.theme = '${THEME}'
})()`)

await waitFor('!!document.querySelector("#view-study .prompt-word")', 'a card')
await shoot('01-study')

// reveal the answer panel
await evaluate('document.querySelector("#view-study .mc-opt")?.click()')
await sleep(1200)
await evaluate(`(() => {
  const w = window; // reveal via the app's own keyboard path
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
})()`)
await sleep(900)
await shoot('02-answer')

for (const view of ['drills', 'grammar', 'browse', 'stats', 'settings']) {
  await evaluate(`document.querySelector('.nav-btn[data-view="${view}"]').click()`)
  await sleep(600)
  await shoot(`0${['drills', 'grammar', 'browse', 'stats', 'settings'].indexOf(view) + 3}-${view}`)
}

// a grammar lesson — navigate back to Grammar first, then open one
await evaluate(`document.querySelector('.nav-btn[data-view="grammar"]').click()`)
await sleep(500)
await evaluate(`document.querySelectorAll('#view-grammar [data-lesson]')[11]?.click()`)
await sleep(700)
await shoot('08-grammar-lesson')

// and its drills
await evaluate(`document.querySelector('#view-grammar #drillBtn')?.click()`)
await sleep(700)
await shoot('09-grammar-drill')

console.log(`\n  Done → ${OUT}\n`)
ws.close()
cleanup()
process.exit(0)
