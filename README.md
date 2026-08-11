# Deutsch Lernen

A German A0–A2 study app. Download it, open it, start learning — no setup, no account, no cloud.

## Why

A basic tool I vibecoded for myself, to learn German efficiently. It's here in case it's useful to
someone else.

The word list covers the usual Goethe A1/A2 core plus everyday-admin vocabulary — Kaltmiete, Kaution,
Krankenkasse, Pfand, Handyvertrag, Termin, Bescheinigung.

No account, no subscription, no cloud. Your progress is a JSON file on your own disk. Nothing leaves
your laptop except fetching audio and pictures, and you can turn that off by prefetching once.

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
- **Updates itself** — new words and lessons arrive on their own, without downloading anything again

## Get it

Download from [**Releases**](https://github.com/m-emre-yalcin/deutsch-lernen/releases/latest):

| Platform | File |
| --- | --- |
| **macOS** (Apple silicon) | `Deutsch Lernen-*-mac-arm64.dmg` |
| **macOS** (Intel) | `Deutsch Lernen-*-mac-x64.dmg` |
| **Windows** | `Deutsch Lernen-*-win-x64.exe` |
| **Linux** | `Deutsch Lernen-*-linux-x64.AppImage` or `.deb` |

Open it and study. There is nothing to install alongside it — not even Node.

### First launch on macOS

The app is not signed with an Apple Developer ID (that's a $99/year account for a free study app), so
macOS will say it *"could not verify Deutsch Lernen is free of malware"* and refuse to open it. To
get past it, **once**:

**System Settings → Privacy & Security →** scroll down to **Security → Open Anyway** next to Deutsch
Lernen → confirm.

Right-click → Open no longer works for this; Apple removed that shortcut in macOS Sequoia. Every
launch after the first is normal.

Windows shows a similar SmartScreen warning: **More info → Run anyway**.

## How updating works

Most apps make you download a new installer. This one doesn't, because the part that changes is not
the app — it's the words.

The download gives you an Electron shell wrapped around the contents of this repository. On launch
and every few hours after, the app asks GitHub whether this repository has changed. If it has, it
downloads the new `web/`, `data/` and `server/` in the background — about a megabyte — and uses them
the next time you open it. So a word fixed here this morning is on your machine this afternoon, and
you never touch an installer again.

Some things worth knowing:

- **Nothing changes mid-session.** An update is only picked up on restart, so a lesson never shifts
  under you.
- **Your progress is never part of an update.** Your history, your streak and any words you've added
  live outside the app and are untouched by updates — and by deleting the app, for that matter.
- **A bad update can't break the app.** If updated code fails to start, the app puts back the version
  that shipped inside it, tells you, and won't try that broken version again.
- **You can turn it off.** Settings → App updates → uncheck *Keep the app up to date automatically*.
  There's an *Undo update* button there too.

**The honest caveat:** this means the app runs code downloaded from this repository, so you are
trusting whoever can push to it — the same trust you extend to any auto-updating app, except that
here it is worth stating plainly rather than burying. The app only ever talks to
`codeload.github.com` for this repository, only over HTTPS, only unpacks `web/`, `server/`,
`data/vocab/` and `data/grammar/`, and refuses any archive containing links, device files or paths
pointing outside its own folder. If you'd rather not, switch auto-updates off and it will only ever
run what you downloaded.

### Where your files live

| Platform | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/Deutsch Lernen/` |
| Windows | `%APPDATA%\Deutsch Lernen\` |
| Linux | `~/.config/Deutsch Lernen/` |

`progress.json` is the record, `backups/` holds a daily snapshot, `reviews.jsonl` has every rating
you've ever given, and `vocab/` holds words you added yourself. **Settings → App updates → Show my
files** opens it.

## Running from source instead

The command-line path is unchanged and still needs nothing installed but Node 18+:

```bash
git clone https://github.com/m-emre-yalcin/deutsch-lernen.git
cd deutsch-lernen
./start.sh
```

That starts a local server and opens `http://localhost:5555`. `Ctrl-C` when you're done. Run this way
it never auto-updates — `git pull` is the update. Progress lives in `data/` rather than in the
application-support folder, so the two are separate study histories.

Don't open `web/index.html` directly — the app needs the local server for word data, audio and
saving.

```bash
./start.sh --install     # adds a `german` command to your shell
./start.sh --prefetch    # download all audio + images, then work offline
./start.sh --port 6000   # if 5555 is taken
./start.sh --validate    # check the word files
```

Studying on your phone works from here too: the command-line server listens on your network, so
`http://<your-laptop>:5555` from the sofa is a home-screen app on iOS. (The desktop app deliberately
listens only on `127.0.0.1`.)

## Adding your own words

Easiest from inside the app: **Browse → + Add a word**. It's in your deck immediately, it lives in
your own folder, and no update can overwrite it.

In bulk, drop a JSON file into `data/vocab/` (from source) or the `vocab/` folder in your files
(desktop app), following [`data/SCHEMA.md`](data/SCHEMA.md), then run `node tools/validate.js`.
Editing existing files is safe — progress is keyed by word `id`, so fixing a translation never costs
you your history.

## Building the app yourself

```bash
npm install              # Electron + the packager. The app itself still has no dependencies.
npm run app              # run it from the working tree
npm run app:dist         # build installers for the machine you're on
```

`npm run app` always serves the working tree, so your edits show up rather than a download from
GitHub. To exercise the real update path, set `DL_DEV_USE_PAYLOAD=1`.

Releases are built by [GitHub Actions](.github/workflows/release.yml) on a `v*` tag. If the repository
has `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`
secrets, macOS builds are signed and notarized and the first-launch warning above disappears;
without them the build still succeeds, ad-hoc signed.

Most changes need no release at all — push to `main` and every installed copy picks it up.

## Layout

```text
start.sh       launcher for the command-line path
electron/      the desktop shell — window, server supervision, self-updater
server/        zero-dependency Node server — API, media proxy, atomic saves
data/vocab/    the words
data/grammar/  the lessons
web/           the app — plain ES modules, no framework
tools/         validate, dedupe, prefetch, icons, tests
```

The split that matters: `electron/` is the shell, and everything else is the payload the shell keeps
up to date. `web/` never knows which one it's running under — it checks for `window.deutschLernen`
and does nothing when it isn't there, so one copy serves both the browser and the app.

## Notes

- Speech uses your system's German voices via the Web Speech API, falling back to a Google TTS proxy.
  Pictures come from [Openverse](https://openverse.org) and Wikimedia Commons. All free, no API keys.
- `node tools/test.js` runs the unit tests and validates every word file. One browser test
  (`review log queued`) is timing-sensitive and flakes occasionally — it's the test, not the app.
- The desktop app runs everywhere Electron does. `start.sh` is macOS-flavoured (it uses `open`), and
  the available voices are whatever your OS ships.

MIT licensed. Take it, fork it, change the word list to whatever you're actually learning.
