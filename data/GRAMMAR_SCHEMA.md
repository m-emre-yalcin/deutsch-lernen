# Grammar lesson schema

Files live in `data/grammar/parts/` as `{ "lessons": [ ...lessons ] }` and are merged
into `data/grammar/lessons.json` by `tools/build-grammar.js`.

```jsonc
{
  "id": "akkusativ",                 // lowercase ascii slug, unique
  "number": 12,                      // display order, 1-40
  "title": "Akkusativ — the direct object",
  "level": "A1",                     // A0 | A1 | A2
  "group": "Cases",                  // Basics | Nouns | Cases | Verbs | Word order | Adjectives | Beyond
  "summary": "Who or what is receiving the action — and the only case that visibly changes.",

  "rule": "<p>…</p>",                // The explanation. LIMITED HTML ONLY:
                                     // <p> <strong> <em> <code> <ul> <li> <br>
                                     // Written for someone who does NOT know grammar
                                     // jargon. Explain "direct object" before using it.
                                     // 2-5 short paragraphs. Concrete, not academic.

  "tables": [                        // 0-3 tables. This is where cases/conjugations live.
    {
      "title": "The definite article by case",
      "headers": ["", "masculine", "feminine", "neuter", "plural"],
      "rows": [
        ["Nominativ", "der", "die", "das", "die"],
        ["Akkusativ", "den", "die", "das", "die"]
      ],
      "highlight": [[1, 1]]          // [rowIndex, colIndex] pairs to emphasise — the
                                     // cells that are the actual lesson. 0-indexed
                                     // over `rows`, col 0 is the row label.
    }
  ],

  "examples": [                      // 3-6. Everyday German, A0-A2 vocabulary.
    { "de": "Ich sehe den Mann.", "en": "I see the man.",
      "note": "Mann is what I see → Akkusativ → der becomes den." }
  ],

  "mistakes": [                      // 2-4. The errors an English/Turkish speaker
                                     // ACTUALLY makes. This is the most valuable field.
    { "wrong": "Ich sehe der Mann.", "right": "Ich sehe den Mann.",
      "why": "Only masculine changes in the accusative. der → den." }
  ],

  "drills": [                        // EXACTLY 8. Mix the types. Ordered easy → hard.
    { "type": "choice",              // pick one option
      "question": "Ich sehe ___ Mann.",
      "options": ["der", "den", "dem"],
      "answer": "den",
      "explain": "Masculine + accusative = den." },

    { "type": "fill",                // type the answer; ___ marks the gap
      "question": "Er kauft ___ Auto. (das)",
      "answer": "das",
      "accept": ["das"],             // optional extra accepted spellings
      "explain": "Neuter doesn't change in the accusative." },

    { "type": "order",               // drag/click words into the right order
      "words": ["Ich", "kaufe", "einen", "Apfel"],
      "answer": "Ich kaufe einen Apfel",
      "explain": "Subject, verb in position 2, then the object." }
  ],

  "keyWords": ["der", "den", "sehen"]   // ids from data/vocab/ this lesson exercises. May be [].
}
```

## Rules

1. **Explain the jargon.** The reader has never studied grammar formally. Before using
   "direct object", say what one is. Never assume "dative" means anything to them.
2. **Every drill needs a real `explain`** — one sentence saying *why*, not restating the answer.
3. **Exactly 8 drills**, mixing `choice`, `fill` and `order`.
4. `answer` for a `choice` drill MUST be one of its `options`, character for character.
5. `answer` for an `order` drill MUST be exactly the `words` joined by single spaces, in the
   correct order. The app shuffles them for display.
6. **Vocabulary in examples and drills stays A0-A2.** The lesson is about grammar, so an
   unknown word is pure noise.
7. **`mistakes` must be real** — the actual errors learners make, not invented ones.
8. HTML in `rule` is limited to the tags listed above. No attributes, no classes, no scripts.
