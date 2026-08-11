/**
 * Deutsch Lernen — desktop shell.
 *
 * This is a thin wrapper, on purpose. It starts the same local server the
 * command line starts, points a window at it, and keeps the content up to date
 * from GitHub. The app you actually use is still web/ talking to server/ over
 * http://127.0.0.1 — nothing about how it works changes because it is in a
 * window, and `./start.sh` keeps working exactly as before.
 *
 * ── Why the server is a child process, not an import ─────────────────────────
 * It would be less code to `import()` the server into this process. It would
 * also mean that a bad commit — the payload is downloaded from GitHub at
 * runtime — throws during startup and takes the whole app with it, leaving no
 * UI to explain what happened and no way back short of deleting files by hand.
 *
 * As a separate process it can fail safely. If a downloaded payload's server
 * exits during startup, that payload is marked bad, the copy that shipped
 * inside the app is put back, and the app carries on. A broken update costs a
 * few seconds, not a broken install. Running it out-of-process also keeps
 * argv, process.exit and the signal handlers behaving exactly as they do from
 * the command line, so there is one server, not two subtly different ones.
 *
 * It runs under Electron's own Node (ELECTRON_RUN_AS_NODE), so nothing here
 * needs Node installed on the machine.
 */

import { app, BrowserWindow, Menu, shell, dialog, ipcMain, nativeTheme, screen } from 'electron'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Updater, REPO, CHECK_INTERVAL } from './updater.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOST = '127.0.0.1'
// The same port ./start.sh uses. Pinned rather than ephemeral because
// localStorage — which holds the offline mirror of your progress and any
// reviews queued while the server was down — is keyed by origin, and a port
// that moved between launches would strand them somewhere unreadable.
const BASE_PORT = 5555
// How long a newly started server gets to prove itself. Past this it is a
// working server that later died, not a payload that cannot start.
const BOOT_GRACE = 20_000

// The name decides where userData lives, and must be set before anything asks.
app.setName('Deutsch Lernen')

const USER_DATA = app.getPath('userData')
const REPO_URL = `https://github.com/${REPO.owner}/${REPO.name}`
const log = (...a) => console.log('[deutsch-lernen]', ...a)

/**
 * The payload that shipped inside the app — the fallback that must always work.
 * Packaged it sits next to the asar as plain files; unpackaged it is the repo
 * you are running from.
 */
const BUNDLED = app.isPackaged ? join(process.resourcesPath, 'payload') : join(HERE, '..')

// Changes whenever a new binary is installed, which retires any payload the
// previous one downloaded — otherwise installing a newer app could silently
// leave you running older content.
const BUILD = (() => {
  try { return JSON.parse(readFileSync(join(HERE, 'bundled.json'), 'utf8')) } catch { return {} }
})()
const IDENTITY = `${app.getVersion()}:${BUILD.sha || 'dev'}`

let win = null
let server = null          // the child process
let serverPort = BASE_PORT
let serverStartedAt = 0
let stoppingServer = false
let quitting = false
let updater = null
let checkTimer = null

// ─── SERVER ───────────────────────────────────────────────────────────────────

const canBind = (port) => new Promise((resolve) => {
  const probe = createServer()
  probe.once('error', () => resolve(false))
  probe.once('listening', () => probe.close(() => resolve(true)))
  probe.listen(port, HOST)
})

const health = async (port) => {
  try {
    return (await fetch(`http://${HOST}:${port}/api/health`)).ok
  } catch { return false }
}

/**
 * A port nothing is using.
 *
 * Both checks are needed. Binding can succeed against a port another process is
 * already serving — a socket bound to 0.0.0.0 does not always stop a second
 * bind to 127.0.0.1 — and a port that answers /api/health is in use whether or
 * not it can be bound. Getting this wrong is not a small bug: an already-running
 * ./start.sh would answer the health probe below, the real server would then
 * die of EADDRINUSE, and a perfectly good update would be blamed and rolled
 * back.
 */
async function pickPort(from = BASE_PORT, attempts = 20) {
  for (let port = from; port < from + attempts; port++) {
    if (await canBind(port) && !(await health(port))) return port
  }
  throw new Error(`no free port between ${from} and ${from + attempts}`)
}

/**
 * Spawn the server once and wait for it to be usable.
 *
 * Resolves 'ready', or 'exited' if the process died first — a race, not a
 * timeout, because a child that has already exited is never going to answer and
 * waiting the full 30 seconds for it would just delay the retry.
 */
function spawnServer(entry, port) {
  stoppingServer = false
  serverStartedAt = Date.now()

  const child = spawn(process.execPath, [
    entry,
    '--port', String(port),
    '--host', HOST,
    '--data', USER_DATA,
    '--user-vocab', join(USER_DATA, 'vocab'),
    '--cache', join(USER_DATA, 'cache'),
  ], {
    // Electron's own Node, so nothing needs to be installed on the machine.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server = child

  child.stdout.on('data', (d) => process.stdout.write(d))
  child.stderr.on('data', (d) => process.stderr.write(d))

  return new Promise((resolve) => {
    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolve(r) } }

    child.once('exit', () => done('exited'))

    const deadline = Date.now() + 30_000
    const poll = async () => {
      if (settled) return
      // Ask the child, not just the port: this is only proof of life if the
      // process we started is the one answering.
      if (child.exitCode === null && await health(port)) return done('ready')
      if (Date.now() > deadline) return done('exited')
      setTimeout(poll, 120)
    }
    poll()
  })
}

