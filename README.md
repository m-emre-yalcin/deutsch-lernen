# Deutsch Lernen

A German A0–A2 study app that runs on your own machine.

## Why

A basic tool I vibecoded for myself, to learn German efficiently. It's here in case it's useful to
someone else.

The word list covers the usual Goethe A1/A2 core plus everyday-admin vocabulary — Kaltmiete, Kaution,
Krankenkasse, Pfand, Handyvertrag, Termin, Bescheinigung.

No account, no subscription, no cloud. Progress is a JSON file in `data/`. Nothing leaves your laptop
except fetching audio and pictures, and you can turn that off by prefetching once.

## What's in it

- **2,683 words**, each with its article, plural, full conjugation, two example sentences and usage
  notes
- **7 practice modes** — multiple choice, flashcard, typing, listening, sentence gap, plus fast
  der/die/das and conjugation drills
- **36 grammar lessons**, 288 exercises — cases, word order, Perfekt, separable verbs, adjective
  endings
- **FSRS-5 scheduling** — the same spaced-repetition algorithm Anki uses, so words come back right
  before you'd forget them
- **Offline** once you've prefetched the audio and images

## Running it

Node 18+ is the only requirement. No dependencies, no build step, no `npm install` — Node has
everything this needs.

```bash
git clone https://github.com/m-emre-yalcin/deutsch-lernen.git
cd deutsch-lernen
./start.sh
```

That starts a local server and opens `http://localhost:5555`. `Ctrl-C` when you're done.

Don't open `web/index.html` directly — the app needs the local server for word data, audio and
saving.

```bash
./start.sh --install     # adds a `german` command to your shell
./start.sh --prefetch    # download all audio + images, then work offline
./start.sh --port 6000   # if 5555 is taken
./start.sh --validate    # check the word files
```

## Adding your own words

Easiest from inside the app: **Browse → + Add a word**. It lands in `data/vocab/00-my-words.json`
and is in your deck immediately.

In bulk, drop a JSON file into `data/vocab/` following [`data/SCHEMA.md`](data/SCHEMA.md), then run
`node tools/validate.js`. Editing existing files is safe — progress is keyed by word `id`, so fixing
a translation never costs you your history.

## Layout

```text
start.sh       launcher
server/        zero-dependency Node server — API, media proxy, atomic saves
data/vocab/    the words
data/grammar/  the lessons
web/           the app — plain ES modules, no framework
tools/         validate, dedupe, prefetch, tests
```

## Notes

- Speech uses your Mac's German voices via the Web Speech API, falling back to a Google TTS proxy.
  Pictures come from [Openverse](https://openverse.org) and Wikimedia Commons. All free, no API keys.
- `node tools/test.js` runs the unit tests and validates every word file. One browser test
  (`review log queued`) is timing-sensitive and flakes occasionally — it's the test, not the app.
- Built for macOS; the server and web app are portable, but `start.sh` uses `open` and the voices are
  the ones macOS ships.

MIT licensed. Take it, fork it, change the word list to whatever you're actually learning.
