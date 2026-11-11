import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gate, RateLimit, LimitError, claimRenderSlot } from '../lib/limits.js';
import { sendError } from '../lib/pipeline.js';

const tick = () => new Promise(r => setImmediate(r));

test('the render line: one at a time, first come first served, with positions', async () => {
  const g = new Gate(1);
  const order = [];
  const r1 = await g.enter({ ticket: 'a' });
  const p2 = g.enter({ ticket: 'b' }).then(rel => { order.push('b'); return rel; });
  const p3 = g.enter({ ticket: 'c' }).then(rel => { order.push('c'); return rel; });
  assert.equal(g.position('a'), 0);
  assert.equal(g.position('b'), 1);
  assert.equal(g.position('c'), 2);
  assert.equal(g.position('nope'), null);
  r1();
  const r2 = await p2;
  assert.equal(g.position('b'), 0);
  assert.equal(g.position('c'), 1);
  r2(); r2();                                   // releasing twice must not free two slots
  (await p3)();
  assert.deepEqual(order, ['b', 'c']);
  assert.equal(g.active.size, 0);
});

test('closing the tab while waiting takes the request out of the line', async () => {
  const g = new Gate(1);
  const r1 = await g.enter({ ticket: 'a' });
  const ac = new AbortController();
  const p2 = g.enter({ ticket: 'b', signal: ac.signal });
  const p3 = g.enter({ ticket: 'c' });
  ac.abort();
  await assert.rejects(p2, e => e.name === 'AbortError');
  assert.equal(g.position('b'), null);
  assert.equal(g.position('c'), 1);
  r1();
  (await p3)();
  assert.equal(g.active.size, 0);
});

test('a full line is refused with a clear "busy" error (503)', async () => {
  const g = new Gate(1, 2);
  await g.enter();
  g.enter(); g.enter();
  await assert.rejects(g.enter(), e => e instanceof LimitError && e.status === 503 && e.code === 'busy');
});

test('one render per person at a time', () => {
  const release = claimRenderSlot('u:ada@thomsonreuters.com');
  assert.throws(() => claimRenderSlot('u:ada@thomsonreuters.com'), e => e.status === 429 && e.code === 'already_rendering');
  const other = claimRenderSlot('u:bob@thomsonreuters.com');
  release(); other();
  claimRenderSlot('u:ada@thomsonreuters.com')();
});

test('rate limit: a fixed number per window per person, then 429 until the window moves on', () => {
  const rl = new RateLimit(3, 1000, 'slow down');
  rl.hit('a', 0); rl.hit('a', 10); rl.hit('a', 20);
  assert.throws(() => rl.hit('a', 30), e => e.status === 429 && e.message === 'slow down');
  rl.hit('b', 30);                              // someone else is unaffected
  rl.hit('a', 1001);                            // the first hit has left the window
});

test('limit errors reach the page as 429/503 with their message and a Retry-After', () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  sendError(res, new LimitError('busy now', 503, 'busy'));
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['retry-after'], '60');
  assert.equal(JSON.parse(res.body).error, 'busy now');
});
