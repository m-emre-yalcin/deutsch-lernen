/**
 * Keeps the app's content up to date with the public GitHub repo, without
 * shipping a new binary.
 *
 * The app is two separable halves. The *shell* is Electron plus the few files
 * in this directory, and changes almost never. The *payload* — web/, the
 * vocabulary and grammar JSON, and the little HTTP server — is everything you
 * actually see, and changes constantly. Only the payload is pulled from GitHub,
 * so new words, new lessons and fixes arrive without anyone downloading a
 * 100 MB installer.
 *
 * ── How a check works ────────────────────────────────────────────────────────
 * Exactly one HTTPS request:
 *
 *   GET codeload.github.com/<owner>/<repo>/tar.gz/<branch>
 *   If-None-Match: <etag from last time>
 *
 * 304 means nothing has changed. 200 means it has, and the response *is* the
 * new payload — there is no separate "what's the latest version" call to get
 * out of sync with. Which commit it is comes from the archive itself: git
 * writes the commit SHA into the tarball's PAX global header, so no second
 * request is needed to find out.
 *
 * This deliberately avoids api.github.com. That API allows 60 requests an hour
 * per IP address for unauthenticated callers, and — contrary to the usual
 * advice — a conditional request that returns 304 still costs one of them
 * unless you send an Authorization header. codeload and its ETags are outside
 * that budget entirely, so this can never rate-limit a user, and there is no
 * token to ship.
 *
 * ── What is trusted, and what is checked ─────────────────────────────────────
 * This design runs code downloaded at runtime. That is the point of it, and it
 * is worth being plain about what that does and does not guarantee. HTTPS
 * proves the bytes came from GitHub; it does not prove they are good. Anyone
 * who can push to the repo can change what every installed copy runs. The
 * README says so in as many words, and Settings → App updates turns it off.
 *
 * Within that model, the checks that are worth making are made:
 *   - only ever this one repo, over HTTPS, and the final URL after any redirect
 *     must still be GitHub;
 *   - the archive is unpacked by tar.js, which refuses links, device nodes and
 *     any path that could escape the target directory;
 *   - only the five payload paths are extracted — nothing else in the repo can
 *     land on disk;
 *   - the unpacked tree must contain every file the app needs before it is
 *     allowed to become "current";
 *   - a payload whose server fails to start is marked bad and abandoned, and
 *     the copy that shipped inside the app is used instead.
 *
 * That last one is what makes this safe to leave switched on: a bad commit
 * costs one restart, not a broken install.
 */

import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, readdirSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { readTarGz, stripRoot } from './tar.js'

export const REPO = { owner: 'm-emre-yalcin', name: 'deutsch-lernen' }

// Everything the app needs and nothing else. A commit that adds a file outside
// these prefixes cannot put it on anyone's disk.
const PAYLOAD_PREFIXES = ['web/', 'server/', 'data/vocab/', 'data/grammar/']
const PAYLOAD_FILES = ['package.json']

// A tree missing any of these is a failed extraction, not a new version. The
// worst outcome would be a half-written payload surviving to the next launch,
// where it would look like the app itself was broken.
const REQUIRED = ['web/index.html', 'server/server.js', 'server/progress.js', 'server/media.js']

const HOSTS = new Set(['codeload.github.com', 'github.com', 'objects.githubusercontent.com'])
const UA = 'deutsch-lernen-updater'
const TIMEOUT = 60_000

/** Six hours. Frequent enough that a fix lands the same day, rare enough to be invisible. */
export const CHECK_INTERVAL = 6 * 60 * 60 * 1000