/**
 * Start the server from whichever payload is current.
 *
 * Everything writable is pointed outside the payload, because the payload
 * directory is replaced wholesale by an update — anything left inside it would
 * be destroyed the first time one landed.
 *
 * Retried across several ports before giving up. A port that looked free and
 * was not is by far the likeliest reason for a failed start, and it says
 * nothing about whether the payload is any good; only failing on every port
 * does.
 */
async function startServer() {
  const payload = updater.resolve()
  const entry = join(payload, 'server', 'server.js')
  if (!existsSync(entry)) throw new Error(`server missing from payload: ${entry}`)

  mkdirSync(join(USER_DATA, 'vocab'), { recursive: true })
  log(`starting server from ${payload === BUNDLED ? 'bundled payload' : payload}`)

  let lastPort = BASE_PORT
  for (let attempt = 0; attempt < 4; attempt++) {
    const port = await pickPort(attempt === 0 ? BASE_PORT : lastPort + 1)
    lastPort = port

    if (await spawnServer(entry, port) === 'ready') {
      serverPort = port
      if (port !== BASE_PORT) log(`port ${BASE_PORT} was busy — using ${port}`)
      log(`server ready on http://${HOST}:${port}`)
      // Only now does an exit mean something went wrong. Attaching this during
      // startup would make each failed attempt look like a crash and trigger a
      // rollback the retry is about to make unnecessary.
      server.once('exit', onServerExit)
      return
    }
    log(`server did not start on port ${port} — retrying`)
  }
  throw new Error(`the server would not start on any port from ${BASE_PORT}`)
}

/**
 * A server that dies on its own is either a bad update or a real crash.
 *
 * Dying during startup while running downloaded content means that content
 * cannot run: abandon it and fall back to what shipped in the app. Dying later
 * is an ordinary crash, so just restart it — the window stays open and the
 * session survives.
 */
async function onServerExit(code, signal) {
  if (stoppingServer || quitting) return
  const ranFor = Date.now() - serverStartedAt
  log(`server exited (code ${code}, signal ${signal}) after ${ranFor}ms`)

  if (ranFor < BOOT_GRACE && updater.isRunningDownloaded()) {
    updater.rollback(`server exited with code ${code} during startup`)
    notify({ state: 'rolled-back' })
    try {
      await startServer()
      win?.loadURL(`http://${HOST}:${serverPort}`)
      dialog.showMessageBox(win, {
        type: 'warning',
        message: 'That update did not work',
        detail: 'Deutsch Lernen has gone back to the version that shipped with the app. '
          + 'Your progress and your own words are untouched, and the next working update '
          + 'will be picked up automatically.',
        buttons: ['OK'],
      })
    } catch (e) {
      fatal(e)
    }
    return
  }

  try {
    await startServer()
    win?.loadURL(`http://${HOST}:${serverPort}`)
  } catch (e) {
    fatal(e)
  }
}

function stopServer() {
  if (!server) return
  stoppingServer = true
  try { server.kill() } catch {}
  server = null
}

function fatal(e) {
  log('fatal:', e.message)
  dialog.showErrorBox('Deutsch Lernen could not start', `${e.message}\n\nYour progress is safe in:\n${USER_DATA}`)
  app.exit(1)
}

// ─── WINDOW ───────────────────────────────────────────────────────────────────

const stateFile = join(USER_DATA, 'window-state.json')

const readWindowState = () => {
  try {
    const s = JSON.parse(readFileSync(stateFile, 'utf8'))
    // A window restored onto a monitor that is no longer attached is invisible
    // and looks exactly like the app failing to start.
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
      const visible = screen.getAllDisplays().some(({ workArea: a }) =>
        s.x < a.x + a.width && s.x + (s.width || 0) > a.x && s.y < a.y + a.height && s.y + (s.height || 0) > a.y)
      if (!visible) { delete s.x; delete s.y }
    }
    return s
  } catch { return {} }
}

const saveWindowState = () => {
  if (!win || win.isDestroyed() || win.isMinimized()) return
  try {
    writeFileSync(stateFile, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }), 'utf8')
  } catch {}
}

