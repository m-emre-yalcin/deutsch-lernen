/**
 * Minimal tar.gz reader — enough to unpack a GitHub source tarball, and nothing
 * more.
 *
 * Why hand-rolled: the whole point of this project is that there is nothing to
 * `npm install`. A dependency here would be a dependency inside the
 * auto-updater, which is the one component that must never break, because it is
 * what fixes every other component.
 *
 * Format: POSIX ustar, plus the two extensions `git archive` actually emits —
 * PAX extended headers for long paths, and a PAX *global* header whose
 * `comment` record holds the commit SHA. That last one is the reason this file
 * returns more than a file list: it lets the updater confirm which commit it
 * received without a second request to GitHub.
 */

import { gunzipSync } from 'node:zlib'

// A ustar header is one fixed 512-byte record. Offsets are absolute within it.
const BLOCK = 512
const F = {
  name: [0, 100],
  size: [124, 12],
  typeflag: [156, 1],
  magic: [257, 6],
  prefix: [345, 155],
}

// Ceilings, enforced while unpacking. gzip compresses better than 1000:1, so a
// download small enough to look harmless can still fill a disk.
const MAX_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 5000

const str = (buf, [off, len]) => {
  const slice = buf.subarray(off, off + len)
  // Fields are NUL-padded; a field used to its full width has no terminator.
  const end = slice.indexOf(0)
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8')
}

/**
 * Sizes are octal ASCII. GNU switches to base-256 (high bit of byte 0 set) for
 * sizes that don't fit in 11 octal digits — never the case for source files,
 * but misreading one desynchronises every entry after it, so it is handled
 * rather than assumed away.
 */
const readSize = (buf) => {
  const [off, len] = F.size
  const raw = buf.subarray(off, off + len)
  if (raw[0] & 0x80) {
    let n = BigInt(raw[0] & 0x7f)
    for (let i = 1; i < len; i++) n = (n << 8n) | BigInt(raw[i])
    if (n > BigInt(MAX_BYTES)) throw new Error('tar: entry larger than the size cap')
    return Number(n)
  }
  const text = raw.toString('utf8').replace(/[\0 ]/g, '')
  if (!text) return 0
  const n = parseInt(text, 8)
  if (!Number.isFinite(n) || n < 0) throw new Error(`tar: bad size field ${JSON.stringify(text)}`)
  return n
}

/**
 * Parse PAX records: `"LEN key=value\n"`, where LEN counts its own digits, the
 * space and the newline. Splitting on `\n` instead would break on any value
 * containing one.
 */
const paxRecords = (block) => {
  const out = {}
  let i = 0
  while (i < block.length) {
    const sp = block.indexOf(0x20, i)
    if (sp === -1) break
    const len = parseInt(block.subarray(i, sp).toString('ascii'), 10)
    if (!Number.isFinite(len) || len <= 0 || i + len > block.length) break
    const rec = block.subarray(sp + 1, i + len - 1).toString('utf8')
    const eq = rec.indexOf('=')
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1)
    i += len
  }
  return out
}

/**
 * Unpack a gzipped tar.
 *
 * Returns `{ files, comment }`, where `files` is every regular file as
 * `{ path, data }` and `comment` is the PAX global `comment` record — the
 * commit SHA, for a GitHub tarball.
 *
 * `path` is the archive's own name and is NOT yet trusted; `stripRoot` below
 * decides what is allowed to become a real path.
 */
