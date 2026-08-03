import { checkGerman, checkEnglish, stripArticle, articleOf, expandUmlauts, splitCloze, editDistance } from '../../web/js/lib/normalize.js'
let pass=0, fail=0
const ok=(n,c,d='')=>{c?pass++:fail++;console.log(`${c?'✓':'✗'} ${n}${d?' — '+d:''}`)}

// exact
ok('exact match', checkGerman('das Haus','das Haus').correct)
ok('case-insensitive', checkGerman('das haus','das Haus').correct)
ok('trailing space ok', checkGerman('  das Haus  ','das Haus').correct)

// umlaut tolerance (the whole point)
ok('ue accepted for ü', checkGerman('die Tuer','die Tür').correct)
ok('ae accepted for ä', checkGerman('der Baecker','der Bäcker').correct)
ok('oe accepted for ö', checkGerman('der Loeffel','der Löffel').correct)
ok('ss accepted for ß', checkGerman('gross','groß').correct)
ok('real umlaut still works', checkGerman('die Tür','die Tür').correct)
ok('strict mode rejects ue', !checkGerman('die Tuer','die Tür',{strict:true}).correct)

// article grading — the key design decision
const wrongArt = checkGerman('der Haus','das Haus')
ok('wrong article => not correct', !wrongArt.correct)
ok('wrong article => word still recognised', wrongArt.bareCorrect)
ok('wrong article => articleCorrect false', wrongArt.articleCorrect===false)
ok('wrong article => helpful message', /das/.test(wrongArt.message||''), wrongArt.message)

const noArt = checkGerman('Haus','das Haus')
ok('missing article => still correct', noArt.correct)
ok('missing article => nudge message', /article/i.test(noArt.message||''), noArt.message)

// typos
const typo = checkGerman('das Huas','das Haus')
ok('transposition = close not correct', typo.close && !typo.correct)
const far = checkGerman('das Katze','das Haus')
ok('totally different = not close', !far.close && !far.correct)
ok('empty = wrong', !checkGerman('','das Haus').correct)

// verbs / adjectives (no article)
ok('verb exact', checkGerman('aufstehen','aufstehen').correct)
ok('verb typo close', checkGerman('aufsteen','aufstehen').close)

// punctuation
ok('punctuation ignored', checkGerman('das Haus.','das Haus').correct)

// English side
ok('en exact', checkEnglish('house',['house']).correct)
ok('en drops "to"', checkEnglish('go',['to go']).correct)
ok('en drops "the"', checkEnglish('the house',['house']).correct)
ok('en multi-gloss half', checkEnglish('husband',['man / husband']).correct)
ok('en wrong', !checkEnglish('car',['house']).correct)

// helpers
ok('stripArticle', stripArticle('die Häuser')==='Häuser')
ok('articleOf', articleOf('das Haus')==='das' && articleOf('schnell')===null)
ok('expandUmlauts', expandUmlauts('Tür groß')==='Tuer gross')
const sc = splitCloze('Ich wohne in einem ___ am Rand.')
ok('splitCloze', sc.before==='Ich wohne in einem ' && sc.after===' am Rand.')
ok('editDistance (transposition=1)', editDistance('haus','huas')===1 && editDistance('a','a')===0)
ok('editDistance caps', editDistance('abcdefgh','zzzzzzzz')>3)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
