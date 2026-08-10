#!/usr/bin/env node
/**
 * Record which commit the bundled payload came from.
 *
 * The app needs this to tell its own content apart from content it downloaded.
 * When a new version is installed, anything the previous version had pulled
 * from GitHub is discarded — otherwise installing a newer app could leave you
 * running older words and lessons than the ones inside it, which looks exactly
 * like the update having gone backwards.
 *
 * Written by `npm run app*`, never committed. A missing file is fine: the app
 * falls back to comparing versions alone.
 */

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const git = (...args) => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() }
  catch { return null }
}

// GitHub Actions checks out a detached HEAD, where GITHUB_SHA is the honest
// answer and `git rev-parse` may point at a merge commit that exists nowhere.
const sha = process.env.GITHUB_SHA || git('rev-parse', 'HEAD')
const { version } = JSON.parse(
  execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { cwd: ROOT, encoding: 'utf8' }))

const stamp = {
  sha: sha || null,
  version,
  builtAt: new Date().toISOString(),
  // Uncommitted work does not match any commit on GitHub, so the updater must
  // not treat this build as "already at <sha>" and skip the first real update.
  dirty: Boolean(git('status', '--porcelain')),
}

writeFileSync(join(ROOT, 'electron', 'bundled.json'), JSON.stringify(stamp, null, 2) + '\n', 'utf8')
console.log(`✓ electron/bundled.json — ${stamp.version} @ ${(stamp.sha || 'unknown').slice(0, 7)}${stamp.dirty ? ' (dirty)' : ''}`)
