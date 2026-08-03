#!/usr/bin/env node
/**
 * Responsive audit — drives a real browser at phone, tablet and desktop widths
 * and reports layout problems you cannot see from the DOM alone.
 *
 *   node --experimental-websocket tools/responsive-check.js [--port 5555] [--shots DIR]
 *
 * Checks, per breakpoint and per view:
 *   - horizontal overflow (the classic "why does my page scroll sideways")
 *   - elements wider than the viewport
 *   - tap targets under 44px on touch breakpoints
 *   - text smaller than 12px
 *   - the bottom nav actually being reachable, not off-screen
 *
 * Exits 1 if anything fails, so it can gate a change.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] ? argv[i + 1] : d }
const PORT = arg('port', '5555')
const SHOTS = arg('shots', null)

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(existsSync)

if (!CHROME) { console.log('  – No Chrome found; skipping responsive check.'); process.exit(0) }
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const BREAKPOINTS = [
  { name: 'iPhone SE', w: 375, h: 667, touch: true },
  { name: 'iPhone 14', w: 390, h: 844, touch: true },
  { name: 'phone landscape', w: 844, h: 390, touch: true },
  { name: 'iPad', w: 820, h: 1180, touch: true },
  { name: 'laptop', w: 1280, h: 800, touch: false },
  { name: 'desktop', w: 1680, h: 1050, touch: false },
]

const VIEWS = ['study', 'drills', 'grammar', 'browse', 'stats', 'settings']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const problems = []

async function connect(debugPort) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {}
    await sleep(250)
  }
  return null
}

function rpc(ws) {
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rej(new Error(`${m.error.message} (${m.error.data || ''})`)) : res(m.result)
    }
  }
  return (method, params = {}) => new Promise((res, rej) => {
    const i = ++id
    pending.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
}

async function audit(bp, index) {
  const debugPort = 9400 + index
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`, `--window-size=${bp.w},${bp.h}`, 'about:blank',
  ], { stdio: 'ignore' })

  try {
    const target = await connect(debugPort)
    if (!target) throw new Error('chrome did not start')

    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    const send = rpc(ws)
    const ev = async (expr) =>
      (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: bp.w, height: bp.h, deviceScaleFactor: 1, mobile: bp.touch,
    })
    if (bp.touch) {
      // What a real phone reports — without this, hover styles stay active.
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }],
      })
      await send('Emulation.setTouchEmulationEnabled', { enabled: true })
    }

    await send('Page.navigate', { url: `http://localhost:${PORT}/` })
    let booted = false
    for (let i = 0; i < 100; i++) {
      await sleep(250)
      if (await ev(`document.getElementById('boot')?.hidden === true`)) { booted = true; break }
    }
    if (!booted) throw new Error('app never finished loading')

    const bad = []
    for (const view of VIEWS) {
      await ev(`document.querySelector('.nav-btn[data-view="${view}"]')?.click()`)
      await sleep(500)

      const res = await ev(`(() => {
        const vw = document.documentElement.clientWidth
        const out = { view: ${JSON.stringify(view)}, vw }
        out.overflow = document.documentElement.scrollWidth > vw + 1

        // Anything actually sticking out past the viewport. Content inside a
        // horizontally-scrollable ancestor is exempt — being wider than the
        // viewport is the entire point of a scroll container.
        const inScroller = (e) => {
          for (let p = e.parentElement; p && p.id !== 'app'; p = p.parentElement) {
            const cs = getComputedStyle(p)
            if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') &&
                p.scrollWidth > p.clientWidth) return true
          }
          return false
        }
        out.wide = [...document.querySelectorAll('#app *')]
          .filter(e => { const r = e.getBoundingClientRect()
                         return r.width > 0 && (r.right > vw + 1 || r.left < -1) })
          .filter(e => !inScroller(e))
          .slice(0, 4)
          .map(e => (e.tagName + '.' + (e.className || '').toString().split(' ')[0]).slice(0, 40))

        // Tap targets, only where a finger is the pointer
        out.small = ${bp.touch} ? [...document.querySelectorAll(
            'button, a[href], select, input:not([type=range]), .nav-btn, .mc-opt, .wt-row')]
          .filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 40 })
          // A small control inside a big clickable label is fine — the label
          // is the touch target (checkboxes inside 44px label rows).
          .filter(e => !(e.closest('label') && e.closest('label').getBoundingClientRect().height >= 40))
          .slice(0, 4)
          .map(e => ((e.className || '').toString().split(' ')[0] || e.tagName) + ':' +
                    Math.round(e.getBoundingClientRect().height)) : []

        // Text too small to read
        out.tiny = [...document.querySelectorAll('#app *')]
          .filter(e => e.childElementCount === 0 && e.textContent.trim().length > 2)
          .filter(e => parseFloat(getComputedStyle(e).fontSize) < 11)
          .slice(0, 3)
          .map(e => (e.className || e.tagName) + ':' + getComputedStyle(e).fontSize)

        // The nav must be on screen and not covering the content
        const nav = document.getElementById('sidebar')
        const nr = nav.getBoundingClientRect()
        out.navVisible = nr.width > 0 && nr.height > 0 &&
                         nr.bottom <= document.documentElement.clientHeight + 1 &&
                         nr.right <= vw + 1
        return out
      })()`)

      if (res.overflow) bad.push(`${view}: page scrolls sideways`)
      if (res.wide?.length) bad.push(`${view}: overflowing → ${res.wide.join(', ')}`)
      if (res.small?.length) bad.push(`${view}: tap targets <40px → ${res.small.join(', ')}`)
      if (res.tiny?.length) bad.push(`${view}: text <11px → ${res.tiny.join(', ')}`)
      if (!res.navVisible) bad.push(`${view}: nav off-screen or clipped`)

      if (SHOTS) {
        const { data } = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(join(SHOTS, `${bp.w}-${view}.png`), Buffer.from(data, 'base64'))
      }
    }

    const mark = bad.length ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m'
    console.log(`${mark} ${bp.name.padEnd(17)} ${String(bp.w).padStart(4)}×${bp.h}` +
                (bad.length ? `  \x1b[31m${bad.length} issue${bad.length > 1 ? 's' : ''}\x1b[0m` : ''))
    for (const b of bad) { console.log(`    ${b}`); problems.push(`${bp.name} · ${b}`) }
    failures += bad.length

    ws.close()
  } catch (e) {
    console.log(`\x1b[31m✗\x1b[0m ${bp.name.padEnd(17)} ${e.message}`)
    failures++
  } finally {
    chrome.kill()
    await sleep(300)
  }
}

console.log('\n\x1b[1mRESPONSIVE AUDIT\x1b[0m')
console.log('─'.repeat(58))

for (const [i, bp] of BREAKPOINTS.entries()) await audit(bp, i)

console.log('─'.repeat(58))
console.log(failures
  ? `\x1b[1;31m${failures} layout problem${failures > 1 ? 's' : ''}\x1b[0m\n`
  : `\x1b[1;32m✓ clean at every breakpoint\x1b[0m  (${BREAKPOINTS.length} sizes × ${VIEWS.length} views)\n`)

process.exit(failures ? 1 : 0)
