#!/usr/bin/env node
/**
 * Gender ground truth.
 *
 * Checks the deck against a hand-verified list of common nouns. A wrong gender
 * is the most expensive kind of error in this whole app — you drill it hundreds
 * of times and then have to unlearn it — and it's invisible to every structural
 * check, because "der Haus" is perfectly well-formed data.
 *
 * Add to TRUTH whenever you add words you're confident about.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const VOCAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'vocab')

const TRUTH = {
  // people & family
  Mann: 'der', Frau: 'die', Kind: 'das', Mädchen: 'das', Junge: 'der', Person: 'die',
  Vater: 'der', Mutter: 'die', Sohn: 'der', Tochter: 'die', Bruder: 'der', Schwester: 'die',
  Familie: 'die', Freund: 'der', Freundin: 'die', Nachbar: 'der', Kollege: 'der', Chef: 'der',
  Baby: 'das', Eltern: 'die', Name: 'der', Leute: 'die',

  // home
  Haus: 'das', Wohnung: 'die', Zimmer: 'das', Küche: 'die', Bad: 'das', Toilette: 'die',
  Tisch: 'der', Stuhl: 'der', Bett: 'das', Schrank: 'der', Sofa: 'das', Lampe: 'die',
  Tür: 'die', Fenster: 'das', Wand: 'die', Boden: 'der', Dach: 'das', Schlüssel: 'der',
  Garten: 'der', Balkon: 'der', Keller: 'der', Miete: 'die', Vermieter: 'der', Kaution: 'die',

  // food & drink
  Wasser: 'das', Brot: 'das', Milch: 'die', Butter: 'die', Käse: 'der', Ei: 'das',
  Fleisch: 'das', Fisch: 'der', Obst: 'das', Gemüse: 'das', Apfel: 'der', Banane: 'die',
  Kartoffel: 'die', Tomate: 'die', Zwiebel: 'die', Salat: 'der', Suppe: 'die', Zucker: 'der',
  Salz: 'das', Bier: 'das', Wein: 'der', Kaffee: 'der', Tee: 'der', Saft: 'der',
  Restaurant: 'das', Rechnung: 'die', Messer: 'das', Gabel: 'die', Löffel: 'der', Teller: 'der',
  Glas: 'das', Tasse: 'die', Frühstück: 'das', Mittagessen: 'das', Abendessen: 'das',

  // time
  Zeit: 'die', Jahr: 'das', Monat: 'der', Woche: 'die', Tag: 'der', Stunde: 'die',
  Minute: 'die', Sekunde: 'die', Morgen: 'der', Abend: 'der', Nacht: 'die', Uhr: 'die',
  Datum: 'das', Termin: 'der', Geburtstag: 'der', Wochenende: 'das',

  // city & travel
  Stadt: 'die', Dorf: 'das', Land: 'das', Straße: 'die', Platz: 'der', Weg: 'der',
  Bahnhof: 'der', Flughafen: 'der', Zug: 'der', Bus: 'der', Auto: 'das', Fahrrad: 'das',
  Fahrkarte: 'die', Reise: 'die', Urlaub: 'der', Hotel: 'das', Koffer: 'der', Ausweis: 'der',
  Kirche: 'die', Markt: 'der', Park: 'der', Brücke: 'die', Ecke: 'die',

  // work, money, bureaucracy
  Arbeit: 'die', Beruf: 'der', Büro: 'das', Firma: 'die', Geld: 'das', Bank: 'die',
  Konto: 'das', Preis: 'der', Kosten: 'die', Vertrag: 'der', Versicherung: 'die',
  Formular: 'das', Amt: 'das', Antrag: 'der', Unterschrift: 'die', Gebühr: 'die',
  Steuer: 'die', Gehalt: 'das', Kunde: 'der', Post: 'die', Brief: 'der', Paket: 'das',

  // health & body
  Arzt: 'der', Krankenhaus: 'das', Apotheke: 'die', Medikament: 'das', Schmerz: 'der',
  Kopf: 'der', Auge: 'das', Ohr: 'das', Nase: 'die', Mund: 'der', Zahn: 'der',
  Hand: 'die', Arm: 'der', Bein: 'das', Fuß: 'der', Rücken: 'der', Bauch: 'der',
  Herz: 'das', Blut: 'das', Haut: 'die', Haar: 'das', Gesundheit: 'die',

  // school & language
  Schule: 'die', Universität: 'die', Lehrer: 'der', Schüler: 'der', Student: 'der',
  Buch: 'das', Heft: 'das', Papier: 'das', Wort: 'das', Satz: 'der', Frage: 'die',
  Antwort: 'die', Sprache: 'die', Prüfung: 'die', Note: 'die', Kurs: 'der',

  // nature & animals
  Sonne: 'die', Mond: 'der', Himmel: 'der', Stern: 'der', Wetter: 'das', Regen: 'der',
  Schnee: 'der', Wind: 'der', Baum: 'der', Blume: 'die', Wald: 'der', Berg: 'der',
  See: 'der', Meer: 'das', Fluss: 'der', Hund: 'der', Katze: 'die', Vogel: 'der',
  Pferd: 'das', Tier: 'das', Luft: 'die', Feuer: 'das', Erde: 'die',

  // things & abstractions
  Ding: 'das', Sache: 'die', Problem: 'das', Idee: 'die', Grund: 'der', Beispiel: 'das',
  Leben: 'das', Welt: 'die', Musik: 'die', Film: 'der', Bild: 'das', Farbe: 'die',
  Telefon: 'das', Handy: 'das', Computer: 'der', Internet: 'das', Nachricht: 'die',
  Kleidung: 'die', Hose: 'die', Hemd: 'das', Schuh: 'der', Jacke: 'die', Tasche: 'die',
}

// Load the deck.
const seen = new Map()
for (const f of readdirSync(VOCAB).filter((f) => f.endsWith('.json')).sort()) {
  let data
  try { data = JSON.parse(readFileSync(join(VOCAB, f), 'utf8')) } catch { continue }
  for (const w of data.words || []) {
    if (w?.partOfSpeech === 'noun' && w.lemma && !seen.has(w.lemma)) {
      seen.set(w.lemma, { article: w.article, file: f, id: w.id })
    }
  }
}

const checked = []
const wrong = []
for (const [lemma, expected] of Object.entries(TRUTH)) {
  const got = seen.get(lemma)
  if (!got) continue
  checked.push(lemma)
  if (got.article !== expected) wrong.push({ lemma, got: got.article, expected, file: got.file, id: got.id })
}

for (const w of wrong) {
  console.log(`\x1b[31m✗ ${w.lemma}: "${w.got}" should be "${w.expected}"  (${w.file} → id "${w.id}")\x1b[0m`)
}

const notInDeck = Object.keys(TRUTH).length - checked.length
console.log(
  wrong.length
    ? `\n${checked.length - wrong.length} passed, ${wrong.length} failed`
    : `\x1b[32m✓ all ${checked.length} known genders correct\x1b[0m` +
      (notInDeck ? ` (${notInDeck} of the reference list not in the deck)` : '') +
      `\n\n${checked.length} passed, 0 failed`
)

process.exit(wrong.length ? 1 : 0)
