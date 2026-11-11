import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SIGNING_SECRET = 'test-secret-0123456789abcdef0123456789';
const { textToHtml, cardHtml } = await import('../lib/card.js');
const { cleanRanges, postFromToken, InputError } = await import('../lib/pipeline.js');
const { signPost } = await import('../lib/token.js');
const { postHtmlToText } = await import('../lib/sources.js');

test('textToHtml: one block per line, with HTML escaped', () => {
  const html = textToHtml('a < b\n\nc & d');
  assert.equal((html.match(/class="ln"/g) || []).length, 3);
  assert.match(html, /a &lt; b/);
  assert.match(html, /c &amp; d/);
  assert.doesNotMatch(html, /<script/);
});

test('textToHtml: only the given range is highlighted, even if the phrase repeats', () => {
  const text = 'does not want it. Putin does not want it.';
  const second = text.lastIndexOf('does not want it');
  const html = textToHtml(text, [{ start: second, end: second + 16 }]);
  assert.equal((html.match(/<mark>/g) || []).length, 1);
  assert.match(html, /Putin <mark>does not want it<\/mark>\./);
});

test('textToHtml: links, mentions and hashtags are coloured, and can be highlighted too', () => {
  const html = textToHtml('see https://example.com/x @reuters #news');
  assert.equal((html.match(/class="lnk"/g) || []).length, 3);
  assert.match(textToHtml('say @reuters now', [{ start: 4, end: 12 }]), /<span class="lnk"><mark>@reuters<\/mark><\/span>/);
});

test('textToHtml: a highlight can span lines', () => {
  const html = textToHtml('one\ntwo', [{ start: 1, end: 6 }]);
  assert.equal((html.match(/<mark>/g) || []).length, 2);
});

test('cardHtml: the badge shows only when verified, and takes the site\'s colour', () => {
  const base = { name: 'N', handle: 'h', text: 'hi' };
  assert.doesNotMatch(cardHtml({ ...base, platform: 'x', verified: false }), /<svg/);
  assert.match(cardHtml({ ...base, platform: 'x', verified: true }), /#1d9bf0/);
  assert.match(cardHtml({ ...base, platform: 'truth', verified: true }), /#5448ee/);
});

test('cleanRanges: realigns for trimmed whitespace, clamps, and rejects junk', () => {
  assert.deepEqual(cleanRanges([{ start: 5, end: 9 }], 2, 20), [{ start: 3, end: 7 }]);
  assert.deepEqual(cleanRanges([{ start: -5, end: 99 }], 0, 10), [{ start: 0, end: 10 }]);
  assert.deepEqual(cleanRanges([{ start: 4, end: 4 }], 0, 10), []);
  assert.deepEqual(cleanRanges(null, 0, 10), []);
  assert.throws(() => cleanRanges([{ start: 'a', end: 3 }], 0, 10), InputError);
  assert.throws(() => cleanRanges('x', 0, 10), InputError);
  assert.throws(() => cleanRanges(Array(101).fill({ start: 0, end: 1 }), 0, 10), InputError);
});

test('postFromToken: untouched text passes; rewrites, empties and forged tokens do not', () => {
  const token = signPost({ platform: 'x', id: '1', name: 'N', handle: 'h', verified: false, avatarUrl: null, text: 'alpha beta gamma delta' });
  assert.equal(postFromToken(token).text, 'alpha beta gamma delta');
  assert.equal(postFromToken(token, '  alpha beta gamma delta\n').text, 'alpha beta gamma delta');
  assert.equal(postFromToken(token, '  alpha beta').shift, 2);
  assert.equal(postFromToken(token, 'alpha beta').text, 'alpha beta');
  assert.throws(() => postFromToken(token, 'beta gamma delta'), /shortened from the end/);
  assert.throws(() => postFromToken(token, 'entirely different words here now'), /shortened from the end/);
  assert.throws(() => postFromToken(token, '   '), /empty/);
  assert.throws(() => postFromToken('nope.nope', 'alpha'), InputError);
});

test('postFromToken: the avatar must come from an allowed host', () => {
  const sign = avatarUrl => signPost({ platform: 'x', id: '1', name: 'N', handle: 'h', verified: false, avatarUrl, text: 'hello there' });
  assert.equal(postFromToken(sign('https://pbs.twimg.com/profile_images/1/a.jpg')).avatarUrl, 'https://pbs.twimg.com/profile_images/1/a.jpg');
  assert.equal(postFromToken(sign('https://evil.example.com/a.jpg')).avatarUrl, null);
  assert.equal(postFromToken(sign('http://pbs.twimg.com/a.jpg')).avatarUrl, null);
});

test('postHtmlToText: keeps what Truth Social displays', () => {
  const html = '<p>Hello &amp; welcome</p><p>Read <a href="https://x.test/long"><span class="invisible">https://</span><span class="ellipsis">x.test/lo</span><span class="invisible">ng</span></a></p>';
  assert.equal(postHtmlToText(html), 'Hello & welcome\n\nRead x.test/lo…');
});
