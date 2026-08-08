/**
 * Keyboard rules that more than one place needs to agree on.
 *
 * The four typed modes each had their own copy of the same four-line keydown
 * handler. They agreed by accident, and the accident had a hole in it: nothing
 * checked `e.repeat`, so holding Enter fired submit, disabled the input, dropped
 * focus to <body>, and let the *next* auto-repeat through to the document
 * handler — which read it as "accept the rating and move on". You never saw the
 * answer to the card you had just got wrong.
 */

/**
 * Enter submits, exactly once, from inside a text input.
 *
 * stopPropagation is load-bearing: inside an input, digits are letters being
 * typed, not rating shortcuts, and Space is a space.
 */
export function bindTextSubmit(input, submit) {
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key !== 'Enter') return
    e.preventDefault()
    // The input-side half of study.js's phase guard. An auto-repeat is the
    // operating system talking, never the user.
    if (e.repeat) return
    submit()
  })
}
