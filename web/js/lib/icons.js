/**
 * The icon set.
 *
 * Everything in the interface used to be an emoji: 🎯 for Study, ⚡ for Drills,
 * 🔥 on the streak, 🎉 on a good session. Emoji are somebody else's artwork —
 * they render in the OS's own colours at the OS's own weight, they ignore the
 * theme completely, they look different on every machine, and half of them are
 * a picture of a thing rather than a symbol for an action. A dartboard is not
 * what "study" looks like.
 *
 * These are 24×24 stroke paths drawn in `currentColor`, so an icon is always
 * exactly the colour and size of the text beside it and themes itself for free.
 *
 * They are inlined rather than sprited into index.html because several of them
 * are chosen at runtime (mode icons, verdict icons, empty states), and a
 * `<use href="#id">` reference to a symbol that isn't in the document yet fails
 * silently — you get an empty box and no error. A string always renders.
 *
 * Word emoji in `data/vocab/*.json` are deliberately untouched: those are
 * content, they're the picture for a concrete noun, and they do their job.
 */

const P = {
  // ── navigation ──
  study: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 18 9 5 9-5"/>',
  drills: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  grammar: '<path d="M4 19V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/><path d="M9 7h6"/>',
  browse: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  stats: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-6"/><path d="M22 20H2"/>',
  settings: '<path d="M4 6h10"/><path d="M18 6h2"/><path d="M4 12h4"/><path d="M12 12h8"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',

  // ── practice modes ──
  cards: '<rect x="3" y="6" width="13" height="15" rx="2"/><path d="M8 3h9a2 2 0 0 1 2 2v11"/>',
  list: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h4"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M18 10h.01"/><path d="M8 14h8"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2v-2Z"/><path d="M20 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2v-2Z"/>',
  blank: '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><path d="M12 21a3 3 0 0 1 0-6 2 2 0 0 0 0-4"/>',

  // ── actions & feedback ──
  volume: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  x: '<path d="M6 6 18 18"/><path d="M18 6 6 18"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  flame: '<path d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 1.5-4.5C9 9.5 8 8 8 6c2 1 3 0 4-4Z"/>',
  sparkle: '<path d="M12 3v6"/><path d="M12 15v6"/><path d="M3 12h6"/><path d="M15 12h6"/><path d="m6.5 6.5 3 3"/><path d="m14.5 14.5 3 3"/><path d="m17.5 6.5-3 3"/><path d="m9.5 14.5-3 3"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  slower: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chat: '<path d="M20 14a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8Z"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  chevronLeft: '<path d="m14 6-6 6 6 6"/>',
  chevronRight: '<path d="m10 6 6 6-6 6"/>',
  arrowRight: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
  arrowLeft: '<path d="M20 12H5"/><path d="m11 6-6 6 6 6"/>',

  // ── empty & done states ──
  coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M7 2v3"/><path d="M11 2v3"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 8 5-3 5 3-1.5-8"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  bandage: '<rect x="2" y="8" width="20" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M10 10h.01"/><path d="M14 14h.01"/><path d="M14 10h.01"/><path d="M10 14h.01"/>',
  sprout: '<path d="M12 21v-8"/><path d="M12 13C12 9 9 7 5 7c0 4 3 6 7 6Z"/><path d="M12 15c0-3.5 2.5-5.5 6-5.5 0 3.5-2.5 5.5-6 5.5Z"/>',
}

/**
 * `icon('check')` → an inline SVG string, sized to the current font.
 * Unknown names return '' rather than throwing: a missing icon should cost you
 * a glyph, not the whole card.
 */
export function icon(name, cls = '') {
  const path = P[name]
  if (!path) return ''
  return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`
}

export const hasIcon = (name) => Boolean(P[name])
