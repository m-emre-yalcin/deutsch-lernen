/**
 * Media proxy + disk cache: audio (TTS) and images.
 *
 * Why this has to live on the server:
 *   - Google's TTS endpoint 403s without a browser User-Agent, and a page cannot
 *     set headers on <audio src="…">. Verified: with a UA it returns audio/mpeg.
 *   - Openverse and Wikimedia Commons send no Access-Control-Allow-Origin, so the
 *     browser cannot read their responses at all. Verified.
 *
 * Everything fetched is written to cache/, so the second play is instant and the
 * whole app keeps working on a plane with no wifi.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
const TIMEOUT = 12000

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 20)

async function fetchWithTimeout(url, opts = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeout || TIMEOUT)
  try {
    return await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, ...opts.headers } })
  } finally {
    clearTimeout(timer)
  }
}

export class MediaCache {
  constructor(root) {
    this.audioDir = join(root, 'cache', 'audio')
    this.imageDir = join(root, 'cache', 'images')
    this.metaFile = join(root, 'cache', 'images', '_index.json')
    mkdirSync(this.audioDir, { recursive: true })
    mkdirSync(this.imageDir, { recursive: true })
    this.imageIndex = this.#loadIndex()
  }

  #loadIndex() {
    try { return JSON.parse(readFileSync(this.metaFile, 'utf8')) } catch { return {} }
  }

  #saveIndex() {
    try { writeFileSync(this.metaFile, JSON.stringify(this.imageIndex, null, 2)) } catch {}
  }

  // ─── AUDIO ────────────────────────────────────────────────────────────────
  /**
   * German TTS as an mp3. Cached by (text, lang, speed).
   * Google's endpoint caps at ~200 chars, which covers every word and sentence here.
   */
  async audio(text, lang = 'de', speed = 1) {
    const clean = String(text || '').trim().slice(0, 200)
    if (!clean) throw new Error('empty text')

    const key = `${hash(`${clean}|${lang}|${speed}`)}.mp3`
    const path = join(this.audioDir, key)
    if (existsSync(path)) return { path, cached: true }

    const url = 'https://translate.google.com/translate_tts'
      + `?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}`
      + `&ttsspeed=${speed}&q=${encodeURIComponent(clean)}`

    const res = await fetchWithTimeout(url, { headers: { Referer: 'https://translate.google.com/' } })
    if (!res.ok) throw new Error(`tts upstream ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 500) throw new Error('tts returned an empty clip')
    writeFileSync(path, buf)
    return { path, cached: false }
  }

  // ─── IMAGES ───────────────────────────────────────────────────────────────
  /**
   * Find a picture for a word. Openverse first (better subject matching for
   * everyday objects), Wikimedia Commons as fallback. Result cached to disk.
   *
   * `query` should be the ENGLISH translation — searching Commons for "Apfel"
   * returns portraits of people surnamed Apfel; "apple" returns apples.
   */
  async image(wordId, query) {
    // The id becomes a filename. Reduce it to a safe slug so a crafted
    // ?id=../../something can never write outside cache/images/.
    wordId = String(wordId || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80)
    if (!wordId) throw new Error('bad id')

    const cached = this.imageIndex[wordId]
    if (cached) {
      const p = join(this.imageDir, cached.file)
      if (existsSync(p)) return { path: p, cached: true, attribution: cached.attribution }
    }

    const found = await this.#searchOpenverse(query) || await this.#searchCommons(query)
    if (!found) return null

    try {
      const res = await fetchWithTimeout(found.url, { timeout: 15000 })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 1000) return null

      const ext = (res.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg'
      const file = `${wordId}.${ext}`
      writeFileSync(join(this.imageDir, file), buf)

      this.imageIndex[wordId] = { file, attribution: found.attribution, source: found.source, ts: Date.now() }
      this.#saveIndex()
      return { path: join(this.imageDir, file), cached: false, attribution: found.attribution }
    } catch {
      return null
    }
  }

  async #searchOpenverse(query) {
    try {
      const url = 'https://api.openverse.org/v1/images/'
        + `?q=${encodeURIComponent(query)}&page_size=3&license_type=all-cc&mature=false`
      const res = await fetchWithTimeout(url)
      if (!res.ok) return null
      const data = await res.json()
      const hit = data.results?.find((r) => r.url)
      if (!hit) return null
      return {
        url: hit.thumbnail || hit.url,
        attribution: `${hit.title || query} — ${hit.creator || 'unknown'} (${hit.license || 'CC'})`,
        source: 'openverse',
      }
    } catch { return null }
  }

  async #searchCommons(query) {
    try {
      const url = 'https://commons.wikimedia.org/w/api.php'
        + `?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}`
        + '&gsrnamespace=6&gsrlimit=3&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=500&format=json'
      const res = await fetchWithTimeout(url)
      if (!res.ok) return null
      const data = await res.json()
      const pages = Object.values(data.query?.pages || {})
      const hit = pages.map((p) => p.imageinfo?.[0]).find((i) => i?.thumburl)
      if (!hit) return null
      return {
        url: hit.thumburl,
        attribution: `Wikimedia Commons (${hit.extmetadata?.LicenseShortName?.value || 'CC'})`,
        source: 'commons',
      }
    } catch { return null }
  }

  // ─── STATS ────────────────────────────────────────────────────────────────
  stats() {
    const size = (dir) => {
      try {
        const files = readdirSync(dir).filter((f) => !f.startsWith('_'))
        const bytes = files.reduce((s, f) => { try { return s + statSync(join(dir, f)).size } catch { return s } }, 0)
        return { count: files.length, mb: +(bytes / 1048576).toFixed(1) }
      } catch { return { count: 0, mb: 0 } }
    }
    return { audio: size(this.audioDir), images: size(this.imageDir) }
  }
}
