import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShotlist, datelineDate, localDate, languageName, shotlistName, shotsFor, markHighlights, normalizeTitle, normalizeName, normalizeLanguage } from '../public/shotlist.js';
import { suggestTitle } from '../lib/title.js';

const trump = { platform: 'truth', title: 'US PRESIDENT', name: 'Donald Trump', date: '2026-10-25', language: 'English' };

test('dates: the instant is read in the poster\'s time zone, then written as a dateline', () => {
  // Trump's post: 00:00:09 UTC on 26 Oct is 8pm on 25 Oct in New York
  assert.equal(localDate('2026-10-26T00:00:09.000Z', 'America/New_York'), '2026-10-25');
  assert.equal(localDate('2026-10-26T00:00:09.000Z', 'UTC'), '2026-10-26');
  assert.equal(datelineDate('2026-10-25'), 'OCTOBER 25, 2026');
  assert.equal(datelineDate('2026-06-04'), 'JUNE 4, 2026');
  assert.equal(datelineDate('nonsense'), '');
  assert.equal(localDate('not a date'), '');
});

test('languages: every language is named, including English; "no language" codes are left blank', () => {
  assert.equal(languageName('en'), 'English');
  assert.equal(languageName('es'), 'Spanish');
  assert.equal(languageName('zh'), 'Chinese');
  assert.equal(languageName('pt-BR'), 'Brazilian Portuguese');
  for (const c of ['und', 'zxx', 'qme', '', undefined]) assert.equal(languageName(c), '');
});

test('names: first name only, no emoji, no middle initial, capitals', () => {
  assert.equal(shotlistName('Donald J. Trump'), 'DONALD TRUMP');
  assert.equal(shotlistName('Volodymyr Zelenskyy / Володимир Зеленський'), 'VOLODYMYR ZELENSKYY');
  assert.equal(shotlistName('Anthony Albanese 🇦🇺'), 'ANTHONY ALBANESE');
  assert.equal(shotlistName('Miguel Díaz-Canel Bermúdez'), 'MIGUEL DÍAZ-CANEL BERMÚDEZ');
});

test('shots: a zoom or a zoom+scroll is one continuous shot; a scroll after a cut is two', () => {
  assert.equal(shotsFor({}).length, 1);
  assert.equal(shotsFor({ zoom: true }).length, 1);
  assert.equal(shotsFor({ zoom: true, scroll: true }).length, 1);
  assert.equal(shotsFor({ scroll: true }).length, 2);
});

test('the whole post is quoted once: on the scroll shot if the opening shot cuts it off, otherwise on the first', () => {
  const quoted = o => shotsFor(o).map(s => s.quote);
  assert.deepEqual(quoted({ scroll: true, openingCut: true }), [false, true]);
  assert.deepEqual(quoted({ scroll: true, openingCut: false }), [true, false]);
});

test('zoom + scroll on a long Truth Social post reproduces the desk\'s example', () => {
  const text = 'Let’s talk about this COMPLETE AND TOTAL LOSER, Bill Maher. He’s got a Low Rated Show.\n\nNo sooner had we had that first dinner at the White House, Bill wanted to come back. President DONALD J. TRUMP';
  const out = buildShotlist({ ...trump, text }, { zoom: true, scroll: true, today: '2026-10-26' });
  assert.equal(out, [
    'INTERNET (OCTOBER 26, 2026) (SOCIAL MEDIA WEBSITE - Access All) (MUTE)',
    '',
    '1. SCREENSHOT OF TRUTH SOCIAL POST BY US PRESIDENT, DONALD TRUMP, DATED OCTOBER 25, 2026, ZOOMING IN AND SCROLLING DOWN, READING (English):',
    '',
    '    “Let’s talk about this COMPLETE AND TOTAL LOSER, Bill Maher. He’s got a Low Rated Show.',
    '',
    '    No sooner had we had that first dinner at the White House, Bill wanted to come back. President DONALD J. TRUMP”',
  ].join('\n'));
});

test('a short single-paragraph post is quoted on the shot line, in the post\'s own capitalisation', () => {
  const out = buildShotlist({ platform: 'x', title: 'CUBAN PRESIDENT', name: 'Miguel Díaz-Canel', date: '2026-06-04', language: 'Spanish',
    text: 'The U.S. president has made new threatening statements against Cuba.' }, { today: '2026-06-05' });
  assert.equal(out, [
    'INTERNET (JUNE 5, 2026) (SOCIAL MEDIA WEBSITE - Access All) (MUTE)',
    '',
    '1. SCREENSHOT OF X POST BY CUBAN PRESIDENT, MIGUEL DÍAZ-CANEL, DATED JUNE 4, 2026, READING (Spanish): “The U.S. president has made new threatening statements against Cuba.”',
  ].join('\n'));
});

