import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, InputError } from '../lib/pipeline.js';
import { toDataUri } from '../lib/sources.js';
import { cardHtml } from '../lib/card.js';

// ── Cross-site request guard ──
const req = (headers, body = { url: 'x' }) => ({ headers, body });
const ok = { host: 'app.example', 'content-type': 'application/json' };

test('JSON requests from our own page are accepted', () => {
  assert.deepEqual(readJson(req(ok)), { url: 'x' });
  assert.deepEqual(readJson(req({ ...ok, 'content-type': 'application/json; charset=utf-8', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' })), { url: 'x' });
  assert.deepEqual(readJson(req({ ...ok, 'x-forwarded-host': 'public.example', host: 'internal', origin: 'https://public.example' })), { url: 'x' });
});

test('a plain-text body (what a cross-site form can send) is refused', () => {
  assert.throws(() => readJson(req({ host: 'app.example', 'content-type': 'text/plain' }, '{"url":"x"}')), InputError);
  assert.throws(() => readJson(req({ host: 'app.example' })), InputError);
});

test('requests marked or labelled as cross-site are refused', () => {
  assert.throws(() => readJson(req({ ...ok, 'sec-fetch-site': 'cross-site' })), InputError);
  assert.throws(() => readJson(req({ ...ok, origin: 'https://evil.example' })), InputError);
  assert.throws(() => readJson(req({ ...ok, origin: 'null' })), InputError);
});

// ── Avatar download ──
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const serve = (type, bytes, extra = {}) => { globalThis.fetch = async () => new Response(bytes, { status: 200, headers: { ...(type ? { 'content-type': type } : {}), ...extra } }); };

test('avatars: a normal image becomes a data URI', async () => {
  serve('image/png', Buffer.from([1, 2, 3]));
  assert.equal(await toDataUri('https://pbs.twimg.com/a.png'), 'data:image/png;base64,AQID');
});

test('avatars: non-images, odd types and oversized files are dropped', async () => {
  serve('text/html', 'x'); assert.equal(await toDataUri('https://pbs.twimg.com/a'), null);
  serve('image/png" onerror="alert(1)', 'x'); assert.equal(await toDataUri('https://pbs.twimg.com/a'), null);
  serve('image/svg+xml', '<svg/>'); assert.equal(await toDataUri('https://pbs.twimg.com/a'), null);
  serve('image/png', Buffer.alloc(5e6 + 1)); assert.equal(await toDataUri('https://pbs.twimg.com/a'), null);
});

test('the card never puts a non-image value into the page', () => {
  const evil = 'data:image/png;base64,AAAA"><script>alert(1)</script>';
  const html = cardHtml({ name: 'A', handle: 'a', text: 'hi', avatarDataUri: evil });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('class="av ph"'));            // falls back to the initial
  assert.ok(cardHtml({ name: 'A', handle: 'a', text: 'hi', avatarDataUri: 'data:image/png;base64,AAAA' }).includes('src="data:image/png;base64,AAAA"'));
});
