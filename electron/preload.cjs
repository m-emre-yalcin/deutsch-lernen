/**
 * The only bridge between the page and the app.
 *
 * CommonJS because a sandboxed preload always is, regardless of the "type":
 * "module" in package.json.
 *
 * What is exposed is deliberately narrow: status, a check, a rollback, a
 * restart, and the two preferences. No function here takes a path, a URL or
 * anything else the page chooses — the page renders content that was
 * downloaded from the internet, and this is the boundary that keeps that
 * content from reaching the filesystem.
 *
 * web/ checks for `window.deutschLernen` and does nothing when it is absent, so
 * the same files serve the browser (./start.sh) and the app.
 */

const { contextBridge, ipcRenderer } = require('electron')

/** Fan-out, so the sidebar and the Settings page can both listen. */
const listeners = new Set()
ipcRenderer.on('dl:update-status', (_e, status) => {
  for (const fn of listeners) { try { fn(status) } catch (e) { console.error(e) } }
})

contextBridge.exposeInMainWorld('deutschLernen', {
  /**
   * Plain value, not a promise, because the stylesheet depends on it: macOS
   * draws its window buttons on top of the page and the sidebar has to leave
   * room for them. Anything asynchronous here would land after the first paint
   * and move the layout under the user.
   */
  platform: process.platform,

  /** Version, content SHA, where your files live. */
  getInfo: () => ipcRenderer.invoke('dl:info'),

  getUpdateStatus: () => ipcRenderer.invoke('dl:update-status'),
  /** Returns an unsubscribe function, so a re-rendered view does not stack handlers. */
  onUpdateStatus: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  checkForUpdates: () => ipcRenderer.invoke('dl:update-check'),

  getPrefs: () => ipcRenderer.invoke('dl:update-prefs'),
  setPrefs: (patch) => ipcRenderer.invoke('dl:update-prefs', patch || {}),

  /** Back to the content that shipped inside the app. Never touches your progress. */
  rollback: () => ipcRenderer.invoke('dl:update-rollback'),
  restart: () => ipcRenderer.invoke('dl:restart'),
  openUserData: () => ipcRenderer.invoke('dl:open-user-data'),

  /**
   * Quitting waits on this. Progress saves on a debounce, so without a flush an
   * answer given a second before quitting would be lost.
   */
  onFlush: (fn) => ipcRenderer.on('dl:flush', async () => {
    try { await fn() } catch (e) { console.error(e) }
    ipcRenderer.send('dl:flushed')
  }),
})