test('a scroll after a cut is two shots, and the text is not repeated', () => {
  const text = 'Para one.\n\nPara two.';
  const same = { ...trump, date: '2026-10-26' }, today = '2026-10-26';   // same-day post: no DATED to get in the way
  const cut = buildShotlist({ ...same, text }, { scroll: true, openingCut: true, today });
  assert.match(cut, /^1\. SCREENSHOT OF TRUTH SOCIAL POST BY US PRESIDENT, DONALD TRUMP$/m);            // no quote on shot 1
  assert.match(cut, /^2\. SCREENSHOT OF SAME TRUMP TRUTH SOCIAL POST, SCROLLING DOWN, READING \(English\):$/m);
  assert.equal((cut.match(/Para one/g) || []).length, 1);
  const whole = buildShotlist({ ...same, text }, { scroll: true, openingCut: false, today });
  assert.match(whole, /^1\. SCREENSHOT OF TRUTH SOCIAL POST BY US PRESIDENT, DONALD TRUMP, READING \(English\):$/m);
  assert.match(whole, /^2\. SCREENSHOT OF SAME TRUMP TRUTH SOCIAL POST, SCROLLING DOWN$/m);
  assert.equal((whole.match(/Para one/g) || []).length, 1);
});

test('missing pieces are shown as obvious placeholders, never invented', () => {
  const out = buildShotlist({ platform: 'x', title: '', name: '', date: '', language: '', text: 'hello' }, {});
  assert.match(out, /^INTERNET \(\w+ \d+, \d{4}\)/);                                                       // the dateline is always today's date
  assert.match(out, /POST BY \[TITLE\], \[NAME\], DATED \[DATE\], READING \(\[LANGUAGE\]\):/);
  const noTitle = buildShotlist({ platform: 'x', name: 'Ada', date: '2026-01-03', language: 'English', text: 'hi' }, { today: '2026-01-03' });
  assert.match(noTitle, /POST BY \[TITLE\], ADA, READING \(English\)/);                                   // each gap is flagged on its own
  assert.doesNotMatch(noTitle, /\[NAME\]|\[DATE\]|\[LANGUAGE\]/);
});

test('titles: suggested only when the bio clearly says so', () => {
  const cases = [
    ['45th & 47th President of the United States. The Golden Age of America Begins Right Now.', 'US PRESIDENT'],
    ['President of Ukraine / Президент України', 'UKRAINIAN PRESIDENT'],
    ['Former Prime Minister of the United Kingdom.\nFormer Director of Public Prosecutions.', 'FORMER BRITISH PRIME MINISTER'],
    ['Building Australia’s future. Prime Minister of Australia. Grayndler MP.', 'AUSTRALIAN PRIME MINISTER'],
    ['Prime Minister of the UK', 'BRITISH PRIME MINISTER'],
    ['Vice President of Brazil', 'BRAZILIAN VICE PRESIDENT'],
    ['Anthropic CEO. http://darioamodei.com', 'ANTHROPIC CEO'],
    ['CEO of Tesla', 'TESLA CEO'],
    ['President of the Rotary Club of Kent', null],
    ['Top and breaking news, pictures and videos from Reuters.', null],
    ['http://Terafab.AI', null],
    ['Primer Secretario del Comité Central del Partido Comunista de Cuba y Presidente de la República de Cuba.', null],   // not English: left for the producer
    ['', null], [null, null], [42, null],
  ];
  for (const [bio, expected] of cases) assert.equal(suggestTitle(bio), expected, String(bio));
});

test('highlights are marked in the quote with [START HIGHLIGHT] / [END HIGHLIGHT]', () => {
  assert.equal(markHighlights('He’s got a Low Rated Show on HBO.', [{ start: 11, end: 25 }]), 'He’s got a [START HIGHLIGHT] Low Rated Show [END HIGHLIGHT] on HBO.');
  assert.equal(markHighlights('abc', []), 'abc');
  assert.equal(markHighlights('abc def', [{ start: 4, end: 7 }, { start: 0, end: 3 }]), '[START HIGHLIGHT] abc [END HIGHLIGHT] [START HIGHLIGHT] def [END HIGHLIGHT]');
  assert.equal(markHighlights('abc', [{ start: 5, end: 9 }]), 'abc');                         // out of range: ignored
});

