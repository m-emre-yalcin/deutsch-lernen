/**
 * Small DOM helpers. No framework — just the three things a framework would
 * have given us: safe escaping, element building, and a toast.
 */

/** Escape anything that goes into innerHTML. Word data is ours, but notes and
 *  example sentences contain quotes and dashes, and one stray "<" shouldn't
 *  silently eat the rest of a card. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v
    else if (k === 'html') node.innerHTML = v
    else if (k === 'text') node.textContent = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v === true) node.setAttribute(k, '')
    else if (v !== false && v != null) node.setAttribute(k, v)
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue
    node.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return node
}

let toastTimer = null
export function toast(msg, { error = false, ms = 2600 } = {}) {
  const t = $('#toast')
  t.textContent = msg
  t.className = 'toast' + (error ? ' err' : '')
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, ms)
}

/** Fisher-Yates. */
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const sample = (arr, n) => shuffle(arr).slice(0, n)
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

export function articleClass(article) {
  return article ? `art-pill art-${article}` : 'art-pill'
}

/** "3 cards" / "1 card" */
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Debounce for search inputs. */
export function debounce(fn, ms = 180) {
  let t
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}