export function readTarGz(gzBuffer) {
  const buf = gunzipSync(gzBuffer, { maxOutputLength: MAX_BYTES })
  const files = []
  let comment = null

  // Set by a GNU 'L' or PAX 'x' header, consumed by the entry that follows it.
  let pendingName = null
  let offset = 0
  let zeroBlocks = 0

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK)
    offset += BLOCK

    // Two consecutive all-zero blocks end the archive. One alone is padding
    // some writers emit mid-stream, so it is not enough to stop on.
    if (header.every((b) => b === 0)) {
      if (++zeroBlocks >= 2) break
      continue
    }
    zeroBlocks = 0

    // POSIX writes "ustar\0", GNU writes "ustar " — six bytes either way, so
    // the GNU form reads back as five characters and a trailing space once the
    // NUL padding is stripped. Comparing against two spaces silently rejected
    // every GNU archive.
    const magic = str(header, F.magic)
    if (magic !== 'ustar' && magic !== 'ustar ') {
      throw new Error(`tar: not a ustar archive (magic ${JSON.stringify(magic)}) at byte ${offset - BLOCK}`)
    }

    const size = readSize(header)
    const type = str(header, F.typeflag) || '0'
    const padded = Math.ceil(size / BLOCK) * BLOCK
    // A lying size field must not read past the buffer.
    if (offset + size > buf.length) throw new Error('tar: entry runs past the end of the archive')
    const body = buf.subarray(offset, offset + size)
    offset += padded

    // ── headers that describe the NEXT entry, or the archive as a whole ──
    if (type === 'L') { pendingName = body.toString('utf8').replace(/\0+$/, ''); continue }
    if (type === 'x') { pendingName = paxRecords(body).path ?? pendingName; continue }
    if (type === 'g') { comment = paxRecords(body).comment ?? comment; continue }
    if (type === 'K') continue                // long LINK name — links are dropped below anyway

    // The PAX override wins. This is not cosmetic: when `git archive` writes an
    // 'x' header it fills both the header's own name and the next entry's name
    // with the placeholders `<sha>.paxheader` / `<sha>.data`. Validating the
    // header name and then writing the PAX name would check a path that is not
    // the one used.
    const prefix = str(header, F.prefix)
    const name = pendingName ?? (prefix ? `${prefix}/${str(header, F.name)}` : str(header, F.name))
    pendingName = null

    if (type === '5') continue                // directory — implied by its files
    // Symlinks are skipped, never created. Skipping is what makes the two-step
    // escape impossible: without the link, a later entry named `link/x` just
    // creates a real directory. Dropping them also means a symlink appearing in
    // the repo one day cannot brick every installed copy's updater.
    if (type === '2') continue
    if (type === '1') throw new Error(`tar: refusing archive containing a hard link (${name})`)
    if (type === '3' || type === '4' || type === '6') {
      throw new Error(`tar: refusing archive containing a device or FIFO entry (${name})`)
    }
    if (type !== '0' && type !== '\0' && type !== '7') {
      throw new Error(`tar: unsupported entry type ${JSON.stringify(type)} (${name})`)
    }
    if (body.length !== size) throw new Error(`tar: truncated entry ${name}`)
    if (files.length >= MAX_ENTRIES) throw new Error(`tar: more than ${MAX_ENTRIES} entries`)

    files.push({ path: name, data: Buffer.from(body) })
  }

  if (!files.length) throw new Error('tar: archive contained no files')
  return { files, comment }
}

// Windows treats these as devices whatever the extension, and `:` opens an
// alternate data stream rather than a file. None can occur in this repo; all
// are rejected so an archive that is not what we think it is fails loudly.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * Drop the single wrapper directory GitHub wraps a source tarball in
 * (`<repo>-<ref>/…`) and reject anything that could escape a target directory.
 *
 * Rejecting rather than filtering is deliberate: an entry that looks like an
 * attempt to write outside the payload means the download is not what we asked
 * for, and the safe response is to distrust all of it rather than unpack the
 * rest.
 */
export function stripRoot(files) {
  const roots = new Set(files.map((f) => f.path.split('/')[0]))
  if (roots.size !== 1) {
    throw new Error(`tar: expected exactly one top-level directory, found ${roots.size}`)
  }

  return files.map((f) => {
    const rel = f.path.split('/').slice(1).join('/')
    if (!rel) throw new Error(`tar: entry is the root directory itself (${f.path})`)
    // A backslash is an ordinary filename character on POSIX and a separator on
    // Windows, so `..\..\evil` would slip past a '/'-only check on the one
    // platform where it matters.
    if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.includes('\\')) {
      throw new Error(`tar: refusing absolute or Windows-style path (${f.path})`)
    }
    for (const seg of rel.split('/')) {
      // Segment equality, not a substring test — "..foo" is a legal name.
      if (seg === '..' || seg === '.' || seg === '') {
        throw new Error(`tar: refusing path with a traversal segment (${f.path})`)
      }
      if (RESERVED.test(seg) || seg.includes(':') || /[. ]$/.test(seg)) {
        throw new Error(`tar: refusing path unusable on Windows (${f.path})`)
      }
    }
    if (rel.includes('\0')) throw new Error(`tar: refusing path containing NUL (${f.path})`)
    return { path: rel, data: f.data }
  })
}
