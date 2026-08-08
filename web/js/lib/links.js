/**
 * External lookup links.
 *
 * When a word won't stick, the fastest fix is usually seeing it somewhere else:
 * in a real sentence, spoken by a real person, or explained properly. These are
 * one click from every card.
 *
 * All free, none need an account.
 */

import { stripArticle } from './normalize.js'
import { deckLevels } from '../store.js'

const enc = encodeURIComponent

export function buildLinks(word) {
  const bare = stripArticle(word.word)
  const full = word.word
  const isVerb = word.partOfSpeech === 'verb'
  const isNoun = word.partOfSpeech === 'noun'

  const links = [
    {
      id: 'ai',
      label: 'Google AI',
      title: 'Ask Google AI Mode to explain this word',
      // udm=50 is Google's AI Mode. A framed question gets a far better answer
      // than just pasting the word in.
      url: `https://www.google.com/search?udm=50&q=${enc(
        `Explain the German word "${full}" to an A1 learner: meaning, ${
          isNoun ? 'why it takes this gender, its plural, ' : ''
        }${isVerb ? 'its conjugation, whether it is separable, ' : ''
        }when to use it, and 3 example sentences with English translations.`
      )}`,
    },
    {
      id: 'translate',
      label: 'Translate',
      title: 'Google Translate',
      url: `https://translate.google.com/?sl=de&tl=en&text=${enc(bare)}&op=translate`,
    },
    {
      id: 'deepl',
      label: 'DeepL',
      title: 'DeepL — usually better German than Google',
      url: `https://www.deepl.com/translator#de/en/${enc(bare)}`,
    },
    {
      id: 'reverso',
      label: 'In context',
      title: 'Reverso Context — the word in thousands of real sentences',
      url: `https://context.reverso.net/translation/german-english/${enc(bare)}`,
    },
    {
      id: 'youglish',
      label: 'Hear it',
      title: 'YouGlish — real Germans saying this word on video',
      url: `https://youglish.com/pronounce/${enc(bare)}/german`,
    },
    {
      id: 'forvo',
      label: 'Forvo',
      title: 'Forvo — native speaker pronunciations',
      url: `https://forvo.com/word/${enc(bare.toLowerCase())}/#de`,
    },
    {
      id: 'dictcc',
      label: 'dict.cc',
      title: 'dict.cc — the dictionary Germans actually use',
      url: `https://www.dict.cc/?s=${enc(bare)}`,
    },
    {
      id: 'linguee',
      label: 'Linguee',
      title: 'Linguee — bilingual example pairs',
      url: `https://www.linguee.com/german-english/search?query=${enc(bare)}`,
    },
    {
      id: 'dwds',
      label: 'DWDS',
      title: 'DWDS — the authoritative German dictionary',
      url: `https://www.dwds.de/wb/${enc(bare)}`,
    },
    {
      id: 'wiktionary',
      label: 'Wiktionary',
      title: 'Wiktionary — full declension and etymology',
      url: `https://de.wiktionary.org/wiki/${enc(bare)}`,
    },
  ]

  if (isVerb) {
    links.splice(3, 0, {
      id: 'verbformen',
      label: 'Conjugate',
      title: 'Verbformen — every form of this verb',
      url: `https://www.verbformen.de/konjugation/${enc(bare)}.htm`,
    })
  }

  if (isNoun) {
    links.splice(3, 0, {
      id: 'declension',
      label: 'Decline',
      title: 'Full declension table',
      url: `https://www.verbformen.de/deklination/substantive/${enc(bare)}.htm`,
    })
  }

  return links
}

/**
 * Ask Google AI Mode about a grammar point rather than a word.
 *
 * The level range comes from the deck rather than a hardcoded "A1-A2", so
 * adding a B1 file also stops the app quietly asking for beginner explanations
 * of intermediate grammar.
 */
export const grammarAiLink = (topic) => {
  const levels = deckLevels()
  const range = levels.length ? `${levels[0]}-${levels[levels.length - 1]}` : 'A1-A2'
  return `https://www.google.com/search?udm=50&q=${enc(
    `Explain German grammar: ${topic}. Give clear rules, a table, common mistakes English speakers make, and 5 examples with translations. Keep it at ${range} level.`
  )}`
}

/** Ask why a specific answer was wrong — the most useful link after a mistake. */
export const explainMistakeLink = (word, given, expected) =>
  `https://www.google.com/search?udm=50&q=${enc(
    `In German I wrote "${given}" but the correct answer is "${expected}" for "${word.translation}". Explain what I got wrong and how to remember it.`
  )}`

export const sentenceAiLink = (sentence) =>
  `https://www.google.com/search?udm=50&q=${enc(
    `Break down this German sentence word by word and explain its grammar to an A1 learner: "${sentence}"`
  )}`