function createWindow() {
  const saved = readWindowState()

  win = new BrowserWindow({
    width: saved.width || 1200,
    height: saved.height || 820,
    x: saved.x,
    y: saved.y,
    // Above the 860px breakpoint in web/css/layout.css, deliberately. Below it
    // the sidebar becomes a phone-style bottom tab bar and .sidebar-top — which
    // is this window's only title bar and its only drag handle — is hidden, so
    // a narrower window would be one you cannot move.
    minWidth: 880,
    minHeight: 560,
    title: 'Deutsch Lernen',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111110' : '#faf9f7',
    // The app draws its own sidebar header; on macOS an inset traffic-light
    // strip reads as native without costing a title bar's worth of height.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      // Every one of these is already the default in Electron 43. They are
      // written out because this window loads content that was downloaded at
      // runtime, and a future default flipping the other way must be a
      // deliberate decision rather than a silent one.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })

  if (saved.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  for (const e of ['resize', 'move', 'close']) win.on(e, saveWindowState)
  win.on('closed', () => { win = null })

  // Every dictionary and conjugation link in the app is target="_blank". Without
  // this they replace the app with a web page and there is no way back.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).host !== `${HOST}:${serverPort}`) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })

  win.loadURL(`http://${HOST}:${serverPort}`)
}

// ─── UPDATES ──────────────────────────────────────────────────────────────────

const notify = (status) => {
  if (win && !win.isDestroyed()) win.webContents.send('dl:update-status', status)
}

async function checkForUpdates({ manual = false } = {}) {
  const status = await updater.check({ manual })
  if (manual && status.state === 'current') {
    // Silence is ambiguous for a button press — it looks like nothing happened.
    dialog.showMessageBox(win, {
      type: 'info',
      message: 'Deutsch Lernen is up to date',
      detail: `Nothing new in ${REPO.owner}/${REPO.name}.`,
      buttons: ['OK'],
    })
  }
  return status
}

// ─── MENU ─────────────────────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => checkForUpdates({ manual: true }) },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        ...(isMac ? [] : [{ label: 'Check for Updates…', click: () => checkForUpdates({ manual: true }) }]),
        { label: 'Study Folder', click: () => shell.openPath(USER_DATA) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    // Without this, Cmd-C and Cmd-V do not work in the typing and add-word
    // fields on macOS — the roles are what bind the shortcuts, not the OS.
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Deutsch Lernen on GitHub', click: () => shell.openExternal(REPO_URL) },
        { label: 'Report an Issue', click: () => shell.openExternal(`${REPO_URL}/issues`) },
      ],
    },
  ]))
}

// ─── LIFECYCLE ────────────────────────────────────────────────────────────────

// Two copies would race each other over progress.json and the port.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })

  app.whenReady().then(async () => {
    updater = new Updater({
      root: USER_DATA,
      bundled: BUNDLED,
      identity: IDENTITY,
      // `npm run app` serves the working tree. DL_DEV_USE_PAYLOAD=1 opts back
      // in, which is how the update path gets tested without a packaged build.
      useDownloads: app.isPackaged || Boolean(process.env.DL_DEV_USE_PAYLOAD),
      onStatus: notify,
      log,
    })

    try {
      await startServer()
    } catch (e) {
      // The bundled payload failing is unrecoverable; a downloaded one is not.
      if (updater.isRunningDownloaded()) {
        updater.rollback(`server did not start: ${e.message}`)
        try { await startServer() } catch (e2) { return fatal(e2) }
      } else {
        return fatal(e)
      }
    }

    buildMenu()
    createWindow()

    // Checking on launch is what makes this feel like it updates itself; the
    // interval only matters for a window left open for days.
    if (updater.prefs().autoUpdate) {
      setTimeout(() => checkForUpdates(), 4000)
      checkTimer = setInterval(() => { if (updater.isDue()) checkForUpdates() }, CHECK_INTERVAL)
    }

    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  })

  // ── IPC. Everything the renderer can ask for, and nothing that takes a path ──
  ipcMain.handle('dl:update-status', () => updater.status)
  ipcMain.handle('dl:update-check', () => checkForUpdates({ manual: true }))
  ipcMain.handle('dl:update-prefs', (_e, patch) => (patch ? updater.setPrefs(patch) : updater.prefs()))
  ipcMain.handle('dl:update-rollback', () => updater.rollback())
  ipcMain.handle('dl:restart', () => { quitting = true; stopServer(); app.relaunch(); app.exit(0) })
  ipcMain.handle('dl:info', () => ({
    version: app.getVersion(),
    // What is running, not what has been downloaded — after staging an update
    // those differ until the next restart.
    sha: updater.runningSha() || BUILD.sha || null,
    bundledSha: BUILD.sha || null,
    channel: updater.isRunningDownloaded() ? 'updated' : 'bundled',
    userData: USER_DATA,
    repo: REPO_URL,
    platform: process.platform,
    electron: process.versions.electron,
  }))
  ipcMain.handle('dl:open-user-data', () => shell.openPath(USER_DATA))

  /**
   * Quit only once the page has flushed.
   *
   * Progress is saved on a 2-second debounce, so quitting straight after an
   * answer would lose it. beforeunload is not reliable on quit, so the renderer
   * is asked directly and given a moment to reply — but only a moment: a page
   * that cannot answer must not be able to block the quit.
   */
  app.on('before-quit', (e) => {
    if (quitting || !win || win.isDestroyed()) return
    e.preventDefault()
    quitting = true
    let done = false
    const finish = () => { if (done) return; done = true; stopServer(); app.quit() }
    ipcMain.once('dl:flushed', finish)
    setTimeout(finish, 1500)
    win.webContents.send('dl:flush')
  })

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('will-quit', () => { clearInterval(checkTimer); stopServer() })
}
