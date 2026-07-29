/**
 * Progress persistence — atomic writes, daily backups, append-only review log.
 *
 * The whole point of this file is that your study history must survive:
 *   - a crash mid-write        → atomic temp+rename, never a half-written file
 *   - a bad app update         → daily backup snapshots, 30 kept
 *   - a corrupted progress.json→ automatic restore from the newest good backup
 *   - wanting to re-tune SRS   → every single rating appended to reviews.jsonl forever
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, unlinkSync, appendFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const EMPTY = () => ({
  version: 2,
  // Epoch, NOT now: the client keeps a localStorage mirror and takes whichever
  // side is newer. A fresh/corrupt server state stamped with the current time
  // would always win that comparison and silently erase the local copy — the
  // exact history this file exists to protect.
  updatedAt: new Date(0).toISOString(),
  cards: {},      // wordId -> FSRS card state
  gender: {},     // wordId -> gender-track state (nouns only)
  grammar: {},    // lessonId -> { seen, drills: {correct, total}, lastSeen }
  daily: {},      // 'YYYY-MM-DD' -> { reviews, newCards, correct, minutes, modes:{} }
  settings: {},
  stats: { totalReviews: 0, streak: 0, longestStreak: 0, lastStudyDate: null },
})

export class ProgressStore {
  /**
   * `dataDir` can be overridden so tests never touch real study history.
   * Vocabulary is always read from the real data/ — only what gets WRITTEN moves.
   */
  constructor(root, dataDir) {
    this.root = root
    this.dataDir = dataDir || join(root, 'data')
    this.file = join(this.dataDir, 'progress.json')
    this.backupDir = join(this.dataDir, 'backups')
    this.reviewLog = join(this.dataDir, 'reviews.jsonl')
    mkdirSync(this.backupDir, { recursive: true })
  }

  /** Read from disk. Falls back to the newest backup if the main file is corrupt. */
  read() {
    if (!existsSync(this.file)) return EMPTY()
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || !parsed.cards) throw new Error('shape')
      return { ...EMPTY(), ...parsed }
    } catch (e) {
      console.error(`  ⚠️  progress.json is unreadable (${e.message}) — trying backups…`)
      const restored = this.restoreFromBackup()
      if (restored) {
        console.error(`  ✓  restored from backup`)
        return restored
      }
      // Never silently discard: park the bad file so it can be inspected.
      const parked = `${this.file}.corrupt-${Date.now()}`
      try { copyFileSync(this.file, parked); console.error(`  →  bad file kept at ${parked}`) } catch {}
      return EMPTY()
    }
  }

  restoreFromBackup() {
    const backups = readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort().reverse()
    for (const b of backups) {
      try {
        const parsed = JSON.parse(readFileSync(join(this.backupDir, b), 'utf8'))
        if (parsed?.cards) return { ...EMPTY(), ...parsed }
      } catch { /* try the next one */ }
    }
    return null
  }

  /**
   * Atomic write: serialise to a temp file, fsync-free rename over the target.
   * rename(2) is atomic on the same filesystem, so a crash can never leave a
   * truncated progress.json — you either get the old file or the new one.
   *
   * Stale-write guard: a client that loaded long ago (an old tab, a laptop
   * waking from sleep) must not overwrite newer history. The client's own
   * updatedAt says which state it built on; if what's on disk is meaningfully
   * newer, the write is refused and the caller re-syncs.
   */
  write(state) {
    const current = this.read()
    const diskT = Date.parse(current.updatedAt || 0) || 0
    const clientT = Date.parse(state.updatedAt || 0) || 0
    // 90s of slack covers clock skew and the client's save debounce. Beyond
    // that, the disk is genuinely ahead — someone else wrote real progress.
    if (diskT > clientT + 90_000 && Object.keys(current.cards || {}).length > 0) {
      const err = new Error('stale write refused: server has newer progress')
      err.code = 'STALE_WRITE'
      err.serverState = current
      throw err
    }

    state.updatedAt = new Date().toISOString()
    state.version = 2

    this.backupIfNewDay()

    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, this.file)
    return state
  }

  /** One snapshot per day, taken from the *previous* contents before overwriting. */
  backupIfNewDay() {
    if (!existsSync(this.file)) return
    const today = new Date().toISOString().slice(0, 10)
    const target = join(this.backupDir, `progress-${today}.json`)
    if (existsSync(target)) return
    try {
      // Never let a corrupt file become the day's only backup — that would
      // poison the very snapshot restore-from-backup depends on.
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || !parsed.cards) return
      copyFileSync(this.file, target)
      this.pruneBackups()
    } catch (e) {
      console.error('  ⚠️  backup skipped (file unreadable):', e.message)
    }
  }

  pruneBackups(keep = 30) {
    const all = readdirSync(this.backupDir).filter((f) => /^progress-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    for (const old of all.slice(0, Math.max(0, all.length - keep))) {
      try { unlinkSync(join(this.backupDir, old)) } catch {}
    }
  }

  /**
   * Append-only review log. One JSON object per line, never rewritten.
   * This is the raw history — stats, heatmaps and any future SRS re-tuning read
   * from here, so it stays useful even if progress.json is ever reset.
   */
  logReviews(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return 0
    const lines = entries.map((e) => JSON.stringify({
      t: e.t || Date.now(),
      id: e.id,
      mode: e.mode,
      rating: e.rating,
      correct: e.correct ?? null,
      ms: e.ms ?? null,
      answer: e.answer ?? null,
    })).join('\n') + '\n'
    appendFileSync(this.reviewLog, lines, 'utf8')
    return entries.length
  }

  readReviewLog(limit = 50000) {
    if (!existsSync(this.reviewLog)) return []
    const lines = readFileSync(this.reviewLog, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  }

  listBackups() {
    return readdirSync(this.backupDir)
      .filter((f) => f.endsWith('.json'))
      .sort().reverse()
      .map((f) => ({ file: f, date: f.replace(/^progress-|\.json$/g, '') }))
  }
}
