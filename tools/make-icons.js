#!/usr/bin/env node
/**
 * Rasterise build/icon.svg into the icons electron-builder ships.
 *
 * Run this only when the icon itself changes — the outputs are committed, so a
 * normal build (and CI, which has no image tooling) never needs it:
 *
 *   node tools/make-icons.js
 *
 * Needs rsvg-convert (brew install librsvg). iconutil is part of macOS; on any
 * other platform the .icns step is skipped and the existing file is kept.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, 'build')
const SVG = join(BUILD, 'icon.svg')

const has = (cmd) => {
  try { execFileSync('command', ['-v', cmd], { shell: true, stdio: 'ignore' }); return true }
  catch { return false }
}

if (!existsSync(SVG)) {
  console.error(`✗ ${SVG} is missing.`)
  process.exit(1)
}
if (!has('rsvg-convert')) {
  console.error('✗ rsvg-convert not found. Install it with:  brew install librsvg')
  process.exit(1)
}

const png = (size, out) => {
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), SVG, '-o', out])
  return out
}

mkdirSync(BUILD, { recursive: true })

// electron-builder derives Windows .ico and Linux .png sizes from this one.
png(1024, join(BUILD, 'icon.png'))
console.log('✓ build/icon.png (1024×1024)')

// macOS wants a real .icns. iconutil builds it from a named .iconset directory.
if (process.platform === 'darwin' && has('iconutil')) {
  const set = join(BUILD, 'icon.iconset')
  rmSync(set, { recursive: true, force: true })
  mkdirSync(set, { recursive: true })
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    png(size, join(set, `icon_${size}x${size}.png`))
    // Retina variants are the same pixels under the @2x name macOS looks for.
    if (size >= 32) png(size, join(set, `icon_${size / 2}x${size / 2}@2x.png`))
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', join(BUILD, 'icon.icns')])
  rmSync(set, { recursive: true, force: true })
  console.log('✓ build/icon.icns')
} else {
  console.log('· skipping icon.icns (needs macOS + iconutil)')
}

// Windows .ico — electron-builder can generate one, but a hand-made multi-size
// file is sharper in the taskbar than its automatic downscale.
if (has('magick')) {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const tmp = sizes.map((s) => png(s, join(BUILD, `.ico-${s}.png`)))
  execFileSync('magick', [...tmp, join(BUILD, 'icon.ico')])
  for (const f of tmp) rmSync(f, { force: true })
  console.log('✓ build/icon.ico')
} else {
  console.log('· skipping icon.ico (needs ImageMagick) — electron-builder will derive one')
}