const readJson = (file, fallback) => {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

export class Updater {
  /**
   * @param root      <userData> — payloads and update state live under it
   * @param bundled   the payload that shipped inside the app; the fallback that
   *                  must always work
   * @param identity  changes when a new *binary* is installed, which retires
   *                  any payload downloaded by the previous one
   * @param onStatus  called with every status change, for the UI
   */
  constructor({ root, bundled, bundledSha = null, identity, useDownloads = true, onStatus = () => {}, log = console.log }) {
    this.bundled = bundled
    // Which commit the copy inside the app was built from. Without it, a fresh
    // install downloads the identical commit it already contains and then asks
    // to be restarted for a change nobody would be able to see.
    this.bundledSha = bundledSha
    this.identity = identity
    // Off during development, where "bundled" is the working tree: running a
    // payload downloaded from GitHub instead of the files being edited would
    // make every local change appear to do nothing. Checks still run and still
    // stage, so the update path itself stays testable.
    this.useDownloads = useDownloads
    this.onStatus = onStatus
    this.log = log

    this.dir = join(root, 'payload')
    this.stateFile = join(root, 'update-state.json')
    mkdirSync(this.dir, { recursive: true })

    this.state = {
      etag: null,
      sha: null,          // the payload `current` points at
      lastCheck: 0,
      autoUpdate: true,
      identity: null,     // which binary downloaded it
      failed: {},         // sha -> why it was abandoned
      ...readJson(this.stateFile, {}),
    }

    // A freshly installed binary brings its own payload, which is by definition
    // at least as new as anything the previous one had downloaded. Keeping the
    // old download would silently roll the app back on every upgrade.
    if (this.state.identity && this.state.identity !== identity) {
      this.log(`update: new build (${identity}) — discarding payload from ${this.state.identity}`)
      this.#reset()
    }
    this.state.identity = identity

    // Collect payloads superseded by a previous run. Here, before resolve() has
    // latched anything and before the server exists, is the only moment when
    // nothing on disk is in use and deleting is unambiguously safe.
    try { this.#prune(this.state.sha) } catch {}

    this.status = { state: 'idle', sha: this.state.sha, current: this.activeSha() }
    this.#save()
  }

  #save() {
    try { writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2) + '\n', 'utf8') }
    catch (e) { this.log(`update: could not save state — ${e.message}`) }
  }

  #reset() {
    this.state.etag = null
    this.state.sha = null
    this.state.failed = {}
    try { rmSync(this.dir, { recursive: true, force: true }) } catch {}
    mkdirSync(this.dir, { recursive: true })
  }

  #emit(status) {
    this.status = { ...status, current: this.activeSha() }
    try { this.onStatus(this.status) } catch {}
    return this.status
  }

  // ─── WHICH PAYLOAD RUNS ─────────────────────────────────────────────────────

  /** The SHA of the downloaded payload in use, or null when running the bundled one. */
  activeSha() {
    const sha = this.state.sha
    return sha && this.#isComplete(join(this.dir, sha)) ? sha : null
  }

  /**
   * The directory the server should be started from. Always returns something
   * runnable: an incomplete or missing download falls back to the copy inside
   * the app rather than failing.
   *
   * The answer is latched the first time it is asked, because everything else
   * here has to distinguish "the newest payload on disk" from "the payload this
   * process is actually running". They stop being the same the moment an update
   * is staged, and confusing the two means deleting files out from under a live
   * server, or blaming a commit that never ran for a failure.
   */
  resolve() {
    if (this.running === undefined) {
      const sha = this.useDownloads ? this.activeSha() : null
      this.running = sha
      this.runningDir = sha ? join(this.dir, sha) : this.bundled
    }
    return this.runningDir
  }

  /** True when the server is running downloaded code — the only case a rollback can help. */
  isRunningDownloaded() {
    return this.resolve() !== this.bundled
  }

  /**
   * The SHA of the code actually running, as opposed to the newest one on disk.
   * They differ between staging an update and restarting — and always differ in
   * development, where downloads are staged but never used.
   */
  runningSha() {
    this.resolve()
    return this.running || null
  }

  #isComplete(dir) {
    if (!existsSync(dir)) return false
    if (!REQUIRED.every((f) => existsSync(join(dir, f)))) return false
    // The deck is the app. An empty vocab directory would boot fine and show
    // nothing, which reads as data loss rather than a failed update.
    try {
      return readdirSync(join(dir, 'data', 'vocab')).some((f) => f.endsWith('.json'))
    } catch { return false }
  }

  // ─── CHECKING ───────────────────────────────────────────────────────────────

  /**
   * Ask GitHub whether the payload has changed, and if it has, unpack it ready
   * for the next launch. Never throws — a failed check is a status, because it
   * usually just means the laptop is offline.
   */
  async check({ branch = 'main', manual = false } = {}) {
    if (this.checking) return this.status
    this.checking = true
    this.#emit({ state: 'checking' })

    try {
      const url = `https://codeload.github.com/${REPO.owner}/${REPO.name}/tar.gz/${encodeURIComponent(branch)}`
      const headers = { 'User-Agent': UA }
      // Skip the ETag when a manual check asks — otherwise the button appears
      // to do nothing — and when the payload it refers to has gone missing.
      // Without that second case, a payload deleted or damaged on disk would be
      // met with a 304 forever and never re-fetched, leaving the app stuck on
      // the bundled copy with no way back except reinstalling.
      const staleEtag = this.state.sha && !this.#isComplete(join(this.dir, this.state.sha))
      if (this.state.etag && !manual && !staleEtag) headers['If-None-Match'] = this.state.etag

      const res = await this.#fetch(url, headers)

      this.state.lastCheck = Date.now()

      if (res.status === 304) {
        this.#save()
        return this.#emit({ state: 'current' })
      }
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
      if (!HOSTS.has(new URL(res.url).hostname)) {
        throw new Error(`unexpected redirect to ${new URL(res.url).hostname}`)
      }

      const etag = res.headers.get('etag')
      const body = Buffer.from(await res.arrayBuffer())
      this.#emit({ state: 'downloading' })

      const { files, comment } = readTarGz(body)
      // git puts the commit SHA in the archive's PAX global header. Falling back
      // to the digest of the bytes keeps every payload identifiable even if that
      // ever stops being true.
      const sha = /^[0-9a-f]{40}$/.test(comment || '')
        ? comment
        : createHash('sha256').update(body).digest('hex').slice(0, 40)

      if (this.state.failed[sha]) {
        this.log(`update: ${sha.slice(0, 7)} previously failed to start — staying put`)
        this.state.etag = etag
        this.#save()
        return this.#emit({ state: 'current' })
      }
      // Already running this commit — either as a download, or because it is
      // the one that shipped inside the app and no download is needed at all.
      if (sha === this.activeSha() || (!this.activeSha() && sha === this.bundledSha)) {
        this.state.etag = etag
        this.#save()
        return this.#emit({ state: 'current' })
      }

      try {
        this.#install(files, sha)
      } catch (e) {
        // Record it, or every check from now on downloads the same broken
        // archive in full and fails at exactly the same place.
        this.state.failed[sha] = `could not be unpacked: ${e.message}`
        this.state.etag = etag
        this.#save()
        throw e
      }

      this.state.etag = etag
      this.state.sha = sha
      this.#save()
      this.log(`update: ${sha.slice(0, 7)} staged — active on next launch`)
      return this.#emit({ state: 'ready', sha })
    } catch (e) {
      this.log(`update: check failed — ${e.message}`)
      return this.#emit({ state: 'error', error: e.message })
    } finally {
      this.checking = false
    }
  }

  async #fetch(url, headers) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT)
    try {
      return await fetch(url, { headers, signal: ctl.signal, redirect: 'follow' })
    } catch (e) {
      // AbortError's own message is "This operation was aborted", which tells a
      // user nothing about what went wrong.
      throw new Error(e.name === 'AbortError' ? 'the download timed out' : e.message)
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Write the payload out, then move it into place in one step.
   *
   * The staging directory is what makes this safe to interrupt: a crash or a
   * power cut mid-write leaves a `.staging-*` directory that nothing points at,
   * never a half-written payload that the next launch would try to run.
   */
  #install(files, sha) {
    const wanted = stripRoot(files).filter((f) =>
      PAYLOAD_PREFIXES.some((p) => f.path.startsWith(p)) || PAYLOAD_FILES.includes(f.path))
    if (!wanted.length) throw new Error('the download contained none of the app files')

    const staging = join(this.dir, `.staging-${sha.slice(0, 8)}-${process.pid}`)
    rmSync(staging, { recursive: true, force: true })

    try {
      for (const f of wanted) {
        const target = join(staging, f.path)
        mkdirSync(dirname(target), { recursive: true })
        // Tar mode bits are ignored on purpose — nothing here is executable, and
        // honouring setuid/setgid from a downloaded archive never ends well.
        writeFileSync(target, f.data, { mode: 0o644 })
      }
      if (!this.#isComplete(staging)) throw new Error('the download was missing files the app needs')

      const final = join(this.dir, sha)
      rmSync(final, { recursive: true, force: true })
      renameSync(staging, final)
      this.#prune(sha)
    } catch (e) {
      rmSync(staging, { recursive: true, force: true })
      throw e
    }
  }

  /**
   * Drop payloads nothing needs any more.
   *
   * `running` is spared, and that is the whole point of this method having a
   * second argument. Deleting it would pull the ground out from under a live
   * server: web/ is read from disk on every request and the deck is re-read
   * whenever a word is added, so the app would start 404ing its own pages and
   * report an empty deck mid-session. The superseded payload is collected on
   * the next launch instead, by #prune's other caller, when nothing has it open.
   */
  #prune(keep) {
    const spare = new Set([keep, this.running].filter(Boolean))
    for (const entry of readdirSync(this.dir)) {
      if (spare.has(entry)) continue
      try { rmSync(join(this.dir, entry), { recursive: true, force: true }) } catch {}
    }
  }

  // ─── RECOVERY ───────────────────────────────────────────────────────────────

  /**
   * Give up on the payload in use and go back to the one inside the app.
   *
   * Called automatically when a downloaded payload's server will not start, and
   * manually from Settings. `reason` is recorded so the same commit is not
   * downloaded and tried again on the next check.
   */
  rollback(reason = 'reverted by hand') {
    // Both, and deliberately. The running payload is the one that misbehaved —
    // blaming state.sha alone would condemn a commit that was only staged and
    // has never run. The staged one goes too, or "undo" would be undone again
    // by the next check a few hours later.
    for (const sha of new Set([this.runningSha(), this.state.sha].filter(Boolean))) {
      this.state.failed[sha] = reason
      this.log(`update: abandoning ${sha.slice(0, 7)} — ${reason}`)
    }
    this.state.sha = null
    // Drop the ETag too, or the next check returns 304 and the app would never
    // pick up the commit that fixes whatever went wrong.
    this.state.etag = null
    // Everything except what is open right now. Deleting the running payload
    // here would break the very session the user is trying to rescue; it is
    // collected on the next launch instead.
    this.#prune(null)
    this.#save()
    return this.#emit({ state: 'idle' })
  }

  // ─── PREFERENCES ────────────────────────────────────────────────────────────
  // Kept here, in <userData>/update-state.json, and deliberately NOT in
  // progress.json: that file is exported, imported and reset from the Settings
  // page, and "restore my progress from a backup" must not quietly turn
  // updates back on.

  prefs() {
    return {
      autoUpdate: this.state.autoUpdate !== false,
      lastCheck: this.state.lastCheck || 0,
      sha: this.runningSha(),
      pending: this.state.sha,
    }
  }

  setPrefs(patch = {}) {
    if (typeof patch.autoUpdate === 'boolean') this.state.autoUpdate = patch.autoUpdate
    this.#save()
    return this.prefs()
  }

  /** True when auto-update is on and the last check is old enough to repeat. */
  isDue() {
    return this.state.autoUpdate !== false && Date.now() - (this.state.lastCheck || 0) > CHECK_INTERVAL
  }
}
