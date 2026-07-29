# Vocabulary entry schema — v2

Every file in `data/vocab/` is `{ "category": "...", "words": [ ...entries ] }`.
Every entry MUST have every key below. Use `null` / `[]` / `{}` for "not applicable" — never omit a key.

```jsonc
{
  "id": "haus",                    // lowercase ascii slug, unique across ALL files.
                                   // umlauts transliterated: ä→ae ö→oe ü→ue ß→ss
                                   // verbs: infinitive slug ("aufstehen"), phrases: kebab ("wie-gehts")
  "word": "das Haus",              // EXACTLY as shown on the card front.
                                   //   nouns  → "das Haus"      (article ALWAYS included)
                                   //   verbs  → "wohnen"        (bare infinitive, no "to")
                                   //   others → "schnell"
  "lemma": "Haus",                 // the bare headword, no article. Used for TTS/search/cloze matching.
  "translation": "house",          // primary English meaning, lowercase unless a proper noun
  "translations": ["house", "home"], // 1-3 accepted English meanings (first == translation)
  "level": "A1",                   // "A0" | "A1" | "A2"
                                   //   A0 = survival, day-one, absolute beginner
                                   //   A1 = Goethe A1 core
                                   //   A2 = Goethe A2 core
  "category": "Home",              // matches the file's category field
  "partOfSpeech": "noun",          // noun|verb|adjective|adverb|preposition|conjunction|
                                   // pronoun|article|numeral|interjection|phrase
  "frequency": 210,                // 1-3000, LOWER = more common/useful. Drives study order.
                                   // Be honest: "das Haus" ~200, "der Kugelschreiber" ~2400

  // ---- NOUNS ONLY (null for everything else) ----
  "gender": "n",                   // "m" | "f" | "n"
                                   // EXCEPTION: plural-only nouns (die Eltern, die
                                   // Geschwister, die Leute, die Ferien) have NO singular
                                   // gender — use gender: null with article: "die".
  "article": "das",                // "der" | "die" | "das" — MUST agree with gender
  "plural": "die Häuser",          // WITH "die". Use "—" if no plural (e.g. "die Milch")

  // ---- VERBS ONLY (null / false for everything else) ----
  "separable": false,              // true for auf|stehen, an|rufen, ein|kaufen …
  "auxiliary": "haben",            // "haben" | "sein" — for the Perfekt
  "reflexive": false,              // true for sich freuen, sich waschen …
  "cases": [],                     // cases the verb governs beyond a plain accusative object:
                                   // ["dat"] for helfen/danken/gehören, ["akk","dat"] for geben
  "forms": {                       // nouns: {} or {"genitiv": "des Hauses"}
    "ich": "wohne", "du": "wohnst", "er": "wohnt",       // verbs: ALL SIX present forms,
    "wir": "wohnen", "ihr": "wohnt", "sie": "wohnen",    // irregular stems included (du fährst)
    "praeteritum": "wohnte",                              // 3rd person singular
    "perfekt": "hat gewohnt",                             // aux + participle
    "imperativ": "wohn(e)!"
  },                               // adjectives: {"komparativ": "schneller", "superlativ": "am schnellsten"}

  // ---- ALL ENTRIES ----
  "example_sentences": [           // EXACTLY 2. Natural, A0-A2 level, everyday German.
    { "de": "Das Haus ist groß.", "en": "The house is big." },
    { "de": "Wir kaufen ein Haus in Berlin.", "en": "We are buying a house in Berlin." }
  ],
  "cloze": [                       // EXACTLY 1. A DIFFERENT sentence from the examples.
    { "de": "Ich wohne in einem ___ am Stadtrand.",   // ___ marks the gap (3 underscores)
      "answer": "Haus",            // the EXACT string that replaces ___ (inflected as needed)
      "en": "I live in a house on the edge of town." }
  ],
  "notes": "Neuter despite ...",   // usage tip, false friend, or common mistake. null if nothing useful.
  "mnemonic": "HAUS ~ 'house'",    // memory hook, esp. for gender. null if forced.
  "germany_context": "…",          // ONLY when there's a real practical fact about life in Germany
                                   // (Pfand, Anmeldung, Termin culture, Sonntag closures). Else null.
  "emoji": "🏠",                   // ONE emoji. null if nothing fits — do NOT force it.
  "imageable": true,               // true ONLY for concrete, picturable nouns (apple, dog, chair).
                                   // false for abstractions, verbs, adjectives, function words.
  "tags": ["home", "essential"],   // freeform lowercase
  "synonyms": [],                  // GERMAN words, [] if none
  "antonyms": [],                  // GERMAN words, [] if none
  "related": []                    // ids of related entries, [] if none
}
```

## Hard rules

1. **Article always on nouns.** `"word": "das Haus"`, never `"Haus"`. `article` must agree with `gender`
   (m→der, f→die, n→das).
2. **Genders must be correct.** A wrong gender learned now is expensive to unlearn. If unsure, verify.
3. **`cloze.answer` must appear verbatim** in `cloze.de` where `___` sits. Substituting it back must
   produce a grammatical sentence — inflect it (`Häuser`, `Hauses`, `wohnst`) if the slot requires it.
4. **Example sentences must contain the word**, in some inflected form.
5. **Exactly 2 examples, exactly 1 cloze.** No more, no fewer.
6. **All six present-tense forms on every verb**, including irregular stems (`du fährst`, `er nimmt`).
7. **Unique ids.** Never reuse an id from another file.
8. **No English in `de` fields**, no German in `en` fields.
9. **A0 means day-one survival** — greetings, ja/nein, ich/du, numbers, "Wo ist …?". Reserve it for
   words you'd need in your first 48 hours.
10. **Real, current German.** Everyday register, not textbook-stiff, not slang.
