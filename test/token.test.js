import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SIGNING_SECRET = 'test-secret';
const { signPost, verifyPost, textEditAllowed, TokenError } = await import('../lib/token.js');

const post = { platform: 'x', id: '1', name: 'A Name', handle: 'handle', verified: true, avatarUrl: null, text: 'The quick brown fox jumps over the lazy dog.' };

test('a signed post verifies and round-trips', () => {
  const back = verifyPost(signPost(post));
  assert.equal(back.name, 'A Name');
  assert.equal(back.text, post.text);
  assert.equal(back.verified, true);
});

test('a changed payload is rejected', () => {
  const [body, sig] = signPost(post).split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), name: 'Someone Else' })).toString('base64url');
  assert.throws(() => verifyPost(`${forged}.${sig}`), TokenError);
});

test('garbage and missing tokens are rejected', () => {
  for (const t of [undefined, null, '', 'abc', 'abc.def', 42, {}]) assert.throws(() => verifyPost(t), TokenError);
});

test('a token older than a day is rejected', () => {
  const realNow = Date.now;
  try {
    const token = signPost(post);
    Date.now = () => realNow() + 25 * 60 * 60 * 1000;
    assert.throws(() => verifyPost(token), /more than a day ago/);
  } finally { Date.now = realNow; }
});

test('text edits: the post itself, or its opening, is allowed', () => {
  assert.equal(textEditAllowed(post.text, post.text), true);
  assert.equal(textEditAllowed(post.text, 'The quick brown fox'), true);        // cut from the end
  assert.equal(textEditAllowed(post.text, 'The quick brown fo'), true);         // even mid-word
  assert.equal(textEditAllowed(post.text, '  The quick brown fox\n'), true);    // surrounding whitespace is ignored
});

test('text edits: adding, changing, reordering and cutting from the middle or start are refused', () => {
  assert.equal(textEditAllowed(post.text, 'The quick brown fox jumps over the lazy cat.'), false);   // one word changed
  assert.equal(textEditAllowed(post.text, 'The quick brown fox jumps over the lazy dog. Really.'), false);   // added
  assert.equal(textEditAllowed(post.text, 'The brown quick fox'), false);                              // reordered
  assert.equal(textEditAllowed(post.text, 'The fox jumps over the lazy dog.'), false);                 // cut from the middle
  assert.equal(textEditAllowed(post.text, 'fox jumps over the lazy dog.'), false);                     // cut from the start
  assert.equal(textEditAllowed(post.text, 'the quick brown fox'), false);                              // capitalisation changed
  assert.equal(textEditAllowed(post.text, ''), false);
  assert.equal(textEditAllowed(post.text, '   '), false);
});
