import { newCard, schedule, retrievability, previewIntervals, formatInterval, pickMode, AGAIN, HARD, GOOD, EASY } from '../../web/js/srs.js'

let pass = 0, fail = 0
const ok = (name, cond, detail='') => { cond ? pass++ : fail++; console.log(`${cond?'✓':'✗'} ${name}${detail?' — '+detail:''}`) }

// 1. new card, each rating
const n = newCard()
const r = {}
for (const g of [AGAIN, HARD, GOOD, EASY]) r[g] = schedule(n, g, { now: 0 })
ok('new+Again gives smallest stability', r[1].stability < r[2].stability && r[2].stability < r[3].stability && r[3].stability < r[4].stability,
   [1,2,3,4].map(g=>r[g].stability.toFixed(2)).join(' < '))
ok('new+Easy schedules furthest out', r[4].intervalDays > r[3].intervalDays, `easy=${r[4].intervalDays}d good=${r[3].intervalDays}d`)
ok('new+Again stays in learning', r[1].state === 'learning' && r[1].intervalDays === 0)
ok('difficulty inverse to rating', r[1].difficulty > r[4].difficulty, `again=${r[1].difficulty.toFixed(1)} easy=${r[4].difficulty.toFixed(1)}`)
ok('difficulty in 1..10', [1,2,3,4].every(g => r[g].difficulty>=1 && r[g].difficulty<=10))

// 2. retrievability decays
const DAY=86400000
let c = schedule(newCard(), GOOD, { now: 0 })
const r0 = retrievability(c, 0), rHalf = retrievability(c, c.stability*DAY/2), rFull = retrievability(c, c.stability*DAY)
ok('R starts at 1.0', Math.abs(r0-1) < 1e-9, r0.toFixed(4))
ok('R decays monotonically', r0 > rHalf && rHalf > rFull, `${r0.toFixed(3)} > ${rHalf.toFixed(3)} > ${rFull.toFixed(3)}`)
ok('R ~0.9 at one stability-interval', Math.abs(rFull-0.9) < 0.001, rFull.toFixed(4))

// 3. repeated Good grows stability, intervals expand
let card = newCard(), t = 0, ivs = []
for (let i=0;i<8;i++){ card = schedule(card, GOOD, { now: t }); ivs.push(card.intervalDays); t = card.due }
ok('8x Good expands intervals', ivs.every((v,i)=> i===0 || v>ivs[i-1]), ivs.join('d → ')+'d')
ok('8x Good reaches months', ivs[7] > 60, `${ivs[7]}d`)

// 4. lapse behaviour
const strong = { ...card }
const lapsed = schedule(strong, AGAIN, { now: t })
ok('lapse never raises stability', lapsed.stability <= strong.stability, `${strong.stability.toFixed(1)} → ${lapsed.stability.toFixed(1)}`)
ok('lapse increments counter + relearning', lapsed.lapses === (strong.lapses||0)+1 && lapsed.state==='relearning')
ok('lapse resets streak', lapsed.streak === 0)

// 5. Hard < Good < Easy on a mature card
const p = previewIntervals(card)
ok('Again<Hard<Good<Easy intervals', p[1]<=p[2] && p[2]<p[3] && p[3]<p[4], `${p[1]} ${p[2]} ${p[3]} ${p[4]}`)

// 6. same-day review doesn't balloon
const sameDay = schedule(card, GOOD, { now: card.lastReview + 3600000 })
ok('same-day review is damped', sameDay.stability < card.stability*1.5, `${card.stability.toFixed(1)} → ${sameDay.stability.toFixed(1)}`)

// 7. mode ladder
const w = { cloze:[{de:'a ___ b', answer:'x'}] }
ok('ladder: new → mc', pickMode(newCard(), w) === 'mc')
ok('ladder: S=1 → flashcard', pickMode({reps:1,stability:1}, w) === 'flashcard')
ok('ladder: S=5 → typing', pickMode({reps:3,stability:5}, w) === 'typing')
ok('ladder: S=20 → listening', pickMode({reps:5,stability:20}, w) === 'listening')
ok('ladder: S=60 → cloze', pickMode({reps:9,stability:60}, w) === 'cloze')
ok('ladder falls back w/o cloze data', pickMode({reps:9,stability:60}, {}) !== 'cloze')
ok('ladder respects disabled mode', pickMode({reps:3,stability:5}, w, {typing:false}) !== 'typing')

// 7b. ladder fallback must degrade to an EASIER mode, not the hardest one
{
  const w = { cloze:[{de:'a ___ b', answer:'x'}] }
  // A brand-new card with multiple choice switched off must not land on typing.
  const m = pickMode(newCard(), w, {mc:false})
  ok('mc off: new word falls to flashcard, not typing', m === 'flashcard', m)
  // A typing-level card with typing off should step down to flashcard.
  const m2 = pickMode({reps:3,stability:5}, w, {typing:false})
  ok('typing off: steps down to flashcard', m2 === 'flashcard', m2)
  // Only cloze left => cloze.
  const m3 = pickMode(newCard(), w, {mc:false,flashcard:false,typing:false,listening:false})
  ok('only cloze enabled => cloze', m3 === 'cloze', m3)
}

// 8. formatting
ok('formatInterval', formatInterval(0)==='<10m' && formatInterval(1)==='1d' && formatInterval(45)==='2mo' && formatInterval(400)==='1.1y')

// 9. no NaN anywhere over a long random walk
let rc = newCard(), tt = 0, clean = true
for (let i=0;i<400;i++){
  const g = 1 + Math.floor(Math.random()*4)
  rc = schedule(rc, g, { now: tt })
  if (!Number.isFinite(rc.stability)||!Number.isFinite(rc.difficulty)||!Number.isFinite(rc.due)) { clean=false; break }
  tt = rc.due
}
ok('400 random reviews stay finite', clean, `S=${rc.stability.toFixed(1)} D=${rc.difficulty.toFixed(1)}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