test('highlight markers sit in the right place in a built shotlist, and keep a short post inline', () => {
  const text = 'Putin does not want it. He does not want it.';
  const start = text.lastIndexOf('does not want it');
  const out = buildShotlist({ platform: 'x', title: '', name: 'Ada', date: '2026-01-02', language: 'English', text, highlights: [{ start, end: start + 16 }] }, {});
  assert.match(out, /READING \(English\): “Putin does not want it\. He \[START HIGHLIGHT\] does not want it \[END HIGHLIGHT\]\.”$/);
});

test('highlight offsets count from the untrimmed text the page sends', () => {
  const out = buildShotlist({ platform: 'x', name: 'Ada', date: '2026-01-02', language: 'English', text: '  \nhello world  ', highlights: [{ start: 9, end: 14 }] }, {});
  assert.match(out, /“hello \[START HIGHLIGHT\] world \[END HIGHLIGHT\]”/);
});

test('a highlight in a long post is marked where it is, and only on the shot that quotes the post', () => {
  const text = 'First paragraph here.\n\nSecond paragraph with a key phrase inside it.';
  const at = text.indexOf('key phrase');
  const out = buildShotlist({ ...trump, text, highlights: [{ start: at, end: at + 10 }] }, { scroll: true, openingCut: true });
  assert.equal((out.match(/\[START HIGHLIGHT\]/g) || []).length, 1);
  assert.match(out, /\n    Second paragraph with a \[START HIGHLIGHT\] key phrase \[END HIGHLIGHT\] inside it\.”$/);
});

test('dateline is today; the post date appears as DATED only when it differs', () => {
  const f = { platform: 'x', name: 'Ada', title: 'CEO', language: 'English', text: 'hi' };
  const today = { today: '2026-10-26' };
  const old = buildShotlist({ ...f, date: '2026-08-15' }, today);
  assert.match(old, /^INTERNET \(OCTOBER 26, 2026\) \(SOCIAL MEDIA WEBSITE - Access All\) \(MUTE\)/);   // no ARCHIVE label, however old
  assert.match(old, /POST BY CEO, ADA, DATED AUGUST 15, 2026, READING \(English\)/);
  assert.match(buildShotlist({ ...f, date: '2026-10-25' }, today), /POST BY CEO, ADA, DATED OCTOBER 25, 2026, READING/);
  assert.doesNotMatch(buildShotlist({ ...f, date: '2026-10-26' }, today), /DATED/);                          // same day: no DATED
  assert.match(buildShotlist({ ...f, date: '' }, today), /POST BY CEO, ADA, DATED \[DATE\], READING/);       // unknown date is flagged
});

test('DATED goes before the motion, and only on the first shot', () => {
  const f = { platform: 'x', name: 'Ada Lovelace', title: 'CEO', language: 'English', text: 'hi', date: '2026-10-25' };
  assert.match(buildShotlist(f, { zoom: true, scroll: true, today: '2026-10-26' }), /POST BY CEO, ADA LOVELACE, DATED OCTOBER 25, 2026, ZOOMING IN AND SCROLLING DOWN, READING/);
  const cut = buildShotlist(f, { scroll: true, openingCut: true, today: '2026-10-26' });
  assert.match(cut, /^1\. SCREENSHOT OF X POST BY CEO, ADA LOVELACE, DATED OCTOBER 25, 2026$/m);
  assert.match(cut, /^2\. SCREENSHOT OF SAME LOVELACE X POST, SCROLLING DOWN, READING/m);                    // same post: no second date
});

test('capitalisation is forced: title and name in capitals, language like a proper noun', () => {
  assert.equal(normalizeTitle('  us   president '), 'US PRESIDENT');
  assert.equal(normalizeName('sam altman'), 'SAM ALTMAN');
  assert.equal(normalizeLanguage('ENGLISH'), 'English');
  assert.equal(normalizeLanguage('english'), 'English');
  assert.equal(normalizeLanguage('brazilian PORTUGUESE'), 'Brazilian Portuguese');
  assert.equal(normalizeLanguage('mandarin/cantonese'), 'Mandarin/Cantonese');
  assert.equal(normalizeLanguage(''), '');
  const out = buildShotlist({ platform: 'x', title: 'chief executive', name: 'sam altman', date: '2026-10-26', language: 'ENGLISH', text: 'hello' }, { today: '2026-10-26' });
  assert.match(out, /POST BY CHIEF EXECUTIVE, SAM ALTMAN, READING \(English\): “hello”/);
});
