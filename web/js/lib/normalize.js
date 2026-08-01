/**
 * Answer checking for typed input.
 *
 * The hard part is being strict about German while being fair about keyboards.
 * On a US layout "ü" is genuinely awkward, so `ue` must count — but "gross" for
 * "groß" is a real spelling you'd write in Germany anyway, and "Haus" vs "haus"
 * matters less than getting the article right. Every judgement here is aimed at
 * "would a German understand and accept this in writing?"
 */

const UMLAUT_MAP = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' }

export const ARTICLE_RE = /^(der|die|das)\s+/i

/** "die Häuser" → "Häuser" */
export const stripArticle = (s) => String(s || '').replace(ARTICLE_RE, '').trim()

/** "die Häuser" → "die" (or null) */
export function articleOf(s) {
  const m = String(s || '').match(ARTICLE_RE)
  return m ? m[1].toLowerCase() : null
}

/** ü → ue, ß → ss. Lets a US keyboard type German. */
export const expandUmlauts = (s) => String(s || '').replace(/[äöüßÄÖÜ]/g, (c) => UMLAUT_MAP[c] || c)

/** Everything that shouldn't change whether an answer is right. */
export function normalize(s, { strict = false } = {}) {
  let out = String(s || '')
    .trim()
    .toLowerCase()
    // Disambiguators and placeholders are display furniture, not the answer:
    // "Sie (formell)" is answered by typing "Sie", "Ich hätte gern …" by the
    // phrase without its ellipsis.
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[…]/g, ' ')
    .replace(/\.\.\./g, ' ')
    .replace(/[.,!?;:„“”"'`´]/g, '')   // punctuation, incl. German quotes
    .replace(/\s+/g, ' ')
    .trim()

  if (!strict) out = expandUmlauts(out)
  return out
}

/**
 * Damerau-Levenshtein (optimal string alignment), capped.
 *
 * Counts an adjacent transposition as ONE edit, not two. That matters a lot
 * here: "Huas" for "Haus" is the single most common way to mistype a word, and
 * plain Levenshtein scores it 2, which would push it past the typo threshold
 * and mark a word you clearly know as wrong.
 */
export function editDistance(a, b, cap = 3) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > cap) return cap + 1

  // Three rows: two back for the transposition check.
  let prev2 = null
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(
        prev[j] + 1,        // deletion
        cur[j - 1] + 1,     // insertion
        prev[j - 1] + cost, // substitution
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1)   // transposition
      }
      cur[j] = v
      best = Math.min(best, v)
    }
    if (best > cap) return cap + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

/**
 * Grade a typed German answer.
 *
 * Returns { correct, close, articleCorrect, articleExpected, articleGiven, message }
 *
 * `close` means a typo, not a wrong answer — the UI treats that as "almost",
 * shows the correct spelling, and lets you decide rather than marking you wrong
 * for a slipped finger.
 */
export function checkGerman(input, expected, opts = {}) {
  const strict = opts.strict || false
  const raw = String(input || '').trim()
  const target = String(expected || '').trim()

  const expectedArticle = articleOf(target)
  const givenArticle = articleOf(raw)

  const expectedBare = stripArticle(target)
  const givenBare = stripArticle(raw)

  const nExpected = normalize(expectedBare, { strict })
  const nGiven = normalize(givenBare, { strict })

  const bareCorrect = nGiven === nExpected
  const distance = bareCorrect ? 0 : editDistance(nGiven, nExpected)
  const close = !bareCorrect && distance <= (nExpected.length > 6 ? 2 : 1) && nGiven.length > 0

  // Article is graded separately: getting "Haus" right but "der Haus" wrong is
  // a different mistake from not knowing the word, and should read that way.
  let articleCorrect = null
  if (expectedArticle) {
    articleCorrect = givenArticle ? givenArticle === expectedArticle : null
  }

  const correct = bareCorrect && articleCorrect !== false

  let message = null
  if (correct && articleCorrect === null && expectedArticle) {
    message = `Right — but the article is “${expectedArticle}”. Try to type it every time.`
  } else if (bareCorrect && articleCorrect === false) {
    message = `The word is right, but it's “${expectedArticle} ${expectedBare}”, not “${givenArticle}”.`
  } else if (close) {
    message = `Almost — you wrote “${raw}”, it's “${target}”.`
  }

  return {
    correct,
    close,
    bareCorrect,
    distance,
    articleCorrect,
    articleExpected: expectedArticle,
    articleGiven: givenArticle,
    message,
    expected: target,
    given: raw,
  }
}

/** Grade an English answer — looser, since we're testing recall not vocabulary. */
export function checkEnglish(input, accepted = []) {
  const n = normalize(input)
  if (!n) return { correct: false, close: false }

  const options = accepted.flatMap((a) => {
    const base = normalize(a)
    // "to go" / "go", "the house" / "house" — articles and infinitive markers are noise
    return [base, base.replace(/^(to|the|a|an)\s+/, '')]
  })

  if (options.includes(n) || options.includes(n.replace(/^(to|the|a|an)\s+/, ''))) {
    return { correct: true, close: false }
  }
  // A multi-meaning gloss like "man / husband" — accept either half.
  for (const opt of options) {
    for (const part of opt.split(/\s*[/,;]\s*/)) {
      if (part && normalize(part) === n.replace(/^(to|the|a|an)\s+/, '')) {
        return { correct: true, close: false }
      }
    }
  }
  const close = options.some((o) => editDistance(n, o) <= 2)
  return { correct: false, close }
}

/**
 * Character-level diff for showing what went wrong.
 * Returns [{ ch, ok }] over the *expected* string — or [] when the two
 * strings can't be aligned position-by-position.
 *
 * Alignment is only meaningful when both sides have the same length under a
 * length-preserving comparison (lowercase, no umlaut expansion). Running it
 * through the ue→ü-tolerant normalizer shifted every index after an umlaut
 * and painted the RIGHT letters red. An absent diff beats a lying one — the
 * verdict line already shows the correct spelling.
 */
export function diffChars(given, expected) {
  const g = String(given || '').trim().toLowerCase()
  const e = String(expected || '').trim().toLowerCase()
  if (g.length !== e.length) return []
  const out = []
  for (let i = 0; i < expected.length; i++) {
    out.push({ ch: expected[i], ok: g[i] === e[i] })
  }
  return out
}

/** Turn "Ich wohne in einem ___." into parts for rendering an inline input. */
export function splitCloze(sentence) {
  const idx = String(sentence || '').indexOf('___')
  if (idx === -1) return { before: sentence, after: '' }
  return { before: sentence.slice(0, idx), after: sentence.slice(idx + 3) }
}
